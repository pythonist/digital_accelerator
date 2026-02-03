from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import duckdb

from api.tools.btsy.duckdb_pool import duckdb_pool


@dataclass
class WorkloadConfig:
    analysts: int
    alerts_per_analyst: int
    sla_days: int


class OperationsIntelligenceService:
    def __init__(self, workbench_db_path: Path):
        self.db_path = workbench_db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _ensure_schema(self):
        with duckdb_pool.connection(self.db_path) as conn:
            try:
                conn.execute("ALTER TABLE alert_generation_runs ADD COLUMN IF NOT EXISTS scenario_ref TEXT")
            except Exception:
                pass
            conn.execute("""
                CREATE TABLE IF NOT EXISTS scenario_interaction_runs (
                  run_id INTEGER PRIMARY KEY,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  status TEXT NOT NULL,
                  alert_run_ids_json TEXT,
                  start_date DATE,
                  end_date DATE
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS scenario_overlap_summary (
                  run_id INTEGER NOT NULL,
                  scenario_a TEXT NOT NULL,
                  scenario_b TEXT NOT NULL,
                  overlap_pct DOUBLE,
                  overlap_count INTEGER,
                  count_a INTEGER,
                  count_b INTEGER,
                  unique_a INTEGER,
                  unique_b INTEGER
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS scenario_redundancy_flags (
                  run_id INTEGER NOT NULL,
                  scenario_a TEXT NOT NULL,
                  scenario_b TEXT NOT NULL,
                  redundancy_level TEXT NOT NULL,
                  rationale_text TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS fatigue_simulation_summary (
                  run_id INTEGER NOT NULL,
                  original_alerts INTEGER,
                  suppressed_alerts INTEGER,
                  reduced_alerts INTEGER,
                  reduction_pct DOUBLE,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS workload_runs (
                  run_id INTEGER PRIMARY KEY,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  status TEXT NOT NULL,
                  alert_run_ids_json TEXT,
                  start_date DATE,
                  end_date DATE
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS analyst_capacity_config (
                  run_id INTEGER NOT NULL,
                  analysts INTEGER,
                  alerts_per_analyst INTEGER,
                  sla_days INTEGER,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS workload_simulation_results (
                  run_id INTEGER NOT NULL,
                  as_of_date DATE,
                  alerts_generated INTEGER,
                  capacity INTEGER,
                  excess INTEGER,
                  backlog INTEGER
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS workload_scenario_contrib (
                  run_id INTEGER NOT NULL,
                  scenario_ref TEXT NOT NULL,
                  alerts INTEGER,
                  pct_load DOUBLE
                )
            """)

    def _next_id(self, conn: duckdb.DuckDBPyConnection, table_name: str, pk_column: str) -> int:
        row = conn.execute(f"SELECT COALESCE(MAX({pk_column}), 0) + 1 FROM {table_name}").fetchone()
        v = int(row[0] or 1) if row else 1
        return v if v >= 1 else 1

    def list_alert_runs(self, limit: int = 200) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT r.alert_run_id, r.session_id, r.boundary_id, r.threshold_value, r.created_at, r.status, r.mode,
                       ('S-' || CAST(r.session_id AS VARCHAR) || ':' || COALESCE(s.metric_name, 'scenario')) AS scenario_ref,
                       COALESCE(s.entity_level, 'account') AS entity_level
                FROM alert_generation_runs r
                LEFT JOIN calibration_sessions s
                  ON s.session_id = r.session_id
                ORDER BY r.alert_run_id DESC
                LIMIT ?
            """, [int(limit)]).fetchall()
        return [{
            'alert_run_id': int(r[0]),
            'session_id': int(r[1]),
            'boundary_id': int(r[2]),
            'threshold_value': float(r[3] or 0.0),
            'created_at': str(r[4]),
            'status': r[5],
            'mode': r[6],
            'scenario_ref': r[7],
            'entity_level': r[8],
        } for r in rows]

    def _date_filters(self, start_date: Optional[str], end_date: Optional[str]) -> Tuple[Optional[date], Optional[date]]:
        sd = date.fromisoformat(start_date) if start_date else None
        ed = date.fromisoformat(end_date) if end_date else None
        return sd, ed

    def _alerts_filtered_cte(self, alert_run_ids: List[int], start_date: Optional[date], end_date: Optional[date]) -> Tuple[str, List]:
        if not alert_run_ids:
            raise ValueError("At least one alert_run_id is required")
        ids = [int(x) for x in alert_run_ids]
        params: List = []
        where = "a.alert_run_id IN (" + ",".join(["?"] * len(ids)) + ")"
        params.extend(ids)
        if start_date:
            where += " AND date_trunc('day', a.alert_date) >= ?"
            params.append(start_date.isoformat())
        if end_date:
            where += " AND date_trunc('day', a.alert_date) <= ?"
            params.append(end_date.isoformat())
        cte = f"""
            WITH alerts_filtered AS (
              SELECT
                COALESCE(
                  a.scenario_ref,
                  ('S-' || CAST(r.session_id AS VARCHAR) || ':' || COALESCE(s.metric_name, 'scenario'))
                ) AS scenario_ref,
                a.entity_id,
                a.alert_date
              FROM alerts a
              LEFT JOIN alert_generation_runs r
                ON r.alert_run_id = a.alert_run_id
              LEFT JOIN calibration_sessions s
                ON s.session_id = r.session_id
              WHERE {where}
            )
        """
        return cte, params

    def run_scenario_interaction(self, alert_run_ids: List[int], start_date: Optional[str], end_date: Optional[str], created_by: str) -> Dict:
        sd, ed = self._date_filters(start_date, end_date)
        with duckdb_pool.connection(self.db_path) as conn:
            run_id = self._next_id(conn, "scenario_interaction_runs", "run_id")
            conn.execute("""
                INSERT INTO scenario_interaction_runs (run_id, created_by, status, alert_run_ids_json, start_date, end_date)
                VALUES (?, ?, 'completed', ?, ?, ?)
            """, [int(run_id), created_by, json.dumps([int(x) for x in alert_run_ids]), sd, ed])

            conn.execute("DELETE FROM scenario_overlap_summary WHERE run_id = ?", [int(run_id)])
            conn.execute("DELETE FROM scenario_redundancy_flags WHERE run_id = ?", [int(run_id)])
            conn.execute("DELETE FROM fatigue_simulation_summary WHERE run_id = ?", [int(run_id)])

            cte, params = self._alerts_filtered_cte(alert_run_ids, sd, ed)

            conn.execute(cte + """
                INSERT INTO scenario_overlap_summary (run_id, scenario_a, scenario_b, overlap_pct, overlap_count, count_a, count_b, unique_a, unique_b)
                WITH scenario_entities AS (
                  SELECT scenario_ref, entity_id
                  FROM alerts_filtered
                  WHERE entity_id IS NOT NULL AND scenario_ref IS NOT NULL
                  GROUP BY scenario_ref, entity_id
                ),
                counts AS (
                  SELECT scenario_ref, COUNT(1) AS n
                  FROM scenario_entities
                  GROUP BY scenario_ref
                ),
                pairs AS (
                  SELECT
                    a.scenario_ref AS scenario_a,
                    b.scenario_ref AS scenario_b,
                    COUNT(1) AS overlap_count
                  FROM scenario_entities a
                  JOIN scenario_entities b
                    ON a.entity_id = b.entity_id
                   AND a.scenario_ref < b.scenario_ref
                  GROUP BY a.scenario_ref, b.scenario_ref
                )
                SELECT
                  ? AS run_id,
                  p.scenario_a,
                  p.scenario_b,
                  CAST(p.overlap_count AS DOUBLE) / NULLIF((ca.n + cb.n - p.overlap_count), 0) * 100.0 AS overlap_pct,
                  p.overlap_count,
                  ca.n AS count_a,
                  cb.n AS count_b,
                  ca.n - p.overlap_count AS unique_a,
                  cb.n - p.overlap_count AS unique_b
                FROM pairs p
                JOIN counts ca ON ca.scenario_ref = p.scenario_a
                JOIN counts cb ON cb.scenario_ref = p.scenario_b
            """, [int(run_id), *params])

            sim = conn.execute(cte + """
                SELECT
                  COUNT(1) AS original_alerts,
                  COUNT(DISTINCT entity_id) AS reduced_alerts
                FROM alerts_filtered
            """, params).fetchone()
            original_alerts = int(sim[0] or 0) if sim else 0
            reduced_alerts = int(sim[1] or 0) if sim else 0
            suppressed_alerts = max(0, original_alerts - reduced_alerts)
            reduction_pct = float(suppressed_alerts / original_alerts * 100.0) if original_alerts else 0.0
            conn.execute("""
                INSERT INTO fatigue_simulation_summary (run_id, original_alerts, suppressed_alerts, reduced_alerts, reduction_pct)
                VALUES (?, ?, ?, ?, ?)
            """, [int(run_id), original_alerts, suppressed_alerts, reduced_alerts, float(reduction_pct)])

            self._compute_redundancy(conn, int(run_id))

        return self.get_scenario_interaction_run(int(run_id))

    def _compute_redundancy(self, conn: duckdb.DuckDBPyConnection, run_id: int):
        rows = conn.execute("""
            SELECT scenario_a, scenario_b, overlap_pct, overlap_count, count_a, count_b, unique_a, unique_b
            FROM scenario_overlap_summary
            WHERE run_id = ?
            ORDER BY overlap_pct DESC NULLS LAST
        """, [int(run_id)]).fetchall()

        str_rates = conn.execute("""
            WITH latest AS (
              SELECT
                alert_run_id,
                MAX(str_alignment_run_id) AS str_alignment_run_id
              FROM str_alignment_runs
              GROUP BY alert_run_id
            )
            SELECT
              l.alert_run_id,
              ('S-' || CAST(agr.session_id AS VARCHAR) || ':' || COALESCE(cs.metric_name, 'scenario')) AS scenario_ref,
              scs.capture_rate
            FROM latest l
            JOIN str_alignment_runs sar
              ON sar.str_alignment_run_id = l.str_alignment_run_id
            LEFT JOIN str_capture_summary scs
              ON scs.str_alignment_run_id = sar.str_alignment_run_id
            LEFT JOIN alert_generation_runs agr
              ON agr.alert_run_id = l.alert_run_id
            LEFT JOIN calibration_sessions cs
              ON cs.session_id = agr.session_id
        """).fetchall()
        scenario_capture: Dict[str, float] = {}
        for _alert_run_id, scenario_ref, capture_rate in str_rates:
            if scenario_ref:
                scenario_capture[str(scenario_ref)] = float(capture_rate or 0.0)

        for scenario_a, scenario_b, overlap_pct, _overlap_count, count_a, count_b, unique_a, unique_b in rows:
            ca = int(count_a or 0)
            cb = int(count_b or 0)
            ua = int(unique_a or 0)
            ub = int(unique_b or 0)
            if ca <= 0 or cb <= 0:
                continue
            uap = ua / ca
            ubp = ub / cb
            ov = float(overlap_pct or 0.0)

            level = None
            if ov >= 70.0 and uap <= 0.10 and ubp <= 0.10:
                level = 'HIGH'
            elif ov >= 50.0 and uap <= 0.20 and ubp <= 0.20:
                level = 'MODERATE'
            else:
                continue

            rate_a = scenario_capture.get(str(scenario_a))
            rate_b = scenario_capture.get(str(scenario_b))
            similar_capture = None
            if rate_a is not None and rate_b is not None:
                similar_capture = abs(float(rate_a) - float(rate_b)) <= 2.0

            parts = [
                f'Overlap {ov:.1f}%',
                f'UniqueA {uap*100:.1f}%',
                f'UniqueB {ubp*100:.1f}%'
            ]
            if similar_capture is True:
                parts.append('STR capture similar')
            elif similar_capture is False:
                parts.append('STR capture differs')

            conn.execute("""
                INSERT INTO scenario_redundancy_flags (run_id, scenario_a, scenario_b, redundancy_level, rationale_text)
                VALUES (?, ?, ?, ?, ?)
            """, [int(run_id), str(scenario_a), str(scenario_b), level, "; ".join(parts)])

    def get_scenario_interaction_run(self, run_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            run = conn.execute("""
                SELECT run_id, created_by, created_at, status, alert_run_ids_json, start_date, end_date
                FROM scenario_interaction_runs
                WHERE run_id = ?
            """, [int(run_id)]).fetchone()
            if not run:
                raise ValueError("Run not found")
            overlap = conn.execute("""
                SELECT scenario_a, scenario_b, overlap_pct, unique_a, unique_b, count_a, count_b, overlap_count
                FROM scenario_overlap_summary
                WHERE run_id = ?
                ORDER BY overlap_pct DESC NULLS LAST, scenario_a ASC, scenario_b ASC
            """, [int(run_id)]).fetchall()
            flags = conn.execute("""
                SELECT scenario_a, scenario_b, redundancy_level, rationale_text
                FROM scenario_redundancy_flags
                WHERE run_id = ?
                ORDER BY CASE redundancy_level WHEN 'HIGH' THEN 0 WHEN 'MODERATE' THEN 1 ELSE 9 END, scenario_a, scenario_b
            """, [int(run_id)]).fetchall()
            sim = conn.execute("""
                SELECT original_alerts, suppressed_alerts, reduced_alerts, reduction_pct
                FROM fatigue_simulation_summary
                WHERE run_id = ?
                ORDER BY computed_at DESC
                LIMIT 1
            """, [int(run_id)]).fetchone()

        return {
            'run': {
                'run_id': int(run[0]),
                'created_by': run[1],
                'created_at': str(run[2]),
                'status': run[3],
                'alert_run_ids': json.loads(run[4]) if run[4] else [],
                'start_date': str(run[5]) if run[5] is not None else None,
                'end_date': str(run[6]) if run[6] is not None else None,
            },
            'overlap_matrix': [{
                'scenario_a': r[0],
                'scenario_b': r[1],
                'overlap_pct': float(r[2] or 0.0),
                'unique_a': int(r[3] or 0),
                'unique_b': int(r[4] or 0),
                'count_a': int(r[5] or 0),
                'count_b': int(r[6] or 0),
                'overlap_count': int(r[7] or 0),
            } for r in overlap],
            'redundancy_flags': [{
                'scenario_a': f[0],
                'scenario_b': f[1],
                'redundancy_level': f[2],
                'rationale_text': f[3],
            } for f in flags],
            'fatigue_simulation': {
                'original_alerts': int(sim[0] or 0) if sim else 0,
                'suppressed_alerts': int(sim[1] or 0) if sim else 0,
                'reduced_alerts': int(sim[2] or 0) if sim else 0,
                'reduction_pct': float(sim[3] or 0.0) if sim else 0.0,
                'disclaimer': 'Simulation only — no operational impact.'
            },
            'disclaimer': 'This analysis evaluates interaction and overlap between scenarios. It does not alter alerts or scenario logic.'
        }

    def list_scenario_interaction_runs(self, limit: int = 100) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT run_id, created_by, created_at, status, start_date, end_date
                FROM scenario_interaction_runs
                ORDER BY run_id DESC
                LIMIT ?
            """, [int(limit)]).fetchall()
        return [{
            'run_id': int(r[0]),
            'created_by': r[1],
            'created_at': str(r[2]),
            'status': r[3],
            'start_date': str(r[4]) if r[4] is not None else None,
            'end_date': str(r[5]) if r[5] is not None else None,
        } for r in rows]

    def run_workload_simulation(
        self,
        alert_run_ids: List[int],
        start_date: Optional[str],
        end_date: Optional[str],
        cfg: WorkloadConfig,
        created_by: str
    ) -> Dict:
        sd, ed = self._date_filters(start_date, end_date)
        analysts = max(0, int(cfg.analysts or 0))
        alerts_per_analyst = max(0, int(cfg.alerts_per_analyst or 0))
        sla_days = max(1, int(cfg.sla_days or 1))
        capacity = analysts * alerts_per_analyst

        with duckdb_pool.connection(self.db_path) as conn:
            run_id = self._next_id(conn, "workload_runs", "run_id")
            conn.execute("""
                INSERT INTO workload_runs (run_id, created_by, status, alert_run_ids_json, start_date, end_date)
                VALUES (?, ?, 'completed', ?, ?, ?)
            """, [int(run_id), created_by, json.dumps([int(x) for x in alert_run_ids]), sd, ed])
            conn.execute("DELETE FROM analyst_capacity_config WHERE run_id = ?", [int(run_id)])
            conn.execute("DELETE FROM workload_simulation_results WHERE run_id = ?", [int(run_id)])
            conn.execute("DELETE FROM workload_scenario_contrib WHERE run_id = ?", [int(run_id)])
            conn.execute("""
                INSERT INTO analyst_capacity_config (run_id, analysts, alerts_per_analyst, sla_days)
                VALUES (?, ?, ?, ?)
            """, [int(run_id), analysts, alerts_per_analyst, sla_days])

            cte, params = self._alerts_filtered_cte(alert_run_ids, sd, ed)
            daily = conn.execute(cte + """
                SELECT
                  CAST(date_trunc('day', alert_date) AS DATE) AS as_of_date,
                  COUNT(1) AS alerts_generated
                FROM alerts_filtered
                GROUP BY as_of_date
                ORDER BY as_of_date ASC
            """, params).fetchall()

            backlog = 0
            out_rows = []
            for d, a in daily:
                alerts_generated = int(a or 0)
                excess = max(0, alerts_generated - capacity)
                reviewed = min(capacity, backlog + alerts_generated)
                backlog = max(0, backlog + alerts_generated - reviewed)
                out_rows.append((int(run_id), d, alerts_generated, capacity, excess, backlog))

            if out_rows:
                conn.executemany("""
                    INSERT INTO workload_simulation_results (run_id, as_of_date, alerts_generated, capacity, excess, backlog)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, out_rows)

            by_scenario = conn.execute(cte + """
                SELECT scenario_ref, COUNT(1) AS c
                FROM alerts_filtered
                WHERE scenario_ref IS NOT NULL
                GROUP BY scenario_ref
                ORDER BY c DESC
            """, params).fetchall()
            total_alerts = sum([int(r[1] or 0) for r in by_scenario]) if by_scenario else 0
            for scenario_ref, c in by_scenario:
                pct = float(c / total_alerts * 100.0) if total_alerts else 0.0
                conn.execute("""
                    INSERT INTO workload_scenario_contrib (run_id, scenario_ref, alerts, pct_load)
                    VALUES (?, ?, ?, ?)
                """, [int(run_id), str(scenario_ref), int(c or 0), float(pct)])

        return self.get_workload_run(int(run_id))

    def get_workload_run(self, run_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            run = conn.execute("""
                SELECT run_id, created_by, created_at, status, alert_run_ids_json, start_date, end_date
                FROM workload_runs
                WHERE run_id = ?
            """, [int(run_id)]).fetchone()
            if not run:
                raise ValueError("Run not found")
            cfg = conn.execute("""
                SELECT analysts, alerts_per_analyst, sla_days
                FROM analyst_capacity_config
                WHERE run_id = ?
                ORDER BY created_at DESC
                LIMIT 1
            """, [int(run_id)]).fetchone()
            rows = conn.execute("""
                SELECT as_of_date, alerts_generated, capacity, excess, backlog
                FROM workload_simulation_results
                WHERE run_id = ?
                ORDER BY as_of_date ASC
            """, [int(run_id)]).fetchall()
            scen = conn.execute("""
                SELECT scenario_ref, alerts, pct_load
                FROM workload_scenario_contrib
                WHERE run_id = ?
                ORDER BY alerts DESC, scenario_ref ASC
            """, [int(run_id)]).fetchall()

        return {
            'run': {
                'run_id': int(run[0]),
                'created_by': run[1],
                'created_at': str(run[2]),
                'status': run[3],
                'alert_run_ids': json.loads(run[4]) if run[4] else [],
                'start_date': str(run[5]) if run[5] is not None else None,
                'end_date': str(run[6]) if run[6] is not None else None,
            },
            'config': {
                'analysts': int(cfg[0] or 0) if cfg else 0,
                'alerts_per_analyst': int(cfg[1] or 0) if cfg else 0,
                'sla_days': int(cfg[2] or 1) if cfg else 1,
            },
            'daily': [{
                'date': str(r[0]),
                'alerts_generated': int(r[1] or 0),
                'capacity': int(r[2] or 0),
                'excess': int(r[3] or 0),
                'backlog': int(r[4] or 0),
            } for r in rows],
            'scenario_contrib': [{
                'scenario_ref': r[0],
                'alerts': int(r[1] or 0),
                'pct_load': float(r[2] or 0.0),
            } for r in scen],
            'disclaimer': 'Simulation only — no operational impact.'
        }

    def list_workload_runs(self, limit: int = 100) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT run_id, created_by, created_at, status, start_date, end_date
                FROM workload_runs
                ORDER BY run_id DESC
                LIMIT ?
            """, [int(limit)]).fetchall()
        return [{
            'run_id': int(r[0]),
            'created_by': r[1],
            'created_at': str(r[2]),
            'status': r[3],
            'start_date': str(r[4]) if r[4] is not None else None,
            'end_date': str(r[5]) if r[5] is not None else None,
        } for r in rows]
