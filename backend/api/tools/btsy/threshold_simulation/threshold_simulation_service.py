from pathlib import Path
from typing import Dict, List, Optional, Tuple
import json
import math
import duckdb
from api.tools.btsy.duckdb_pool import duckdb_pool


class ThresholdSimulationService:
    def __init__(self, workbench_db_path: Path):
        self.db_path = workbench_db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _next_id(self, conn: duckdb.DuckDBPyConnection, table_name: str, pk_column: str) -> int:
        row = conn.execute(f"SELECT COALESCE(MAX({pk_column}), 0) + 1 FROM {table_name}").fetchone()
        v = int(row[0] or 1) if row else 1
        return v if v >= 1 else 1

    def _ensure_schema(self):
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS threshold_strategy_results (
                  strategy_id INTEGER NOT NULL,
                  entity_count INTEGER,
                  population_pct DOUBLE,
                  threshold_value DOUBLE,
                  triggered_median DOUBLE,
                  triggered_p99 DOUBLE,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS threshold_overlap_matrix (
                  session_id INTEGER NOT NULL,
                  strategy_a INTEGER NOT NULL,
                  strategy_b INTEGER NOT NULL,
                  overlap_pct DOUBLE,
                  jaccard DOUBLE,
                  intersection_count INTEGER,
                  only_a_count INTEGER,
                  only_b_count INTEGER,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS threshold_sensitivity_results (
                  strategy_id INTEGER NOT NULL,
                  delta DOUBLE NOT NULL,
                  entity_delta INTEGER,
                  pop_delta DOUBLE,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

    def _log_event(self, session_id: int, event_type: str, event: Dict, created_by: Optional[str]):
        with duckdb_pool.connection(self.db_path) as conn:
            event_id = self._next_id(conn, "calibration_event_log", "event_id")
            conn.execute(
                "INSERT INTO calibration_event_log (event_id, session_id, event_type, event_json, created_by) VALUES (?, ?, ?, ?, ?)",
                [event_id, session_id, event_type, json.dumps(event or {}), created_by]
            )

    def _get_session_meta(self, session_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute("""
                SELECT behavior_run_id, metric_name
                FROM calibration_sessions
                WHERE session_id = ?
            """, [session_id]).fetchone()
            if not row:
                raise ValueError("Session not found")
            agg = conn.execute("""
                SELECT entity_collapse, time_lens, sustained_days
                FROM aggregation_configs
                WHERE session_id = ?
            """, [session_id]).fetchone()
            entity_collapse = (agg[0] if agg else 'max')
            time_lens = (agg[1] if agg else 'full')
            sustained_days = int(agg[2]) if agg and agg[2] is not None else 3
            return {
                'behavior_run_id': int(row[0]),
                'metric_name': row[1],
                'entity_collapse': entity_collapse,
                'time_lens': time_lens,
                'sustained_days': sustained_days,
            }

    def _agg_query(self, behavior_run_id: int, metric_name: str, entity_collapse: str, time_lens: str, sustained_days: int) -> str:
        entity_collapse = (entity_collapse or 'max').lower()
        time_lens = (time_lens or 'full').lower()
        metric_filter = f"behavior_run_id = {int(behavior_run_id)}"
        if metric_name:
            metric_filter += " AND metric_name = '" + metric_name.replace("'", "''") + "'"

        if time_lens == 'full':
            base = f"""
                SELECT entity_id, as_of_date, metric_value
                FROM behavior_table
                WHERE {metric_filter}
            """
        else:
            base = f"""
                SELECT entity_id, date_trunc('day', as_of_date) AS as_of_date, MAX(metric_value) AS metric_value
                FROM behavior_table
                WHERE {metric_filter}
                GROUP BY entity_id, as_of_date
            """

        if time_lens in ('rolling_peak', 'sustained'):
            n = max(1, int(sustained_days or 3))
            base = f"""
                WITH daily AS ({base}),
                w AS (
                  SELECT
                    entity_id,
                    as_of_date,
                    metric_value,
                    SUM(metric_value) OVER (
                      PARTITION BY entity_id
                      ORDER BY as_of_date
                      ROWS BETWEEN {n - 1} PRECEDING AND CURRENT ROW
                    ) AS roll_sum,
                    AVG(metric_value) OVER (
                      PARTITION BY entity_id
                      ORDER BY as_of_date
                      ROWS BETWEEN {n - 1} PRECEDING AND CURRENT ROW
                    ) AS roll_avg,
                    MIN(CASE WHEN metric_value != 0 THEN 1 ELSE 0 END) OVER (
                      PARTITION BY entity_id
                      ORDER BY as_of_date
                      ROWS BETWEEN {n - 1} PRECEDING AND CURRENT ROW
                    ) AS all_non_zero
                  FROM daily
                )
                SELECT
                  entity_id,
                  as_of_date,
                  CASE
                    WHEN '{time_lens}' = 'rolling_peak' THEN roll_sum
                    WHEN '{time_lens}' = 'sustained' THEN CASE WHEN all_non_zero = 1 THEN roll_avg ELSE NULL END
                    ELSE metric_value
                  END AS metric_value
                FROM w
            """

        if entity_collapse == 'max':
            return f"SELECT entity_id, MAX(metric_value) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        if entity_collapse == 'avg':
            return f"SELECT entity_id, AVG(metric_value) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        if entity_collapse == 'p95':
            return f"SELECT entity_id, quantile(metric_value, 0.95) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        if entity_collapse == 'last':
            return f"SELECT entity_id, max_by(metric_value, as_of_date) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        raise ValueError("Unsupported entity collapse method")

    def _counts(self, conn: duckdb.DuckDBPyConnection, agg_query: str, threshold: float) -> Tuple[int, int, float]:
        total = int(conn.execute(f"SELECT COUNT(*) FROM ({agg_query})").fetchone()[0] or 0)
        above = int(conn.execute(f"SELECT COUNT(*) FROM ({agg_query}) WHERE aggregated_value >= {float(threshold)}").fetchone()[0] or 0)
        pop_pct = float(above / total * 100.0) if total else 0.0
        return total, above, pop_pct

    def _triggered_stats(self, conn: duckdb.DuckDBPyConnection, agg_query: str, threshold: float) -> Tuple[Optional[float], Optional[float]]:
        row = conn.execute(f"""
            SELECT
              median(aggregated_value) AS med,
              quantile(aggregated_value, 0.99) AS p99
            FROM ({agg_query})
            WHERE aggregated_value >= {float(threshold)}
        """).fetchone()
        if not row:
            return None, None
        return (float(row[0]) if row[0] is not None else None, float(row[1]) if row[1] is not None else None)

    def preview_percentile(self, behavior_db_path: Path, session_id: int, percentile: float) -> Dict:
        meta = self._get_session_meta(session_id)
        agg_query = self._agg_query(meta['behavior_run_id'], meta['metric_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])
        pct = max(0.0, min(100.0, float(percentile)))
        q = max(0.0, min(1.0, pct / 100.0))
        conn = duckdb.connect(str(behavior_db_path))
        try:
            th = conn.execute(f"SELECT quantile(aggregated_value, {q}) FROM ({agg_query})").fetchone()[0]
            th = float(th or 0.0)
            total, above, pop_pct = self._counts(conn, agg_query, th)
            med, p99 = self._triggered_stats(conn, agg_query, th)
            return {
                'percentile': pct,
                'threshold_value': th,
                'entity_count': above,
                'population_pct': pop_pct,
                'population_base': total,
                'triggered_median': med,
                'triggered_p99': p99
            }
        finally:
            conn.close()

    def _compute_threshold(self, conn: duckdb.DuckDBPyConnection, agg_query: str, strategy_type: str, params: Dict) -> float:
        st = (strategy_type or '').lower()
        if st == 'percentile':
            pct = float(params.get('percentile', 99.0))
            q = max(0.0, min(1.0, pct / 100.0))
            th = conn.execute(f"SELECT quantile(aggregated_value, {q}) FROM ({agg_query})").fetchone()[0]
            return float(th or 0.0)
        if st == 'absolute':
            return float(params.get('threshold_value') or 0.0)
        if st == 'top_n':
            top_n = max(1, int(params.get('top_n') or 100))
            th_row = conn.execute(f"""
                SELECT aggregated_value
                FROM ({agg_query})
                ORDER BY aggregated_value DESC NULLS LAST
                LIMIT 1 OFFSET {top_n - 1}
            """).fetchone()
            return float(th_row[0] or 0.0) if th_row else 0.0
        if st == 'hybrid':
            pct = float(params.get('percentile', 99.0))
            cap = float(params.get('cap_value') or 0.0)
            q = max(0.0, min(1.0, pct / 100.0))
            th = conn.execute(f"SELECT quantile(aggregated_value, {q}) FROM ({agg_query})").fetchone()[0]
            th = float(th or 0.0)
            if cap > 0.0:
                return float(min(th, cap))
            return float(th)
        raise ValueError("Unsupported strategy type")

    def create_strategy(self, behavior_db_path: Path, session_id: int, name: str, strategy_type: str, params: Dict, created_by: Optional[str]) -> Dict:
        meta = self._get_session_meta(session_id)
        agg_query = self._agg_query(meta['behavior_run_id'], meta['metric_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])
        conn = duckdb.connect(str(behavior_db_path))
        try:
            th = self._compute_threshold(conn, agg_query, strategy_type, params or {})
            total, above, pop_pct = self._counts(conn, agg_query, th)
            trig_med, trig_p99 = self._triggered_stats(conn, agg_query, th)
        finally:
            conn.close()

        with duckdb_pool.connection(self.db_path) as wconn:
            strategy_id = self._next_id(wconn, "threshold_strategies", "strategy_id")
            wconn.execute("""
                INSERT INTO threshold_strategies (
                  strategy_id, session_id, name, strategy_type, params_json,
                  threshold_value, alerts_count, population_pct
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                strategy_id, session_id, name, strategy_type, json.dumps(params or {}),
                float(th), int(above), float(pop_pct)
            ])
            wconn.execute("DELETE FROM threshold_strategy_results WHERE strategy_id = ?", [int(strategy_id)])
            wconn.execute("""
                INSERT INTO threshold_strategy_results (
                  strategy_id, entity_count, population_pct, threshold_value, triggered_median, triggered_p99
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, [int(strategy_id), int(above), float(pop_pct), float(th), trig_med, trig_p99])

        self._log_event(session_id, 'threshold_strategy_created', {
            'strategy_id': int(strategy_id),
            'name': name,
            'strategy_type': strategy_type,
            'params': params or {},
            'threshold_value': float(th),
            'entity_count': int(above),
            'population_pct': float(pop_pct),
            'population_base': int(total)
        }, created_by)
        return {'strategy_id': int(strategy_id)}

    def recompute_strategies(self, behavior_db_path: Path, session_id: int, created_by: Optional[str]) -> List[Dict]:
        meta = self._get_session_meta(session_id)
        agg_query = self._agg_query(meta['behavior_run_id'], meta['metric_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])

        strategies = self.list_strategies(session_id)
        if not strategies:
            return []

        bconn = duckdb.connect(str(behavior_db_path))
        try:
            total = int(bconn.execute(f"SELECT COUNT(*) FROM ({agg_query})").fetchone()[0] or 0)
            updates = []
            for s in strategies:
                params = s.get('params') or {}
                th = self._compute_threshold(bconn, agg_query, s['strategy_type'], params)
                _, above, pop_pct = self._counts(bconn, agg_query, th)
                trig_med, trig_p99 = self._triggered_stats(bconn, agg_query, th)
                updates.append({
                    'strategy_id': s['strategy_id'],
                    'threshold_value': float(th),
                    'entity_count': int(above),
                    'population_pct': float(pop_pct),
                    'population_base': int(total),
                    'triggered_median': trig_med,
                    'triggered_p99': trig_p99
                })
        finally:
            bconn.close()

        with duckdb_pool.connection(self.db_path) as wconn:
            wconn.execute("DELETE FROM threshold_overlap_matrix WHERE session_id = ?", [session_id])
            for u in updates:
                wconn.execute("""
                    UPDATE threshold_strategies
                    SET threshold_value = ?, alerts_count = ?, population_pct = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE session_id = ? AND strategy_id = ?
                """, [u['threshold_value'], u['entity_count'], u['population_pct'], session_id, u['strategy_id']])
                wconn.execute("DELETE FROM threshold_sensitivity_results WHERE strategy_id = ?", [u['strategy_id']])
                wconn.execute("DELETE FROM threshold_strategy_results WHERE strategy_id = ?", [u['strategy_id']])
                wconn.execute("""
                    INSERT INTO threshold_strategy_results (
                      strategy_id, entity_count, population_pct, threshold_value, triggered_median, triggered_p99
                    ) VALUES (?, ?, ?, ?, ?, ?)
                """, [
                    u['strategy_id'],
                    u['entity_count'],
                    u['population_pct'],
                    u['threshold_value'],
                    u['triggered_median'],
                    u['triggered_p99']
                ])

        self._log_event(session_id, 'threshold_strategies_recomputed', {'strategy_ids': [u['strategy_id'] for u in updates]}, created_by)
        return updates

    def delete_strategy(self, session_id: int, strategy_id: int, created_by: Optional[str]):
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("DELETE FROM threshold_strategies WHERE session_id = ? AND strategy_id = ?", [session_id, strategy_id])
            conn.execute("DELETE FROM threshold_strategy_results WHERE strategy_id = ?", [strategy_id])
            conn.execute("DELETE FROM threshold_sensitivity_results WHERE strategy_id = ?", [strategy_id])
            conn.execute("""
                DELETE FROM threshold_overlap_matrix
                WHERE session_id = ? AND (strategy_a = ? OR strategy_b = ?)
            """, [session_id, strategy_id, strategy_id])
            conn.execute("DELETE FROM scenario_entities WHERE session_id = ? AND strategy_id = ?", [session_id, strategy_id])
        self._log_event(session_id, 'threshold_strategy_deleted', {'strategy_id': int(strategy_id)}, created_by)

    def list_strategies(self, session_id: int) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT strategy_id, name, strategy_type, params_json, threshold_value, alerts_count, population_pct, created_at, updated_at
                FROM threshold_strategies
                WHERE session_id = ?
                ORDER BY strategy_id ASC
            """, [session_id]).fetchall()
            return [{
                'strategy_id': int(r[0]),
                'name': r[1],
                'strategy_type': r[2],
                'params': json.loads(r[3]) if r[3] else {},
                'threshold_value': float(r[4]) if r[4] is not None else None,
                'entity_count': int(r[5]) if r[5] is not None else None,
                'population_pct': float(r[6]) if r[6] is not None else None,
                'created_at': str(r[7]),
                'updated_at': str(r[8]),
            } for r in rows]

    def impact_matrix(self, behavior_db_path: Path, session_id: int, created_by: Optional[str]) -> List[Dict]:
        meta = self._get_session_meta(session_id)
        agg_query = self._agg_query(meta['behavior_run_id'], meta['metric_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])
        conn = duckdb.connect(str(behavior_db_path))
        try:
            total = int(conn.execute(f"SELECT COUNT(*) FROM ({agg_query})").fetchone()[0] or 0)
        finally:
            conn.close()

        strategies = self.list_strategies(session_id)
        results = []
        conn2 = duckdb.connect(str(behavior_db_path))
        try:
            for s in strategies:
                th = float(s['threshold_value'] or 0.0)
                _, above, pop_pct = self._counts(conn2, agg_query, th)
                med, p99 = self._triggered_stats(conn2, agg_query, th)
                results.append({
                    'strategy_id': s['strategy_id'],
                    'name': s['name'],
                    'strategy_type': s['strategy_type'],
                    'threshold_value': th,
                    'entity_count': above,
                    'population_pct': pop_pct,
                    'population_base': total,
                    'triggered_median': med,
                    'triggered_p99': p99
                })
        finally:
            conn2.close()

        with duckdb_pool.connection(self.db_path) as wconn:
            for r in results:
                wconn.execute("DELETE FROM threshold_strategy_results WHERE strategy_id = ?", [r['strategy_id']])
                wconn.execute("""
                    INSERT INTO threshold_strategy_results (
                      strategy_id, entity_count, population_pct, threshold_value, triggered_median, triggered_p99
                    ) VALUES (?, ?, ?, ?, ?, ?)
                """, [
                    r['strategy_id'],
                    r['entity_count'],
                    r['population_pct'],
                    r['threshold_value'],
                    r['triggered_median'],
                    r['triggered_p99']
                ])

        self._log_event(session_id, 'threshold_impact_matrix_computed', {'strategies': [r['strategy_id'] for r in results]}, created_by)
        return results

    def overlap(self, behavior_db_path: Path, session_id: int, strategy_ids: List[int], created_by: Optional[str]) -> List[Dict]:
        meta = self._get_session_meta(session_id)
        agg_query = self._agg_query(meta['behavior_run_id'], meta['metric_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])
        strategies = {s['strategy_id']: s for s in self.list_strategies(session_id) if s['strategy_id'] in set(strategy_ids or [])}
        ids = list(strategies.keys())
        if len(ids) < 2:
            return []

        conn = duckdb.connect(str(behavior_db_path))
        try:
            total = int(conn.execute(f"SELECT COUNT(*) FROM ({agg_query})").fetchone()[0] or 0)
            rows = []
            for i in range(len(ids)):
                for j in range(i + 1, len(ids)):
                    a = strategies[ids[i]]
                    b = strategies[ids[j]]
                    th_a = float(a['threshold_value'] or 0.0)
                    th_b = float(b['threshold_value'] or 0.0)
                    count_a = int(conn.execute(f"SELECT COUNT(*) FROM ({agg_query}) WHERE aggregated_value >= {th_a}").fetchone()[0] or 0)
                    count_b = int(conn.execute(f"SELECT COUNT(*) FROM ({agg_query}) WHERE aggregated_value >= {th_b}").fetchone()[0] or 0)
                    inter_th = max(th_a, th_b)
                    intersection = int(conn.execute(f"SELECT COUNT(*) FROM ({agg_query}) WHERE aggregated_value >= {inter_th}").fetchone()[0] or 0)
                    union = max(0, count_a + count_b - intersection)
                    jacc = float(intersection / union) if union else 0.0
                    overlap_pct = float(intersection / min(count_a, count_b) * 100.0) if min(count_a, count_b) else 0.0
                    only_a = max(0, count_a - intersection)
                    only_b = max(0, count_b - intersection)
                    rows.append({
                        'strategy_a': a['strategy_id'],
                        'strategy_b': b['strategy_id'],
                        'intersection_count': intersection,
                        'only_a_count': only_a,
                        'only_b_count': only_b,
                        'overlap_pct': overlap_pct,
                        'jaccard': jacc
                    })
        finally:
            conn.close()

        with duckdb_pool.connection(self.db_path) as wconn:
            for r in rows:
                wconn.execute("""
                    DELETE FROM threshold_overlap_matrix
                    WHERE session_id = ? AND strategy_a = ? AND strategy_b = ?
                """, [session_id, r['strategy_a'], r['strategy_b']])
                wconn.execute("""
                    INSERT INTO threshold_overlap_matrix (
                      session_id, strategy_a, strategy_b, overlap_pct, jaccard, intersection_count, only_a_count, only_b_count
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, [
                    session_id,
                    r['strategy_a'],
                    r['strategy_b'],
                    r['overlap_pct'],
                    r['jaccard'],
                    r['intersection_count'],
                    r['only_a_count'],
                    r['only_b_count']
                ])

        self._log_event(session_id, 'threshold_overlap_computed', {'strategy_ids': ids}, created_by)
        for r in rows:
            a = strategies.get(r['strategy_a'])
            b = strategies.get(r['strategy_b'])
            r['name_a'] = a['name'] if a else str(r['strategy_a'])
            r['name_b'] = b['name'] if b else str(r['strategy_b'])
        return rows

    def sensitivity(self, behavior_db_path: Path, session_id: int, strategy_id: int, delta: float, created_by: Optional[str]) -> List[Dict]:
        meta = self._get_session_meta(session_id)
        agg_query = self._agg_query(meta['behavior_run_id'], meta['metric_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])

        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute("""
                SELECT strategy_type, params_json, threshold_value, alerts_count, population_pct
                FROM threshold_strategies
                WHERE session_id = ? AND strategy_id = ?
            """, [session_id, strategy_id]).fetchone()
            if not row:
                raise ValueError("Strategy not found")
            strategy_type = row[0]
            params = json.loads(row[1]) if row[1] else {}
            base_threshold = float(row[2] or 0.0)
            base_count = int(row[3] or 0)
            base_pop = float(row[4] or 0.0)

        bconn = duckdb.connect(str(behavior_db_path))
        try:
            base_total = int(bconn.execute(f"SELECT COUNT(*) FROM ({agg_query})").fetchone()[0] or 0)

            def eval_threshold(th: float) -> Tuple[int, float]:
                _, above, pop = self._counts(bconn, agg_query, th)
                return above, pop

            points = []
            st = (strategy_type or '').lower()
            if st in ('percentile', 'hybrid'):
                base_pct = float(params.get('percentile', 99.0))
                for d in (-abs(delta), abs(delta)):
                    pct = max(0.0, min(100.0, base_pct + d))
                    q = max(0.0, min(1.0, pct / 100.0))
                    th = bconn.execute(f"SELECT quantile(aggregated_value, {q}) FROM ({agg_query})").fetchone()[0]
                    th = float(th or 0.0)
                    if st == 'hybrid':
                        cap = float(params.get('cap_value') or 0.0)
                        if cap > 0.0:
                            th = min(th, cap)
                    count, pop = eval_threshold(th)
                    points.append({'delta': float(d), 'entity_delta': int(count - base_count), 'pop_delta': float(pop - base_pop)})
            else:
                rel = abs(delta)
                for d in (-rel, rel):
                    th = base_threshold * (1.0 + d)
                    count, pop = eval_threshold(th)
                    points.append({'delta': float(d), 'entity_delta': int(count - base_count), 'pop_delta': float(pop - base_pop)})
        finally:
            bconn.close()

        with duckdb_pool.connection(self.db_path) as wconn:
            wconn.execute("DELETE FROM threshold_sensitivity_results WHERE strategy_id = ?", [strategy_id])
            for p in points:
                wconn.execute("""
                    INSERT INTO threshold_sensitivity_results (strategy_id, delta, entity_delta, pop_delta)
                    VALUES (?, ?, ?, ?)
                """, [strategy_id, p['delta'], p['entity_delta'], p['pop_delta']])

        self._log_event(session_id, 'threshold_sensitivity_computed', {'strategy_id': strategy_id, 'delta': delta}, created_by)
        return points
