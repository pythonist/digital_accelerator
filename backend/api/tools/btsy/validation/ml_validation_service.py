from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import json
import math

import duckdb
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.cluster import DBSCAN
from sklearn.decomposition import PCA
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

from api.tools.btsy.duckdb_pool import duckdb_pool


class MLValidationService:
    def __init__(self, workbench_db_path: Path):
        self.db_path = workbench_db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _ensure_schema(self):
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ml_validation_runs (
                  ml_run_id INTEGER PRIMARY KEY,
                  session_id INTEGER NOT NULL,
                  boundary_id INTEGER NOT NULL,
                  algorithm TEXT DEFAULT 'isolation_forest',
                  training_mode TEXT NOT NULL,
                  n_estimators INTEGER NOT NULL,
                  contamination DOUBLE NOT NULL,
                  max_samples TEXT,
                  random_state INTEGER NOT NULL,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ml_anomaly_scores (
                  ml_run_id INTEGER NOT NULL,
                  entity_id TEXT NOT NULL,
                  aggregated_value DOUBLE,
                  population_label TEXT NOT NULL,
                  anomaly_score DOUBLE NOT NULL,
                  score_percentile DOUBLE NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ml_evidence_summary (
                  ml_run_id INTEGER NOT NULL,
                  analyst_note TEXT NOT NULL,
                  support_level TEXT NOT NULL,
                  limitations TEXT,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ml_run_metrics (
                  ml_run_id INTEGER NOT NULL,
                  metrics_json TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS dbscan_validation_runs (
                  dbscan_run_id INTEGER PRIMARY KEY,
                  session_id INTEGER NOT NULL,
                  boundary_id INTEGER NOT NULL,
                  eps DOUBLE NOT NULL,
                  min_samples INTEGER NOT NULL,
                  pca_method TEXT DEFAULT 'pca',
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS dbscan_points (
                  dbscan_run_id INTEGER NOT NULL,
                  entity_id TEXT NOT NULL,
                  pc1 DOUBLE,
                  pc2 DOUBLE,
                  cluster_id INTEGER,
                  is_noise BOOLEAN,
                  population_label TEXT,
                  aggregated_value DOUBLE,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS dbscan_cluster_summary (
                  dbscan_run_id INTEGER NOT NULL,
                  cluster_id INTEGER NOT NULL,
                  cluster_size INTEGER,
                  atl_pct DOUBLE,
                  interpretation_label TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS dbscan_kdistance_points (
                  dbscan_run_id INTEGER NOT NULL,
                  k INTEGER NOT NULL,
                  rank INTEGER NOT NULL,
                  distance DOUBLE,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS dbscan_run_metrics (
                  dbscan_run_id INTEGER NOT NULL,
                  metrics_json TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS dbscan_evidence_summary (
                  dbscan_run_id INTEGER NOT NULL,
                  analyst_note TEXT NOT NULL,
                  support_level TEXT NOT NULL,
                  limitations TEXT,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ml_recommendation_packs (
                  pack_id INTEGER PRIMARY KEY,
                  session_id INTEGER NOT NULL,
                  boundary_id INTEGER NOT NULL,
                  ml_run_id INTEGER,
                  dbscan_run_id INTEGER,
                  pack_json TEXT NOT NULL,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            try:
                conn.execute("ALTER TABLE ml_validation_runs ADD COLUMN algorithm TEXT DEFAULT 'isolation_forest'")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE ml_validation_runs ADD COLUMN max_samples TEXT")
            except Exception:
                pass

    def _next_id(self, conn: duckdb.DuckDBPyConnection, table_name: str, pk_column: str) -> int:
        row = conn.execute(f"SELECT COALESCE(MAX({pk_column}), 0) + 1 FROM {table_name}").fetchone()
        v = int(row[0] or 1) if row else 1
        return v if v >= 1 else 1

    def _log_event(self, session_id: int, event_type: str, event: Dict, created_by: Optional[str]):
        with duckdb_pool.connection(self.db_path) as conn:
            event_id = self._next_id(conn, "calibration_event_log", "event_id")
            conn.execute(
                "INSERT INTO calibration_event_log (event_id, session_id, event_type, event_json, created_by) VALUES (?, ?, ?, ?, ?)",
                [event_id, session_id, event_type, json.dumps(event or {}), created_by]
            )

    def _get_session_meta(self, session_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            s = conn.execute("""
                SELECT behavior_run_id, metric_name, window_spec, entity_level
                FROM calibration_sessions
                WHERE session_id = ?
            """, [session_id]).fetchone()
            if not s:
                raise ValueError("Session not found")
            agg = conn.execute("""
                SELECT entity_collapse, time_lens, sustained_days
                FROM aggregation_configs
                WHERE session_id = ?
            """, [session_id]).fetchone()
            return {
                'behavior_run_id': int(s[0]),
                'signal_name': s[1],
                'window': s[2],
                'entity_level': s[3],
                'entity_collapse': (agg[0] if agg else 'max'),
                'time_lens': (agg[1] if agg else 'full'),
                'sustained_days': int(agg[2]) if agg and agg[2] is not None else 3,
                'aggregation_lens': f"entity={(agg[0] if agg else 'max')};time={(agg[1] if agg else 'full')};n={(int(agg[2]) if agg and agg[2] is not None else 3)}"
            }

    def _get_boundary(self, session_id: int, boundary_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            b = conn.execute("""
                SELECT boundary_id, strategy_id, buffer_type, buffer_params_json, aggregation_lens
                FROM risk_boundary_definitions
                WHERE session_id = ? AND boundary_id = ?
            """, [session_id, boundary_id]).fetchone()
            if not b:
                raise ValueError("Boundary not found")
            agg = conn.execute("""
                SELECT entity_collapse, time_lens, sustained_days
                FROM aggregation_configs
                WHERE session_id = ?
            """, [session_id]).fetchone()
            entity_collapse = (agg[0] if agg else 'max')
            time_lens = (agg[1] if agg else 'full')
            sustained_days = int(agg[2]) if agg and agg[2] is not None else 3
            current_lens = f"entity={entity_collapse};time={time_lens};n={sustained_days}"
            stored_lens = b[4]
            if stored_lens and stored_lens != current_lens:
                raise ValueError("No boundary exists for the selected behaviour + aggregation lens in this session.")
            s = conn.execute("""
                SELECT strategy_id, name, threshold_value
                FROM threshold_strategies
                WHERE session_id = ? AND strategy_id = ?
            """, [session_id, int(b[1])]).fetchone()
            if not s:
                raise ValueError("Boundary strategy not found")
            return {
                'boundary_id': int(b[0]),
                'strategy_id': int(s[0]),
                'strategy_name': s[1],
                'threshold_value': float(s[2] or 0.0),
                'buffer_type': b[2],
                'buffer_params': json.loads(b[3]) if b[3] else {}
            }

    def _boundary_thresholds(self, threshold_value: float, buffer_type: str, buffer_params: Dict) -> Tuple[float, float]:
        bt = (buffer_type or 'hard').lower()
        if bt == 'hard':
            return float(threshold_value), float(threshold_value)
        band_pct = float((buffer_params or {}).get('band_pct', 2.0))
        band_pct = max(0.0, min(50.0, band_pct))
        lower = float(threshold_value) * (1.0 - band_pct / 100.0)
        upper = float(threshold_value) * (1.0 + band_pct / 100.0)
        return float(lower), float(upper)

    def _agg_query(self, behavior_run_id: int, signal_name: str, entity_collapse: str, time_lens: str, sustained_days: int) -> str:
        entity_collapse = (entity_collapse or 'max').lower()
        time_lens = (time_lens or 'full').lower()
        metric_filter = f"behavior_run_id = {int(behavior_run_id)}"
        if signal_name:
            metric_filter += " AND metric_name = '" + signal_name.replace("'", "''") + "'"

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

    def _fetch_population(self, behavior_db_path: Path, meta: Dict, lower: float, upper: float) -> Dict:
        agg_query = self._agg_query(meta['behavior_run_id'], meta['signal_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])
        with duckdb_pool.connection(behavior_db_path) as conn:
            rows = conn.execute(f"""
                WITH agg AS ({agg_query})
                SELECT entity_id, aggregated_value,
                  CASE
                    WHEN aggregated_value >= {float(upper)} THEN 'ATL'
                    WHEN aggregated_value < {float(lower)} THEN 'BTL'
                    ELSE 'BUFFER'
                  END AS pop
                FROM agg
                WHERE aggregated_value IS NOT NULL
            """).fetchall()
        entities = []
        values = []
        labels = []
        for e, v, p in rows:
            if p == 'BUFFER':
                continue
            entities.append(e)
            values.append(float(v or 0.0))
            labels.append(p)
        return {'entity_ids': entities, 'values': np.array(values, dtype=float), 'labels': labels}

    def _contamination(self, atl_count: int, total_count: int, training_mode: str) -> float:
        if total_count <= 0:
            return 0.05
        base = float(atl_count) / float(total_count)
        base = max(0.01, min(0.2, base))
        if (training_mode or '').lower() == 'btl':
            return max(0.01, min(0.1, base * 0.5))
        return base

    def _normalize_max_samples(self, v) -> str:
        if v is None:
            return 'auto'
        if isinstance(v, str):
            s = v.strip().lower()
            if not s:
                return 'auto'
            if s == 'auto':
                return 'auto'
            try:
                f = float(s)
                if f > 0 and f <= 1.0:
                    return str(f)
            except Exception:
                pass
            try:
                i = int(float(s))
                if i > 0:
                    return str(i)
            except Exception:
                pass
            return 'auto'
        try:
            f = float(v)
            if f > 0 and f <= 1.0:
                return str(f)
        except Exception:
            pass
        try:
            i = int(v)
            if i > 0:
                return str(i)
        except Exception:
            pass
        return 'auto'

    def _max_samples_to_model(self, v: str, n: int):
        s = (v or 'auto').strip().lower()
        if s == 'auto':
            return 'auto'
        try:
            f = float(s)
            if f > 0 and f <= 1.0:
                return f
        except Exception:
            pass
        try:
            i = int(float(s))
            return min(max(1, i), max(1, int(n)))
        except Exception:
            return 'auto'

    def _score(self, values: np.ndarray, train_mask: np.ndarray, contamination: float, n_estimators: int, max_samples: str, random_state: int) -> Tuple[np.ndarray, IsolationForest]:
        x = values.reshape(-1, 1)
        train_x = x[train_mask]
        if train_x.shape[0] < 10:
            raise ValueError("Insufficient training entities")
        model = IsolationForest(
            n_estimators=int(n_estimators),
            contamination=contamination,
            max_samples=self._max_samples_to_model(max_samples, int(train_x.shape[0])),
            random_state=int(random_state),
            n_jobs=-1
        )
        model.fit(train_x)
        raw = model.score_samples(x)
        scores = -raw
        return scores, model

    def _summary(self, scores: np.ndarray, labels: List[str]) -> Dict:
        arr = np.array(scores, dtype=float)
        atl = arr[[i for i, v in enumerate(labels) if v == 'ATL']]
        btl = arr[[i for i, v in enumerate(labels) if v == 'BTL']]
        def stats(x: np.ndarray) -> Dict:
            if x.size == 0:
                return {'count': 0}
            return {
                'count': int(x.size),
                'mean': float(np.mean(x)),
                'median': float(np.median(x)),
                'p95': float(np.percentile(x, 95)),
                'p99': float(np.percentile(x, 99))
            }
        return {
            'atl': stats(atl),
            'btl': stats(btl),
            'total': int(arr.size)
        }

    def _tail_stats(self, scores: np.ndarray, labels: List[str], tails: List[float]) -> List[Dict]:
        arr = np.array(scores, dtype=float)
        res = []
        for t in tails:
            pct = max(0.0, min(100.0, float(t)))
            cut = np.percentile(arr, 100.0 - pct) if arr.size > 0 else 0.0
            atl_count = 0
            total_atl = sum(1 for v in labels if v == 'ATL')
            for s, lab in zip(arr, labels):
                if lab == 'ATL' and s >= cut:
                    atl_count += 1
            res.append({
                'tail_pct': pct,
                'atl_in_tail': int(atl_count),
                'atl_total': int(total_atl),
                'atl_tail_pct': float(atl_count / total_atl * 100.0) if total_atl else 0.0
            })
        return res

    def _histogram(self, scores: np.ndarray, labels: List[str], bins: int = 50) -> Dict:
        arr = np.asarray(scores, dtype=float)
        if arr.size == 0:
            return {'bins': [], 'line_value': None}
        atl = arr[[i for i, v in enumerate(labels) if v == 'ATL']]
        btl = arr[[i for i, v in enumerate(labels) if v == 'BTL']]
        minv = float(np.min(arr))
        maxv = float(np.max(arr))
        if minv == maxv:
            maxv = minv + 1e-9
        edges = np.linspace(minv, maxv, int(bins) + 1)
        a_hist, _ = np.histogram(atl, bins=edges, density=True) if atl.size else (np.zeros(int(bins)), edges)
        b_hist, _ = np.histogram(btl, bins=edges, density=True) if btl.size else (np.zeros(int(bins)), edges)
        xs = (edges[:-1] + edges[1:]) / 2.0
        out = []
        for x, ad, bd in zip(xs, a_hist, b_hist):
            out.append({'x': float(x), 'atl_density': float(ad), 'btl_density': float(bd)})
        return {'bins': out}

    def _step3_vs_if(self, entity_ids: List[str], labels: List[str], scores: np.ndarray) -> Dict:
        atl_ids = {e for e, lab in zip(entity_ids, labels) if lab == 'ATL'}
        k = len(atl_ids)
        order = np.argsort(-np.asarray(scores, dtype=float))
        top_idx = order[:k] if k > 0 else np.array([], dtype=int)
        if_ids = {entity_ids[int(i)] for i in top_idx}
        inter = len(atl_ids & if_ids)
        missed = len(atl_ids - if_ids)
        extra = len(if_ids - atl_ids)
        overlap_pct = float(inter / len(atl_ids) * 100.0) if atl_ids else 0.0
        return {
            'step3_atl_size': int(len(atl_ids)),
            'if_topk_size': int(len(if_ids)),
            'overlap_pct': float(overlap_pct),
            'missed_atl': int(missed),
            'extra_noise': int(extra)
        }

    def training_preview(self, behavior_db_path: Path, session_id: int, boundary_id: int) -> Dict:
        meta = self._get_session_meta(session_id)
        boundary = self._get_boundary(session_id, boundary_id)
        lower, upper = self._boundary_thresholds(boundary['threshold_value'], boundary['buffer_type'], boundary['buffer_params'])
        population = self._fetch_population(behavior_db_path, meta, lower, upper)
        labels = population['labels']
        atl_count = sum(1 for v in labels if v == 'ATL')
        btl_count = sum(1 for v in labels if v == 'BTL')
        return {
            'context': {
                'session_id': int(session_id),
                'boundary_id': int(boundary_id),
                'aggregation_lens': meta['aggregation_lens'],
                'window': meta['window'],
                'signal_name': meta['signal_name'],
                'entity_level': meta['entity_level'],
                'thresholds': {'lower': float(lower), 'upper': float(upper)}
            },
            'counts': {
                'total': int(len(labels)),
                'atl': int(atl_count),
                'btl': int(btl_count)
            }
        }

    def preview(self, behavior_db_path: Path, session_id: int, boundary_id: int, training_mode: str, params: Optional[Dict] = None) -> Dict:
        meta = self._get_session_meta(session_id)
        boundary = self._get_boundary(session_id, boundary_id)
        lower, upper = self._boundary_thresholds(boundary['threshold_value'], boundary['buffer_type'], boundary['buffer_params'])
        population = self._fetch_population(behavior_db_path, meta, lower, upper)
        values = population['values']
        labels = population['labels']
        atl_count = sum(1 for v in labels if v == 'ATL')
        btl_count = sum(1 for v in labels if v == 'BTL')
        train_mask = np.array([v == 'BTL' for v in labels]) if (training_mode or '').lower() == 'btl' else np.ones(len(labels), dtype=bool)
        p = params or {}
        n_estimators = int(p.get('n_estimators') or 200)
        n_estimators = max(50, min(2000, n_estimators))
        random_state = int(p.get('random_state') if p.get('random_state') is not None else 42)
        max_samples = self._normalize_max_samples(p.get('max_samples'))
        contamination_in = p.get('contamination')
        contamination = float(contamination_in) if contamination_in is not None else self._contamination(atl_count, len(labels), training_mode)
        contamination = max(0.001, min(0.5, float(contamination)))
        scores, _ = self._score(values, train_mask, contamination, n_estimators, max_samples, random_state)
        percentiles = np.array([float(np.mean(scores <= s) * 100.0) for s in scores], dtype=float)
        summary = self._summary(scores, labels)
        tails = self._tail_stats(scores, labels, [1, 2, 5, 10, 20])
        hist = self._histogram(scores, labels, bins=60)
        comp = self._step3_vs_if(population['entity_ids'], labels, scores)
        k = int(comp['step3_atl_size'])
        line_value = None
        if k > 0:
            order = np.argsort(-np.asarray(scores, dtype=float))
            idx = int(order[min(max(0, k - 1), max(0, len(order) - 1))])
            line_value = float(scores[idx])
        return {
            'context': {
                'session_id': int(session_id),
                'boundary_id': int(boundary_id),
                'training_mode': training_mode,
                'aggregation_lens': meta['aggregation_lens'],
                'window': meta['window'],
                'signal_name': meta['signal_name'],
                'entity_level': meta['entity_level']
            },
            'counts': {
                'total': int(len(labels)),
                'atl': int(atl_count),
                'btl': int(btl_count)
            },
            'model': {
                'n_estimators': int(n_estimators),
                'contamination': float(contamination),
                'max_samples': max_samples,
                'random_state': int(random_state),
                'step3_equivalent_score_line': line_value
            },
            'summary': summary,
            'tails': tails,
            'hist': hist,
            'comparison': comp,
            'scores_preview': [{
                'entity_id': e,
                'label': l,
                'score': float(s),
                'percentile': float(p)
            } for e, l, s, p in list(zip(population['entity_ids'], labels, scores, percentiles))[:200]]
        }

    def save_run(self, behavior_db_path: Path, session_id: int, boundary_id: int, training_mode: str, analyst_note: str, support_level: str, limitations: Optional[str], created_by: Optional[str], params: Optional[Dict] = None) -> Dict:
        meta = self._get_session_meta(session_id)
        boundary = self._get_boundary(session_id, boundary_id)
        lower, upper = self._boundary_thresholds(boundary['threshold_value'], boundary['buffer_type'], boundary['buffer_params'])
        population = self._fetch_population(behavior_db_path, meta, lower, upper)
        values = population['values']
        labels = population['labels']
        atl_count = sum(1 for v in labels if v == 'ATL')
        btl_count = sum(1 for v in labels if v == 'BTL')
        train_mask = np.array([v == 'BTL' for v in labels]) if (training_mode or '').lower() == 'btl' else np.ones(len(labels), dtype=bool)
        p = params or {}
        n_estimators = int(p.get('n_estimators') or 200)
        n_estimators = max(50, min(2000, n_estimators))
        random_state = int(p.get('random_state') if p.get('random_state') is not None else 42)
        max_samples = self._normalize_max_samples(p.get('max_samples'))
        contamination_in = p.get('contamination')
        contamination = float(contamination_in) if contamination_in is not None else self._contamination(atl_count, len(labels), training_mode)
        contamination = max(0.001, min(0.5, float(contamination)))
        scores, _ = self._score(values, train_mask, contamination, n_estimators, max_samples, random_state)
        percentiles = np.array([float(np.mean(scores <= s) * 100.0) for s in scores], dtype=float)
        summary = self._summary(scores, labels)
        tails = self._tail_stats(scores, labels, [1, 2, 5, 10, 20])
        hist = self._histogram(scores, labels, bins=60)
        comp = self._step3_vs_if(population['entity_ids'], labels, scores)
        with duckdb_pool.connection(self.db_path) as conn:
            run_id = self._next_id(conn, "ml_validation_runs", "ml_run_id")
            conn.execute("""
                INSERT INTO ml_validation_runs (
                  ml_run_id, session_id, boundary_id, algorithm, training_mode,
                  n_estimators, contamination, max_samples, random_state, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                int(run_id),
                int(session_id),
                int(boundary_id),
                'isolation_forest',
                training_mode,
                int(n_estimators),
                float(contamination),
                max_samples,
                int(random_state),
                created_by,
            ])
            rows = [(int(run_id), e, float(v), lab, float(s), float(p)) for e, v, lab, s, p in zip(population['entity_ids'], values, labels, scores, percentiles)]
            if rows:
                conn.executemany("""
                    INSERT INTO ml_anomaly_scores (
                      ml_run_id, entity_id, aggregated_value, population_label, anomaly_score, score_percentile
                    ) VALUES (?, ?, ?, ?, ?, ?)
                """, rows)
            conn.execute("""
                INSERT INTO ml_evidence_summary (
                  ml_run_id, analyst_note, support_level, limitations, created_by
                ) VALUES (?, ?, ?, ?, ?)
            """, [int(run_id), analyst_note, support_level, limitations, created_by])
            conn.execute(
                "INSERT INTO ml_run_metrics (ml_run_id, metrics_json) VALUES (?, ?)",
                [
                    int(run_id),
                    json.dumps(
                        {
                            'summary': summary,
                            'tails': tails,
                            'hist': hist,
                            'comparison': comp,
                            'model': {
                                'n_estimators': int(n_estimators),
                                'contamination': float(contamination),
                                'max_samples': max_samples,
                                'random_state': int(random_state),
                            },
                        }
                    ),
                ],
            )
        self._log_event(session_id, 'ml_validation_saved', {
            'ml_run_id': int(run_id),
            'boundary_id': int(boundary_id),
            'training_mode': training_mode,
            'summary': summary
        }, created_by)
        return self.get_run(int(run_id))

    def list_runs(self, session_id: int) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT ml_run_id, session_id, boundary_id, training_mode, n_estimators, contamination, random_state, created_by, created_at
                FROM ml_validation_runs
                WHERE session_id = ?
                ORDER BY ml_run_id DESC
            """, [session_id]).fetchall()
            return [{
                'ml_run_id': int(r[0]),
                'session_id': int(r[1]),
                'boundary_id': int(r[2]),
                'training_mode': r[3],
                'n_estimators': int(r[4]),
                'contamination': float(r[5]),
                'random_state': int(r[6]),
                'created_by': r[7],
                'created_at': str(r[8])
            } for r in rows]

    def get_run(self, ml_run_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            r = conn.execute("""
                SELECT ml_run_id, session_id, boundary_id, algorithm, training_mode, n_estimators, contamination, max_samples, random_state, created_by, created_at
                FROM ml_validation_runs
                WHERE ml_run_id = ?
            """, [ml_run_id]).fetchone()
            if not r:
                raise ValueError("ML run not found")
            ev = conn.execute("""
                SELECT analyst_note, support_level, limitations, created_by, created_at
                FROM ml_evidence_summary
                WHERE ml_run_id = ?
            """, [ml_run_id]).fetchone()
            stats = conn.execute("""
                SELECT
                  SUM(CASE WHEN population_label = 'ATL' THEN 1 ELSE 0 END) AS atl,
                  SUM(CASE WHEN population_label = 'BTL' THEN 1 ELSE 0 END) AS btl
                FROM ml_anomaly_scores
                WHERE ml_run_id = ?
            """, [ml_run_id]).fetchone()
            metrics_row = conn.execute(
                "SELECT metrics_json FROM ml_run_metrics WHERE ml_run_id = ? ORDER BY created_at DESC LIMIT 1",
                [ml_run_id],
            ).fetchone()
            return {
                'run': {
                    'ml_run_id': int(r[0]),
                    'session_id': int(r[1]),
                    'boundary_id': int(r[2]),
                    'algorithm': r[3],
                    'training_mode': r[4],
                    'n_estimators': int(r[5]),
                    'contamination': float(r[6]),
                    'max_samples': r[7],
                    'random_state': int(r[8]),
                    'created_by': r[9],
                    'created_at': str(r[10])
                },
                'evidence': None if not ev else {
                    'analyst_note': ev[0],
                    'support_level': ev[1],
                    'limitations': ev[2],
                    'created_by': ev[3],
                    'created_at': str(ev[4])
                },
                'counts': {
                    'atl': int(stats[0] or 0),
                    'btl': int(stats[1] or 0)
                },
                'metrics': json.loads(metrics_row[0]) if metrics_row and metrics_row[0] else None
            }

    def delete_run(self, session_id: int, ml_run_id: int, created_by: Optional[str]):
        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute("SELECT session_id FROM ml_validation_runs WHERE ml_run_id = ?", [ml_run_id]).fetchone()
            if not row:
                raise ValueError("ML run not found")
            if int(row[0]) != int(session_id):
                raise ValueError("ML run does not belong to session")
            conn.execute("DELETE FROM ml_anomaly_scores WHERE ml_run_id = ?", [ml_run_id])
            conn.execute("DELETE FROM ml_evidence_summary WHERE ml_run_id = ?", [ml_run_id])
            conn.execute("DELETE FROM ml_run_metrics WHERE ml_run_id = ?", [ml_run_id])
            conn.execute("DELETE FROM ml_validation_runs WHERE ml_run_id = ?", [ml_run_id])
        self._log_event(session_id, 'ml_validation_deleted', {'ml_run_id': int(ml_run_id)}, created_by)

    def coverage_map(self, ml_run_id: int) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT score_percentile, population_label
                FROM ml_anomaly_scores
                WHERE ml_run_id = ?
            """, [ml_run_id]).fetchall()
        if not rows:
            return []
        bands = {i: {'atl': 0, 'btl': 0, 'total': 0} for i in range(10)}
        for pct, label in rows:
            idx = min(9, max(0, int(float(pct or 0.0) // 10)))
            bands[idx]['total'] += 1
            if label == 'ATL':
                bands[idx]['atl'] += 1
            else:
                bands[idx]['btl'] += 1
        out = []
        for i in range(10):
            band = bands[i]
            total = band['total'] or 0
            atl_pct = float(band['atl'] / total * 100.0) if total else 0.0
            label = f"{i * 10}-{i * 10 + 10}%"
            out.append({
                'band': label,
                'atl_pct': float(atl_pct),
                'btl_pct': float(100.0 - atl_pct) if total else 0.0,
                'count': int(total),
                'blind_spot': True if i >= 8 and atl_pct < 20.0 else False
            })
        return out

    def cbp(self, behavior_db_path: Path, session_id: int, boundary_id: int, entity_id: Optional[str], band_low: Optional[float], band_high: Optional[float]) -> Dict:
        meta = self._get_session_meta(session_id)
        boundary = self._get_boundary(session_id, boundary_id)
        lower, upper = self._boundary_thresholds(boundary['threshold_value'], boundary['buffer_type'], boundary['buffer_params'])
        agg_query = self._agg_query(meta['behavior_run_id'], meta['signal_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])
        with duckdb_pool.connection(behavior_db_path) as conn:
            total = int(conn.execute(f"SELECT COUNT(*) FROM ({agg_query})").fetchone()[0] or 0)
            below = int(conn.execute(f"SELECT COUNT(*) FROM ({agg_query}) WHERE aggregated_value <= {float(boundary['threshold_value'])}").fetchone()[0] or 0)
            pct = float(below / total) if total else 0.5
            metric_names = [r[0] for r in conn.execute("""
                SELECT DISTINCT metric_name
                FROM behavior_table
                WHERE behavior_run_id = ?
                ORDER BY metric_name
            """, [meta['behavior_run_id']]).fetchall()]
        results = []
        for metric in metric_names:
            metric_query = self._agg_query(meta['behavior_run_id'], metric, meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])
            with duckdb_pool.connection(behavior_db_path) as conn:
                if entity_id:
                    row = conn.execute(f"""
                        SELECT aggregated_value FROM ({metric_query})
                        WHERE entity_id = ?
                    """, [entity_id]).fetchone()
                    if not row:
                        continue
                    value = float(row[0] or 0.0)
                else:
                    low = float(band_low or 90.0) / 100.0
                    high = float(band_high or 95.0) / 100.0
                    mid = max(0.0, min(1.0, (low + high) / 2.0))
                    row = conn.execute(f"SELECT quantile(aggregated_value, {mid}) FROM ({metric_query})").fetchone()
                    value = float(row[0] or 0.0)
                threshold_row = conn.execute(f"SELECT quantile(aggregated_value, {pct}) FROM ({metric_query})").fetchone()
                threshold_value = float(threshold_row[0] or 0.0)
            lower_m, upper_m = self._boundary_thresholds(threshold_value, boundary['buffer_type'], boundary['buffer_params'])
            if value >= upper_m:
                target = lower_m
                direction = 'decrease'
                delta = (value - target) / value * 100.0 if value != 0 else 0.0
                outcome = 'ATL→BTL'
            elif value < lower_m:
                target = upper_m
                direction = 'increase'
                delta = (target - value) / abs(value) * 100.0 if value != 0 else 0.0
                outcome = 'BTL→ATL'
            else:
                target = upper_m
                direction = 'increase'
                delta = (target - value) / abs(value) * 100.0 if value != 0 else 0.0
                outcome = 'BUFFER→ATL'
            results.append({
                'metric_name': metric,
                'current_value': float(value),
                'threshold_value': float(threshold_value),
                'direction': direction,
                'delta_pct': float(delta),
                'outcome': outcome
            })
        return {
            'session_id': int(session_id),
            'boundary_id': int(boundary_id),
            'target': entity_id or f"band_{band_low}-{band_high}",
            'results': results
        }

    def evidence_drift(self) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            sessions = conn.execute("""
                SELECT session_id, created_at
                FROM calibration_sessions
                ORDER BY session_id ASC
            """).fetchall()
            out = []
            for sid, created_at in sessions:
                ks = conn.execute("""
                    SELECT MAX(ks_stat)
                    FROM ks_results
                    WHERE ks_run_id = (
                        SELECT MAX(ks_run_id) FROM ks_validation_runs WHERE session_id = ?
                    )
                """, [sid]).fetchone()
                js = conn.execute("""
                    SELECT MAX(max_j)
                    FROM calibration_step36_results
                    WHERE session_id = ?
                """, [sid]).fetchone()
                ml_run = conn.execute("""
                    SELECT ml_run_id
                    FROM ml_validation_runs
                    WHERE session_id = ?
                    ORDER BY ml_run_id DESC
                    LIMIT 1
                """, [sid]).fetchone()
                ml_atl = None
                if ml_run:
                    ml_atl = conn.execute("""
                        SELECT AVG(anomaly_score)
                        FROM ml_anomaly_scores
                        WHERE ml_run_id = ? AND population_label = 'ATL'
                    """, [ml_run[0]]).fetchone()
                out.append({
                    'session_id': int(sid),
                    'created_at': str(created_at),
                    'ks_stat': float(ks[0]) if ks and ks[0] is not None else None,
                    'max_j': float(js[0]) if js and js[0] is not None else None,
                    'atl_mean_score': float(ml_atl[0]) if ml_atl and ml_atl[0] is not None else None
                })
            return out

    def report_section(self, session_id: int, ml_run_id: int, created_by: Optional[str]) -> Dict:
        run = self.get_run(ml_run_id)
        evidence = run.get('evidence') or {}
        section = {
            'title': 'Independent Machine Learning Validation (Optional)',
            'method': 'Isolation Forest',
            'training_population': run['run']['training_mode'],
            'boundary_id': run['run']['boundary_id'],
            'support_level': evidence.get('support_level'),
            'analyst_note': evidence.get('analyst_note'),
            'limitations': evidence.get('limitations'),
            'disclaimer': 'This analysis was not used for alerting or threshold setting.'
        }
        with duckdb_pool.connection(self.db_path) as conn:
            evidence_id = self._next_id(conn, "scenario_evidence_snapshots", "evidence_id")
            conn.execute("""
                INSERT INTO scenario_evidence_snapshots (evidence_id, session_id, section, data_json)
                VALUES (?, ?, ?, ?)
            """, [evidence_id, session_id, section['title'], json.dumps(section)])
        self._log_event(session_id, 'ml_validation_reported', {'ml_run_id': int(ml_run_id)}, created_by)
        return section

    def _feature_matrix(self, behavior_db_path: Path, meta: Dict, boundary: Dict, lower: float, upper: float, max_metrics: int = 8) -> Dict:
        base = self._fetch_population(behavior_db_path, meta, lower, upper)
        entity_ids = list(base['entity_ids'])
        labels = list(base['labels'])
        base_signal = meta.get('signal_name') or ''
        with duckdb_pool.connection(behavior_db_path) as conn:
            mrows = conn.execute(
                """
                SELECT DISTINCT metric_name
                FROM behavior_table
                WHERE behavior_run_id = ?
                ORDER BY metric_name
                """,
                [meta['behavior_run_id']],
            ).fetchall()
        metric_names = [r[0] for r in (mrows or []) if r and r[0]]
        metric_names = [m for m in metric_names if m != base_signal]
        metric_names = ([base_signal] if base_signal else []) + metric_names
        metric_names = metric_names[: max(1, int(max_metrics))]

        values_by_metric: Dict[str, Dict[str, float]] = {m: {} for m in metric_names}
        with duckdb_pool.connection(behavior_db_path) as conn:
            for m in metric_names:
                q = self._agg_query(meta['behavior_run_id'], m, meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])
                rows = conn.execute(f"SELECT entity_id, aggregated_value FROM ({q}) WHERE aggregated_value IS NOT NULL").fetchall()
                mm = values_by_metric.get(m)
                for eid, val in rows:
                    if eid is None:
                        continue
                    mm[str(eid)] = float(val or 0.0)

        x = np.zeros((len(entity_ids), len(metric_names)), dtype=float)
        for i, eid in enumerate(entity_ids):
            k = str(eid)
            for j, m in enumerate(metric_names):
                x[i, j] = float(values_by_metric[m].get(k, 0.0))
        return {'entity_ids': entity_ids, 'labels': labels, 'x': x, 'feature_names': metric_names}

    def dbscan_preview(self, behavior_db_path: Path, session_id: int, boundary_id: int, eps: float, min_samples: int) -> Dict:
        meta = self._get_session_meta(session_id)
        boundary = self._get_boundary(session_id, boundary_id)
        lower, upper = self._boundary_thresholds(boundary['threshold_value'], boundary['buffer_type'], boundary['buffer_params'])
        eps = float(eps)
        min_samples = int(min_samples)
        if eps <= 0:
            raise ValueError("eps must be > 0")
        if min_samples < 2:
            raise ValueError("min_samples must be >= 2")

        feat = self._feature_matrix(behavior_db_path, meta, boundary, lower, upper, max_metrics=8)
        x = feat['x']
        labels = feat['labels']
        entity_ids = feat['entity_ids']
        if x.shape[0] < int(min_samples):
            raise ValueError("min_samples must be <= number of entities in the population")
        scaler = StandardScaler()
        xs = scaler.fit_transform(x) if x.size else x

        if xs.shape[1] >= 2:
            pca = PCA(n_components=2, random_state=42)
            proj = pca.fit_transform(xs)
        else:
            proj = np.zeros((xs.shape[0], 2), dtype=float)
            if xs.shape[0] > 0:
                proj[:, 0] = xs[:, 0]

        nn = NearestNeighbors(n_neighbors=min_samples)
        nn.fit(xs)
        dists, _ = nn.kneighbors(xs)
        kth = np.sort(dists[:, -1]) if dists.size else np.array([], dtype=float)
        kd = [{'rank': int(i + 1), 'distance': float(v)} for i, v in enumerate(kth[: min(500, kth.size)])]
        eps_suggestion = {
            'q90': float(np.quantile(kth, 0.90)) if kth.size else None,
            'q95': float(np.quantile(kth, 0.95)) if kth.size else None,
            'q99': float(np.quantile(kth, 0.99)) if kth.size else None,
        }

        db = DBSCAN(eps=eps, min_samples=min_samples)
        clusters = db.fit_predict(xs) if xs.size else np.array([], dtype=int)

        points = []
        for eid, lab, p, c in zip(entity_ids, labels, proj, clusters):
            points.append(
                {
                    'entity_id': str(eid),
                    'pc1': float(p[0]),
                    'pc2': float(p[1]),
                    'cluster_id': int(c),
                    'is_noise': bool(int(c) == -1),
                    'population_label': lab,
                }
            )

        cluster_summary = []
        unique = sorted({int(c) for c in clusters if int(c) != -1})
        for cid in unique:
            idx = [i for i, c in enumerate(clusters) if int(c) == int(cid)]
            size = int(len(idx))
            atl = sum(1 for i in idx if labels[i] == 'ATL')
            atl_pct = float(atl / size * 100.0) if size else 0.0
            if atl_pct >= 70:
                label = 'ATL-concentrated cluster'
            elif atl_pct >= 40:
                label = 'Mixed cluster'
            else:
                label = 'BTL-dominant cluster'
            cluster_summary.append(
                {
                    'cluster_id': int(cid),
                    'cluster_size': size,
                    'atl_pct': float(atl_pct),
                    'interpretation_label': label,
                }
            )

        atl_total = sum(1 for v in labels if v == 'ATL')
        atl_in_noise = sum(1 for v, c in zip(labels, clusters) if v == 'ATL' and int(c) == -1)
        atl_noise_pct = float(atl_in_noise / atl_total * 100.0) if atl_total else 0.0

        metrics = {
            'n_entities': int(len(entity_ids)),
            'n_features': int(x.shape[1]),
            'feature_names': feat['feature_names'],
            'n_clusters': int(len(unique)),
            'noise_pct': float(sum(1 for c in clusters if int(c) == -1) / max(1, len(clusters)) * 100.0) if len(clusters) else 0.0,
            'atl_noise_pct': float(atl_noise_pct),
        }

        interpretation = (
            f"DBSCAN grouped entities into {metrics['n_clusters']} clusters with {format(metrics['noise_pct'], '.2f')}% classified as noise. "
            f"{format(metrics['atl_noise_pct'], '.2f')}% of Step-3 ATL entities appear as DBSCAN noise, which may indicate sparse or non-clusterable behaviour."
        )

        return {
            'context': {
                'session_id': int(session_id),
                'boundary_id': int(boundary_id),
                'aggregation_lens': meta['aggregation_lens'],
                'window': meta['window'],
                'signal_name': meta['signal_name'],
                'entity_level': meta['entity_level'],
            },
            'model': {'eps': float(eps), 'min_samples': int(min_samples), 'eps_suggestion': eps_suggestion},
            'k_distance': {'k': int(min_samples), 'points': kd},
            'points': points[:5000],
            'clusters': cluster_summary,
            'metrics': metrics,
            'interpretation': interpretation,
        }

    def dbscan_save_run(self, behavior_db_path: Path, session_id: int, boundary_id: int, eps: float, min_samples: int, analyst_note: str, support_level: str, limitations: Optional[str], created_by: Optional[str]) -> Dict:
        preview = self.dbscan_preview(behavior_db_path, session_id, boundary_id, eps, min_samples)
        with duckdb_pool.connection(self.db_path) as conn:
            run_id = self._next_id(conn, "dbscan_validation_runs", "dbscan_run_id")
            conn.execute(
                """
                INSERT INTO dbscan_validation_runs (
                  dbscan_run_id, session_id, boundary_id, eps, min_samples, pca_method, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [int(run_id), int(session_id), int(boundary_id), float(eps), int(min_samples), 'pca', created_by],
            )
            rows = [
                (
                    int(run_id),
                    p['entity_id'],
                    float(p.get('pc1') or 0.0),
                    float(p.get('pc2') or 0.0),
                    int(p.get('cluster_id') if p.get('cluster_id') is not None else -1),
                    bool(p.get('is_noise')),
                    p.get('population_label'),
                    None,
                )
                for p in (preview.get('points') or [])
            ]
            if rows:
                conn.executemany(
                    """
                    INSERT INTO dbscan_points (
                      dbscan_run_id, entity_id, pc1, pc2, cluster_id, is_noise, population_label, aggregated_value
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    rows,
                )
            crows = [
                (
                    int(run_id),
                    int(c['cluster_id']),
                    int(c['cluster_size']),
                    float(c['atl_pct']),
                    c['interpretation_label'],
                )
                for c in (preview.get('clusters') or [])
            ]
            if crows:
                conn.executemany(
                    """
                    INSERT INTO dbscan_cluster_summary (
                      dbscan_run_id, cluster_id, cluster_size, atl_pct, interpretation_label
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    crows,
                )
            kd = preview.get('k_distance') or {}
            k = int(kd.get('k') or int(min_samples))
            kd_rows = [(int(run_id), k, int(p['rank']), float(p['distance'])) for p in (kd.get('points') or [])]
            if kd_rows:
                conn.executemany(
                    "INSERT INTO dbscan_kdistance_points (dbscan_run_id, k, rank, distance) VALUES (?, ?, ?, ?)",
                    kd_rows,
                )
            conn.execute(
                "INSERT INTO dbscan_run_metrics (dbscan_run_id, metrics_json) VALUES (?, ?)",
                [int(run_id), json.dumps({'metrics': preview.get('metrics'), 'interpretation': preview.get('interpretation')})],
            )
            conn.execute(
                """
                INSERT INTO dbscan_evidence_summary (dbscan_run_id, analyst_note, support_level, limitations, created_by)
                VALUES (?, ?, ?, ?, ?)
                """,
                [int(run_id), analyst_note, support_level, limitations, created_by],
            )

        self._log_event(session_id, 'dbscan_validation_saved', {'dbscan_run_id': int(run_id), 'boundary_id': int(boundary_id)}, created_by)
        return self.get_dbscan_run(int(session_id), int(run_id))

    def list_dbscan_runs(self, session_id: int) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT dbscan_run_id, session_id, boundary_id, eps, min_samples, created_by, created_at
                FROM dbscan_validation_runs
                WHERE session_id = ?
                ORDER BY dbscan_run_id DESC
                LIMIT 200
                """,
                [int(session_id)],
            ).fetchall()
        return [
            {
                'dbscan_run_id': int(r[0]),
                'session_id': int(r[1]),
                'boundary_id': int(r[2]),
                'eps': float(r[3]),
                'min_samples': int(r[4]),
                'created_by': r[5],
                'created_at': str(r[6]),
            }
            for r in rows
        ]

    def get_dbscan_run(self, session_id: int, dbscan_run_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            r = conn.execute(
                """
                SELECT dbscan_run_id, session_id, boundary_id, eps, min_samples, pca_method, created_by, created_at
                FROM dbscan_validation_runs
                WHERE dbscan_run_id = ?
                """,
                [int(dbscan_run_id)],
            ).fetchone()
            if not r or int(r[1]) != int(session_id):
                raise ValueError("DBSCAN run not found")
            ev = conn.execute(
                """
                SELECT analyst_note, support_level, limitations, created_by, created_at
                FROM dbscan_evidence_summary
                WHERE dbscan_run_id = ?
                """,
                [int(dbscan_run_id)],
            ).fetchone()
            metrics_row = conn.execute(
                "SELECT metrics_json FROM dbscan_run_metrics WHERE dbscan_run_id = ? ORDER BY created_at DESC LIMIT 1",
                [int(dbscan_run_id)],
            ).fetchone()
            clusters = conn.execute(
                """
                SELECT cluster_id, cluster_size, atl_pct, interpretation_label
                FROM dbscan_cluster_summary
                WHERE dbscan_run_id = ?
                ORDER BY cluster_size DESC
                """,
                [int(dbscan_run_id)],
            ).fetchall()
        return {
            'run': {
                'dbscan_run_id': int(r[0]),
                'session_id': int(r[1]),
                'boundary_id': int(r[2]),
                'eps': float(r[3]),
                'min_samples': int(r[4]),
                'pca_method': r[5],
                'created_by': r[6],
                'created_at': str(r[7]),
            },
            'evidence': None
            if not ev
            else {
                'analyst_note': ev[0],
                'support_level': ev[1],
                'limitations': ev[2],
                'created_by': ev[3],
                'created_at': str(ev[4]),
            },
            'metrics': json.loads(metrics_row[0]) if metrics_row and metrics_row[0] else None,
            'clusters': [
                {
                    'cluster_id': int(c[0]),
                    'cluster_size': int(c[1]) if c[1] is not None else 0,
                    'atl_pct': float(c[2]) if c[2] is not None else 0.0,
                    'interpretation_label': c[3],
                }
                for c in clusters
            ],
        }

    def delete_dbscan_run(self, session_id: int, dbscan_run_id: int, created_by: Optional[str]):
        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute("SELECT session_id FROM dbscan_validation_runs WHERE dbscan_run_id = ?", [int(dbscan_run_id)]).fetchone()
            if not row:
                raise ValueError("DBSCAN run not found")
            if int(row[0]) != int(session_id):
                raise ValueError("DBSCAN run does not belong to session")
            conn.execute("DELETE FROM dbscan_points WHERE dbscan_run_id = ?", [int(dbscan_run_id)])
            conn.execute("DELETE FROM dbscan_cluster_summary WHERE dbscan_run_id = ?", [int(dbscan_run_id)])
            conn.execute("DELETE FROM dbscan_kdistance_points WHERE dbscan_run_id = ?", [int(dbscan_run_id)])
            conn.execute("DELETE FROM dbscan_run_metrics WHERE dbscan_run_id = ?", [int(dbscan_run_id)])
            conn.execute("DELETE FROM dbscan_evidence_summary WHERE dbscan_run_id = ?", [int(dbscan_run_id)])
            conn.execute("DELETE FROM dbscan_validation_runs WHERE dbscan_run_id = ?", [int(dbscan_run_id)])
        self._log_event(session_id, 'dbscan_validation_deleted', {'dbscan_run_id': int(dbscan_run_id)}, created_by)

    def cross_algorithm(self, session_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            sid = int(session_id)
            ml_run = conn.execute(
                "SELECT ml_run_id, boundary_id FROM ml_validation_runs WHERE session_id = ? ORDER BY ml_run_id DESC LIMIT 1",
                [sid],
            ).fetchone()
            db_run = conn.execute(
                "SELECT dbscan_run_id, boundary_id FROM dbscan_validation_runs WHERE session_id = ? ORDER BY dbscan_run_id DESC LIMIT 1",
                [sid],
            ).fetchone()
            if not ml_run and not db_run:
                return {'session_id': sid, 'ml_run_id': None, 'dbscan_run_id': None, 'rows': []}

            ml_run_id = int(ml_run[0]) if ml_run else None
            dbscan_run_id = int(db_run[0]) if db_run else None
            boundary_id = int(ml_run[1]) if ml_run else (int(db_run[1]) if db_run else None)

            step3 = {}
            if ml_run_id is not None:
                for eid, pop in conn.execute(
                    """
                    SELECT entity_id, population_label
                    FROM ml_anomaly_scores
                    WHERE ml_run_id = ?
                    """,
                    [ml_run_id],
                ).fetchall():
                    step3[str(eid)] = pop
            elif dbscan_run_id is not None:
                for eid, pop in conn.execute(
                    """
                    SELECT entity_id, population_label
                    FROM dbscan_points
                    WHERE dbscan_run_id = ?
                    """,
                    [dbscan_run_id],
                ).fetchall():
                    step3[str(eid)] = pop

            scores = {}
            if ml_run_id is not None:
                for eid, sc, pct in conn.execute(
                    """
                    SELECT entity_id, anomaly_score, score_percentile
                    FROM ml_anomaly_scores
                    WHERE ml_run_id = ?
                    """,
                    [ml_run_id],
                ).fetchall():
                    scores[str(eid)] = {'if_score': float(sc), 'if_percentile': float(pct)}

            clusters = {}
            if dbscan_run_id is not None:
                for eid, cid, noise in conn.execute(
                    """
                    SELECT entity_id, cluster_id, is_noise
                    FROM dbscan_points
                    WHERE dbscan_run_id = ?
                    """,
                    [dbscan_run_id],
                ).fetchall():
                    clusters[str(eid)] = {'cluster_id': int(cid) if cid is not None else -1, 'is_noise': bool(noise)}

        entity_ids = sorted(set(list(scores.keys()) + list(clusters.keys())))
        rows = []
        for eid in entity_ids[:5000]:
            rows.append(
                {
                    'entity_id': eid,
                    'step3': step3.get(eid),
                    'if_score': scores.get(eid, {}).get('if_score'),
                    'if_percentile': scores.get(eid, {}).get('if_percentile'),
                    'dbscan_cluster': clusters.get(eid, {}).get('cluster_id'),
                    'dbscan_noise': clusters.get(eid, {}).get('is_noise'),
                }
            )
        return {'session_id': int(session_id), 'ml_run_id': ml_run_id, 'dbscan_run_id': dbscan_run_id, 'rows': rows}

    def recommendation_pack(self, session_id: int, created_by: Optional[str]) -> Dict:
        sid = int(session_id)
        cross = self.cross_algorithm(sid)
        ml_run_id = cross.get('ml_run_id')
        dbscan_run_id = cross.get('dbscan_run_id')

        with duckdb_pool.connection(self.db_path) as conn:
            boundary_id = None
            if ml_run_id:
                boundary_id = conn.execute("SELECT boundary_id FROM ml_validation_runs WHERE ml_run_id = ?", [int(ml_run_id)]).fetchone()
                boundary_id = int(boundary_id[0]) if boundary_id else None
            elif dbscan_run_id:
                boundary_id = conn.execute("SELECT boundary_id FROM dbscan_validation_runs WHERE dbscan_run_id = ?", [int(dbscan_run_id)]).fetchone()
                boundary_id = int(boundary_id[0]) if boundary_id else None
            if boundary_id is None:
                raise ValueError("No boundary context available for recommendation pack")

            if_metrics_row = conn.execute(
                "SELECT metrics_json FROM ml_run_metrics WHERE ml_run_id = ? ORDER BY created_at DESC LIMIT 1",
                [int(ml_run_id)] if ml_run_id else [-1],
            ).fetchone()
            if_metrics = json.loads(if_metrics_row[0]) if if_metrics_row and if_metrics_row[0] else {}
            comp = (if_metrics.get('comparison') or {}) if isinstance(if_metrics, dict) else {}

            db_metrics_row = conn.execute(
                "SELECT metrics_json FROM dbscan_run_metrics WHERE dbscan_run_id = ? ORDER BY created_at DESC LIMIT 1",
                [int(dbscan_run_id)] if dbscan_run_id else [-1],
            ).fetchone()
            db_metrics = json.loads(db_metrics_row[0]) if db_metrics_row and db_metrics_row[0] else {}
            dbm = (db_metrics.get('metrics') or {}) if isinstance(db_metrics, dict) else {}

            if_overlap = comp.get('overlap_pct')
            db_noise = dbm.get('noise_pct')
            db_atl_noise = dbm.get('atl_noise_pct')

            lines = []
            if if_overlap is not None:
                lines.append(f"Isolation Forest supports Step-3 with {float(if_overlap):.2f}% overlap (top-k vs ATL).")
            if db_noise is not None:
                lines.append(f"DBSCAN reports {float(db_noise):.2f}% noise; sparse behaviour may exist outside clusters.")
            if db_atl_noise is not None:
                lines.append(f"{float(db_atl_noise):.2f}% of ATL entities appear as DBSCAN noise (possible non-thresholdable archetypes).")

            next_actions = []
            if if_overlap is not None and float(if_overlap) < 70.0:
                next_actions.append("Re-check boundary robustness: explore a nearby percentile and re-run IF overlap comparison.")
            if db_atl_noise is not None and float(db_atl_noise) > 25.0:
                next_actions.append("Investigate ATL-noise entities: they may indicate structuring or sparse archetypes below threshold.")

            pack = {
                'session_id': sid,
                'boundary_id': boundary_id,
                'ml_run_id': ml_run_id,
                'dbscan_run_id': dbscan_run_id,
                'summary_lines': lines,
                'optional_next_actions': next_actions,
                'disclaimer': 'This is an evidence pack. It does not change thresholds or alerts automatically.',
            }

            pack_id = self._next_id(conn, "ml_recommendation_packs", "pack_id")
            conn.execute(
                """
                INSERT INTO ml_recommendation_packs (pack_id, session_id, boundary_id, ml_run_id, dbscan_run_id, pack_json, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    int(pack_id),
                    sid,
                    int(boundary_id),
                    int(ml_run_id) if ml_run_id is not None else None,
                    int(dbscan_run_id) if dbscan_run_id is not None else None,
                    json.dumps(pack),
                    created_by,
                ],
            )

        self._log_event(sid, 'ml_recommendation_pack_saved', {'pack_id': int(pack_id)}, created_by)
        return pack
