from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from api.tools.btsy.duckdb_pool import duckdb_pool


def _stable_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


class ScenarioService:
    def __init__(self, workbench_db_path: Path):
        self.db_path = workbench_db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()
        self._seed_system_scenarios_if_empty()

    def _ensure_schema(self) -> None:
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS scenarios (
                  scenario_id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  description TEXT,
                  entity_level TEXT NOT NULL,
                  ownership TEXT NOT NULL,
                  status TEXT NOT NULL,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  version INTEGER NOT NULL,
                  scenario_json TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS scenario_parameters (
                  scenario_id TEXT NOT NULL,
                  param_name TEXT NOT NULL,
                  default_value TEXT,
                  is_editable BOOLEAN,
                  data_type TEXT,
                  PRIMARY KEY (scenario_id, param_name)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS scenario_metrics (
                  scenario_id TEXT NOT NULL,
                  metric_id TEXT NOT NULL,
                  metric_family TEXT,
                  aggregation_type TEXT NOT NULL,
                  column_name TEXT,
                  numerator_filter_json TEXT,
                  denominator_filter_json TEXT,
                  frequency TEXT,
                  is_optional BOOLEAN,
                  PRIMARY KEY (scenario_id, metric_id)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS scenario_metric_windows (
                  scenario_id TEXT NOT NULL,
                  metric_id TEXT NOT NULL,
                  window_spec TEXT NOT NULL,
                  enabled BOOLEAN NOT NULL,
                  PRIMARY KEY (scenario_id, metric_id, window_spec)
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_scenarios_ownership ON scenarios(ownership)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_scenarios_entity ON scenarios(entity_level)")

    def _seed_system_scenarios_if_empty(self) -> None:
        with duckdb_pool.connection(self.db_path) as conn:
            c = conn.execute("SELECT COUNT(1) FROM scenarios").fetchone()
            if c and int(c[0] or 0) > 0:
                return

            seeds = [
                {
                    "scenario_id": "SCN_CASH_VOLUME_1D",
                    "name": "High Cash Volume – 1 Day",
                    "description": "High cash movement within a short window to identify burst cash activity.",
                    "entity_level": "account",
                    "ownership": "SYSTEM",
                    "status": "ACTIVE",
                    "created_by": "system",
                    "version": 1,
                    "universe": {"filters": {"transaction_type": ["CASH"]}},
                    "behaviors": [
                        {"metric_id": "cash_sum", "aggregation_type": "SUM", "column_name": "transaction_amount", "windows": ["1D", "7D"], "frequency": "D"}
                    ],
                },
                {
                    "scenario_id": "SCN_REPEATED_CASH_DEPOSITS_7D",
                    "name": "Repeated Cash Deposits – 7 Days",
                    "description": "Frequency-oriented cash deposits to surface structuring patterns over a week.",
                    "entity_level": "account",
                    "ownership": "SYSTEM",
                    "status": "ACTIVE",
                    "created_by": "system",
                    "version": 1,
                    "universe": {"filters": {"transaction_type": ["CASH"]}},
                    "behaviors": [
                        {"metric_id": "cash_count", "aggregation_type": "COUNT", "column_name": "transaction_id", "windows": ["7D", "30D"], "frequency": "D"}
                    ],
                },
                {
                    "scenario_id": "SCN_DORMANT_REACTIVATION",
                    "name": "Dormant Account Reactivation",
                    "description": "Reactivation signals after inactivity to identify abrupt account activity changes.",
                    "entity_level": "account",
                    "ownership": "SYSTEM",
                    "status": "ACTIVE",
                    "created_by": "system",
                    "version": 1,
                    "universe": {"filters": {}},
                    "behaviors": [
                        {"metric_id": "txn_count", "aggregation_type": "COUNT", "column_name": "transaction_id", "windows": ["30D"], "frequency": "D"}
                    ],
                },
                {
                    "scenario_id": "SCN_RAPID_IN_OUT_7D",
                    "name": "Rapid Movement In → Out – 7 Days",
                    "description": "High velocity of incoming then outgoing transfers within short windows.",
                    "entity_level": "account",
                    "ownership": "SYSTEM",
                    "status": "ACTIVE",
                    "created_by": "system",
                    "version": 1,
                    "universe": {"filters": {}},
                    "behaviors": [
                        {"metric_id": "out_sum", "aggregation_type": "SUM", "column_name": "transaction_amount", "windows": ["7D"], "frequency": "D"}
                    ],
                },
                {
                    "scenario_id": "SCN_STRUCTURING_RATIO_7D",
                    "name": "Cash Mix Ratio – 7 Days",
                    "description": "Cash amount ratio against total volume as a stable mix indicator.",
                    "entity_level": "account",
                    "ownership": "SYSTEM",
                    "status": "ACTIVE",
                    "created_by": "system",
                    "version": 1,
                    "universe": {"filters": {}},
                    "behaviors": [
                        {
                            "metric_id": "cash_ratio",
                            "aggregation_type": "RATIO",
                            "column_name": "transaction_amount",
                            "windows": ["7D"],
                            "frequency": "D",
                            "numerator_filter": {"transaction_type": ["CASH"]},
                            "denominator_filter": {},
                        }
                    ],
                },
            ]

            for s in seeds:
                scenario_id = str(s["scenario_id"])
                name = str(s["name"])
                description = s.get("description")
                entity_level = str(s.get("entity_level") or "account")
                ownership = str(s.get("ownership") or "SYSTEM")
                status = str(s.get("status") or "ACTIVE")
                created_by = str(s.get("created_by") or "system")
                version = int(s.get("version") or 1)
                scenario_json = _stable_json(s)
                conn.execute(
                    """
                    INSERT INTO scenarios (
                      scenario_id, name, description, entity_level, ownership, status, created_by, version, scenario_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [scenario_id, name, description, entity_level, ownership, status, created_by, version, scenario_json],
                )
                for b in s.get("behaviors") or []:
                    metric_id = str(b.get("metric_id") or "")
                    if not metric_id:
                        continue
                    conn.execute(
                        """
                        INSERT INTO scenario_metrics (
                          scenario_id, metric_id, metric_family, aggregation_type, column_name,
                          numerator_filter_json, denominator_filter_json, frequency, is_optional
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        [
                            scenario_id,
                            metric_id,
                            b.get("metric_family"),
                            str(b.get("aggregation_type") or "SUM"),
                            b.get("column_name"),
                            _stable_json(b.get("numerator_filter")) if b.get("numerator_filter") is not None else None,
                            _stable_json(b.get("denominator_filter")) if b.get("denominator_filter") is not None else None,
                            b.get("frequency"),
                            bool(b.get("is_optional") or False),
                        ],
                    )
                    for w in b.get("windows") or []:
                        conn.execute(
                            """
                            INSERT INTO scenario_metric_windows (scenario_id, metric_id, window_spec, enabled)
                            VALUES (?, ?, ?, TRUE)
                            """,
                            [scenario_id, metric_id, str(w)],
                        )

    def list_scenarios(self, ownership: Optional[str] = None, status: Optional[str] = "ACTIVE") -> List[Dict[str, Any]]:
        with duckdb_pool.connection(self.db_path, read_only=True) as conn:
            q = """
                SELECT scenario_id, name, description, entity_level, ownership, status, created_by, created_at, version
                FROM scenarios
                WHERE 1=1
            """
            params: List[Any] = []
            if ownership:
                q += " AND ownership = ?"
                params.append(str(ownership))
            if status:
                q += " AND status = ?"
                params.append(str(status))
            q += " ORDER BY ownership ASC, name ASC"
            rows = conn.execute(q, params).fetchall()
        return [
            {
                "scenario_id": r[0],
                "name": r[1],
                "description": r[2],
                "entity_level": r[3],
                "ownership": r[4],
                "status": r[5],
                "created_by": r[6],
                "created_at": str(r[7]) if r[7] is not None else None,
                "version": int(r[8] or 1),
            }
            for r in rows
        ]

    def get_scenario(self, scenario_id: str) -> Dict[str, Any]:
        with duckdb_pool.connection(self.db_path, read_only=True) as conn:
            row = conn.execute(
                """
                SELECT scenario_id, name, description, entity_level, ownership, status, created_by, created_at, version, scenario_json
                FROM scenarios
                WHERE scenario_id = ?
                """,
                [str(scenario_id)],
            ).fetchone()
            if not row:
                raise ValueError("Scenario not found")
            metrics = conn.execute(
                """
                SELECT metric_id, metric_family, aggregation_type, column_name, numerator_filter_json, denominator_filter_json, frequency, is_optional
                FROM scenario_metrics
                WHERE scenario_id = ?
                ORDER BY metric_id
                """,
                [str(scenario_id)],
            ).fetchall()
            windows = conn.execute(
                """
                SELECT metric_id, window_spec, enabled
                FROM scenario_metric_windows
                WHERE scenario_id = ?
                ORDER BY metric_id, window_spec
                """,
                [str(scenario_id)],
            ).fetchall()
        win_map: Dict[str, List[str]] = {}
        for m, w, en in windows:
            if not bool(en):
                continue
            win_map.setdefault(str(m), []).append(str(w))
        metric_objs = []
        for m in metrics:
            metric_id = str(m[0])
            metric_objs.append(
                {
                    "metric_id": metric_id,
                    "metric_family": m[1],
                    "aggregation_type": m[2],
                    "column_name": m[3],
                    "numerator_filter": json.loads(m[4]) if m[4] else None,
                    "denominator_filter": json.loads(m[5]) if m[5] else None,
                    "frequency": m[6],
                    "is_optional": bool(m[7]),
                    "windows": win_map.get(metric_id, []),
                }
            )
        return {
            "scenario_id": row[0],
            "name": row[1],
            "description": row[2],
            "entity_level": row[3],
            "ownership": row[4],
            "status": row[5],
            "created_by": row[6],
            "created_at": str(row[7]) if row[7] is not None else None,
            "version": int(row[8] or 1),
            "scenario_json": json.loads(row[9]) if row[9] else None,
            "metrics": metric_objs,
        }

    def create_user_scenario(
        self,
        *,
        scenario_id: str,
        name: str,
        description: Optional[str],
        entity_level: str,
        created_by: str,
        scenario_json: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        scenario_id = str(scenario_id).strip()
        if not scenario_id:
            raise ValueError("scenario_id required")
        with duckdb_pool.connection(self.db_path) as conn:
            exists = conn.execute("SELECT 1 FROM scenarios WHERE scenario_id = ? LIMIT 1", [scenario_id]).fetchone()
            if exists:
                raise ValueError("scenario_id already exists")
            conn.execute(
                """
                INSERT INTO scenarios (scenario_id, name, description, entity_level, ownership, status, created_by, version, scenario_json)
                VALUES (?, ?, ?, ?, 'USER', 'ACTIVE', ?, 1, ?)
                """,
                [
                    scenario_id,
                    str(name),
                    description,
                    str(entity_level),
                    str(created_by),
                    _stable_json(scenario_json) if scenario_json is not None else None,
                ],
            )
        return self.get_scenario(scenario_id)
