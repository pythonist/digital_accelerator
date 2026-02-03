from pathlib import Path
from typing import Dict, List, Optional, Tuple
import json
import math
from datetime import datetime

import duckdb
from api.tools.btsy.duckdb_pool import duckdb_pool


class SignalAnalysisService:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _next_id(self, conn: duckdb.DuckDBPyConnection, table_name: str, pk_column: str) -> int:
        row = conn.execute(f"SELECT COALESCE(MAX({pk_column}), 0) + 1 FROM {table_name}").fetchone()
        v = int(row[0] or 1) if row else 1
        return v if v >= 1 else 1

    def _ensure_schema(self):
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("CREATE SEQUENCE IF NOT EXISTS signal_events_seq START 1")
            conn.execute("CREATE SEQUENCE IF NOT EXISTS signal_states_seq START 1")

            conn.execute("""
                CREATE TABLE IF NOT EXISTS signal_distribution_profiles (
                  session_id INTEGER NOT NULL,
                  aggregation_lens TEXT NOT NULL,
                  view_json TEXT NOT NULL,
                  entities INTEGER,
                  median DOUBLE,
                  p90 DOUBLE,
                  p95 DOUBLE,
                  p97 DOUBLE,
                  p99 DOUBLE,
                  tail_top1_mass_pct DOUBLE,
                  tail_top5_mass_pct DOUBLE,
                  gini DOUBLE,
                  skewness DOUBLE,
                  kurtosis DOUBLE,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS signal_tail_analysis (
                  session_id INTEGER NOT NULL,
                  aggregation_lens TEXT NOT NULL,
                  tail_type TEXT,
                  smoothness_score DOUBLE,
                  breakpoints_json TEXT,
                  ks_uniform_tail DOUBLE,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS signal_temporal_stability (
                  session_id INTEGER NOT NULL,
                  aggregation_lens TEXT NOT NULL,
                  slice_type TEXT NOT NULL,
                  ks_stat DOUBLE,
                  median_shift DOUBLE,
                  tail_shift DOUBLE,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS signal_entity_contribution (
                  session_id INTEGER NOT NULL,
                  aggregation_lens TEXT NOT NULL,
                  segment TEXT NOT NULL,
                  entity_count INTEGER,
                  contribution_pct DOUBLE,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS signal_analysis_events (
                  event_id INTEGER PRIMARY KEY DEFAULT nextval('signal_events_seq'),
                  session_id INTEGER NOT NULL,
                  event_type TEXT NOT NULL,
                  params_json TEXT,
                  created_by TEXT,
                  triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS signal_analysis_states (
                  state_id INTEGER PRIMARY KEY DEFAULT nextval('signal_states_seq'),
                  session_id INTEGER NOT NULL,
                  name TEXT NOT NULL,
                  state_json TEXT NOT NULL,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

    def log_event(self, session_id: int, event_type: str, params: Dict, created_by: Optional[str]):
        with duckdb_pool.connection(self.db_path) as conn:
            event_id = self._next_id(conn, "signal_analysis_events", "event_id")
            conn.execute(
                "INSERT INTO signal_analysis_events (event_id, session_id, event_type, params_json, created_by) VALUES (?, ?, ?, ?, ?)",
                [event_id, session_id, event_type, json.dumps(params or {}), created_by]
            )

    def save_state(self, session_id: int, name: str, state: Dict, created_by: Optional[str]) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            state_id = self._next_id(conn, "signal_analysis_states", "state_id")
            conn.execute(
                "INSERT INTO signal_analysis_states (state_id, session_id, name, state_json, created_by) VALUES (?, ?, ?, ?, ?)",
                [state_id, session_id, name, json.dumps(state or {}), created_by]
            )
        self.log_event(session_id, 'state_saved', {'state_id': int(state_id), 'name': name}, created_by)
        return {'state_id': int(state_id), 'session_id': int(session_id), 'name': name}

    def list_states(self, session_id: int) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT state_id, name, created_by, created_at
                FROM signal_analysis_states
                WHERE session_id = ?
                ORDER BY state_id DESC
                LIMIT 200
            """, [session_id]).fetchall()
            return [{
                'state_id': int(r[0]),
                'name': r[1],
                'created_by': r[2],
                'created_at': str(r[3])
            } for r in rows]

    def get_state(self, state_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute("""
                SELECT state_id, session_id, name, state_json, created_by, created_at
                FROM signal_analysis_states
                WHERE state_id = ?
            """, [state_id]).fetchone()
            if not row:
                raise ValueError("State not found")
            return {
                'state_id': int(row[0]),
                'session_id': int(row[1]),
                'name': row[2],
                'state': json.loads(row[3]) if row[3] else {},
                'created_by': row[4],
                'created_at': str(row[5])
            }

    def _get_session_context(self, workbench_db_path: Path, session_id: int) -> Dict:
        with duckdb_pool.connection(workbench_db_path) as conn:
            s = conn.execute("""
                SELECT behavior_run_id, metric_name
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
            entity_collapse = (agg[0] if agg else 'max')
            time_lens = (agg[1] if agg else 'full')
            sustained_days = int(agg[2]) if agg and agg[2] is not None else 3
            return {
                'behavior_run_id': int(s[0]),
                'metric_name': s[1],
                'aggregation_lens': f"entity={entity_collapse};time={time_lens};n={sustained_days}",
                'entity_collapse': entity_collapse,
                'time_lens': time_lens,
                'sustained_days': sustained_days
            }

    def _build_series_query(self, behavior_run_id: int, metric_name: str, time_lens: str, sustained_days: int) -> str:
        metric_filter = f"behavior_run_id = {int(behavior_run_id)}"
        if metric_name:
            escaped_metric_name = metric_name.replace("'", "''")
            metric_filter += f" AND metric_name = '{escaped_metric_name}'"

        if (time_lens or 'full').lower() == 'full':
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

        if (time_lens or '').lower() in ('rolling_peak', 'sustained'):
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
                    WHEN '{(time_lens or '').lower()}' = 'rolling_peak' THEN roll_sum
                    WHEN '{(time_lens or '').lower()}' = 'sustained' THEN CASE WHEN all_non_zero = 1 THEN roll_avg ELSE NULL END
                    ELSE metric_value
                  END AS metric_value
                FROM w
            """
        return base

    def _build_entity_agg_query(
        self,
        series_query: str,
        entity_collapse: str,
        date_filter_sql: Optional[str] = None
    ) -> str:
        base = series_query
        if date_filter_sql:
            base = f"SELECT entity_id, as_of_date, metric_value FROM ({series_query}) s WHERE {date_filter_sql}"

        entity_collapse = (entity_collapse or 'max').lower()
        if entity_collapse == 'max':
            return f"SELECT entity_id, MAX(metric_value) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        if entity_collapse == 'avg':
            return f"SELECT entity_id, AVG(metric_value) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        if entity_collapse == 'p95':
            return f"SELECT entity_id, quantile(metric_value, 0.95) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        if entity_collapse == 'last':
            return f"SELECT entity_id, max_by(metric_value, as_of_date) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        raise ValueError("Unsupported entity collapse method")

    def _ks_two_sample(self, a: List[float], b: List[float]) -> Optional[float]:
        if not a or not b:
            return None
        a_sorted = sorted(a)
        b_sorted = sorted(b)
        n = len(a_sorted)
        m = len(b_sorted)
        i = 0
        j = 0
        cdf_a = 0.0
        cdf_b = 0.0
        ks = 0.0
        while i < n and j < m:
            if a_sorted[i] <= b_sorted[j]:
                i += 1
                cdf_a = i / n
            else:
                j += 1
                cdf_b = j / m
            ks = max(ks, abs(cdf_a - cdf_b))
        while i < n:
            i += 1
            cdf_a = i / n
            ks = max(ks, abs(cdf_a - cdf_b))
        while j < m:
            j += 1
            cdf_b = j / m
            ks = max(ks, abs(cdf_a - cdf_b))
        return float(ks)

    def _ks_vs_uniform(self, xs: List[float]) -> Optional[float]:
        if not xs:
            return None
        mn = min(xs)
        mx = max(xs)
        if mx == mn:
            return 0.0
        zs = sorted((x - mn) / (mx - mn) for x in xs)
        n = len(zs)
        ks = 0.0
        for idx, z in enumerate(zs, start=1):
            cdf_emp = idx / n
            cdf_uni = z
            ks = max(ks, abs(cdf_emp - cdf_uni))
        return float(ks)

    def _gini(self, values: List[float]) -> float:
        vals = [abs(float(v)) for v in values if v is not None]
        if not vals:
            return 0.0
        vals.sort()
        n = len(vals)
        total = sum(vals)
        if total == 0:
            return 0.0
        cum = 0.0
        for i, v in enumerate(vals, start=1):
            cum += i * v
        return float((2.0 * cum) / (n * total) - (n + 1) / n)

    def _skew_kurtosis(self, values: List[float]) -> Tuple[Optional[float], Optional[float]]:
        xs = [float(v) for v in values if v is not None]
        n = len(xs)
        if n == 0:
            return None, None
        mean = sum(xs) / n
        m2 = sum((x - mean) ** 2 for x in xs) / n
        if m2 == 0:
            return 0.0, 0.0
        m3 = sum((x - mean) ** 3 for x in xs) / n
        m4 = sum((x - mean) ** 4 for x in xs) / n
        skew = m3 / (m2 ** 1.5)
        kurt = (m4 / (m2 ** 2)) - 3.0
        return float(skew), float(kurt)

    def compute_signal_report(
        self,
        behavior_db_path: Path,
        workbench_db_path: Path,
        session_id: int,
        view: Dict,
        created_by: Optional[str]
    ) -> Dict:
        ctx = self._get_session_context(workbench_db_path, session_id)
        series_query = self._build_series_query(
            ctx['behavior_run_id'],
            ctx['metric_name'],
            ctx['time_lens'],
            ctx['sustained_days']
        )

        slice_type = (view or {}).get('time_slice', 'whole')
        date_filter = None
        if slice_type in ('early', 'late'):
            conn = duckdb.connect(str(behavior_db_path))
            try:
                mm = conn.execute(f"SELECT MIN(as_of_date), MAX(as_of_date) FROM ({series_query})").fetchone()
            finally:
                conn.close()
            min_dt = mm[0]
            max_dt = mm[1]
            if min_dt and max_dt:
                mid = min_dt + (max_dt - min_dt) / 2
                if slice_type == 'early':
                    date_filter = f"as_of_date <= TIMESTAMP '{mid}'"
                else:
                    date_filter = f"as_of_date > TIMESTAMP '{mid}'"

        agg_query = self._build_entity_agg_query(series_query, ctx['entity_collapse'], date_filter_sql=date_filter)

        conn = duckdb.connect(str(behavior_db_path))
        try:
            n = int(conn.execute(f"SELECT COUNT(*) FROM ({agg_query})").fetchone()[0] or 0)
            if n == 0:
                total_rows = int(conn.execute(
                    "SELECT COUNT(1) FROM behavior_table WHERE behavior_run_id = ?",
                    [int(ctx['behavior_run_id'])]
                ).fetchone()[0] or 0)
                metrics = conn.execute(
                    "SELECT DISTINCT metric_name FROM behavior_table WHERE behavior_run_id = ? ORDER BY metric_name LIMIT 25",
                    [int(ctx['behavior_run_id'])]
                ).fetchall()
                metric_names = [m[0] for m in metrics if m and m[0]]
                return {
                    'status': 'empty',
                    'reason': 'No entities produced by this lens for the selected behaviour run/metric.',
                    'behavior_run_id': int(ctx['behavior_run_id']),
                    'metric_name': ctx.get('metric_name'),
                    'aggregation_lens': ctx.get('aggregation_lens'),
                    'time_slice': slice_type,
                    'available_metrics': metric_names,
                    'behavior_table_rows': total_rows,
                    'hint': 'Pick a behaviour run that has behavior_table rows, or regenerate the run.'
                }

            population_mode = (view or {}).get('population', {'mode': 'full'})
            pop_mode = (population_mode or {}).get('mode', 'full')
            pct = float((population_mode or {}).get('pct', 5) or 5)
            pct = max(0.0, min(100.0, pct))

            filter_sql = ""
            if pop_mode == 'top' and pct > 0:
                q = 1.0 - (pct / 100.0)
                cutoff = conn.execute(f"SELECT quantile(aggregated_value, {q}) FROM ({agg_query})").fetchone()[0]
                filter_sql = f"WHERE aggregated_value >= {float(cutoff or 0.0)}"
            elif pop_mode == 'bottom' and pct > 0:
                q = pct / 100.0
                cutoff = conn.execute(f"SELECT quantile(aggregated_value, {q}) FROM ({agg_query})").fetchone()[0]
                filter_sql = f"WHERE aggregated_value <= {float(cutoff or 0.0)}"

            winsor = (view or {}).get('winsorize', {'enabled': False})
            wins_enabled = bool((winsor or {}).get('enabled', False))
            wins_low = float((winsor or {}).get('low_pct', 1) or 1)
            wins_high = float((winsor or {}).get('high_pct', 99) or 99)
            wins_low_q = max(0.0, min(1.0, wins_low / 100.0))
            wins_high_q = max(0.0, min(1.0, wins_high / 100.0))
            if wins_high_q < wins_low_q:
                wins_low_q, wins_high_q = wins_high_q, wins_low_q

            filtered_query = f"SELECT aggregated_value FROM ({agg_query}) a {filter_sql}"

            if wins_enabled:
                low_v = conn.execute(f"SELECT quantile(aggregated_value, {wins_low_q}) FROM ({filtered_query})").fetchone()[0]
                high_v = conn.execute(f"SELECT quantile(aggregated_value, {wins_high_q}) FROM ({filtered_query})").fetchone()[0]
                low_v = float(low_v or 0.0)
                high_v = float(high_v or low_v)
                values_rows = conn.execute(f"""
                    SELECT
                      CASE
                        WHEN aggregated_value < {low_v} THEN {low_v}
                        WHEN aggregated_value > {high_v} THEN {high_v}
                        ELSE aggregated_value
                      END AS v
                    FROM ({filtered_query})
                """).fetchall()
                values = [float(r[0] or 0.0) for r in values_rows]
            else:
                values_rows = conn.execute(filtered_query).fetchall()
                values = [float(r[0] or 0.0) for r in values_rows]

            if not values:
                raise ValueError("No values after applying view filters")

            percentiles = conn.execute(f"""
                WITH vals AS ({filtered_query})
                SELECT
                  quantile(aggregated_value, 0.5) AS p50,
                  quantile(aggregated_value, 0.9) AS p90,
                  quantile(aggregated_value, 0.95) AS p95,
                  quantile(aggregated_value, 0.97) AS p97,
                  quantile(aggregated_value, 0.99) AS p99
                FROM vals
            """).fetchone()

            p50 = float(percentiles[0] or 0.0)
            p90 = float(percentiles[1] or 0.0)
            p95 = float(percentiles[2] or 0.0)
            p97 = float(percentiles[3] or 0.0)
            p99 = float(percentiles[4] or 0.0)

            abs_vals = [abs(v) for v in values]
            total_mass = sum(abs_vals)
            top1_cut = p99
            top5_cut = p95
            top1_mass = sum(abs(v) for v in values if v >= top1_cut)
            top5_mass = sum(abs(v) for v in values if v >= top5_cut)
            top1_mass_pct = float(top1_mass / total_mass * 100.0) if total_mass else 0.0
            top5_mass_pct = float(top5_mass / total_mass * 100.0) if total_mass else 0.0

            gini = self._gini(values)
            skew, kurt = self._skew_kurtosis(values)

            engine1 = {
                'entities': len(values),
                'median': p50,
                'p90': p90,
                'p95': p95,
                'p97': p97,
                'p99': p99,
                'tail': {'top1_mass_pct': top1_mass_pct, 'top5_mass_pct': top5_mass_pct},
                'gini': gini,
                'skewness': skew,
                'kurtosis': kurt
            }

            tail_percentiles = [90, 91, 92, 93, 94, 95, 96, 97, 98, 99]
            q_expr = ", ".join([f"quantile(aggregated_value, {p/100.0}) AS p{p}" for p in tail_percentiles])
            tail_row = conn.execute(f"WITH vals AS ({filtered_query}) SELECT {q_expr} FROM vals").fetchone()
            tail_vals = [float(v or 0.0) for v in tail_row]
            diffs = [tail_vals[i] - tail_vals[i - 1] for i in range(1, len(tail_vals))]
            diff_median = sorted(diffs)[len(diffs) // 2] if diffs else 0.0
            diff_mean = sum(diffs) / len(diffs) if diffs else 0.0
            diff_var = sum((d - diff_mean) ** 2 for d in diffs) / len(diffs) if diffs else 0.0
            diff_std = math.sqrt(diff_var) if diff_var > 0 else 0.0
            cv = (diff_std / diff_mean) if diff_mean not in (0.0, -0.0) else 0.0
            smoothness_score = float(1.0 / (1.0 + abs(cv)))

            breakpoints = []
            if diffs and diff_median > 0:
                for i, d in enumerate(diffs, start=1):
                    if d > (diff_median * 3.0):
                        breakpoints.append({'from': tail_percentiles[i - 1], 'to': tail_percentiles[i], 'delta': float(d)})

            tail_values = [v for v in values if v >= p95]
            ks_uniform_tail = self._ks_vs_uniform(tail_values) if tail_values else None
            tail_type = "smooth" if (smoothness_score >= 0.6 and len(breakpoints) == 0) else "jumpy"

            engine2 = {
                'tail_type': tail_type,
                'smoothness_score': smoothness_score,
                'breakpoints': breakpoints,
                'ks_uniform_tail': ks_uniform_tail
            }

            temporal = {'slice_type': 'whole', 'ks_early_late': None, 'median_shift': None, 'tail_shift': None}
            mm2 = conn.execute(f"SELECT MIN(as_of_date), MAX(as_of_date) FROM ({series_query})").fetchone()
            if mm2 and mm2[0] and mm2[1]:
                min_dt = mm2[0]
                max_dt = mm2[1]
                mid = min_dt + (max_dt - min_dt) / 2
                early_q = self._build_entity_agg_query(series_query, ctx['entity_collapse'], date_filter_sql=f"as_of_date <= TIMESTAMP '{mid}'")
                late_q = self._build_entity_agg_query(series_query, ctx['entity_collapse'], date_filter_sql=f"as_of_date > TIMESTAMP '{mid}'")
                early_vals = [float(r[0] or 0.0) for r in conn.execute(f"SELECT aggregated_value FROM ({early_q})").fetchall()]
                late_vals = [float(r[0] or 0.0) for r in conn.execute(f"SELECT aggregated_value FROM ({late_q})").fetchall()]
                ks = self._ks_two_sample(early_vals, late_vals)
                if early_vals and late_vals:
                    early_med = float(conn.execute(f"SELECT quantile(aggregated_value, 0.5) FROM ({early_q})").fetchone()[0] or 0.0)
                    late_med = float(conn.execute(f"SELECT quantile(aggregated_value, 0.5) FROM ({late_q})").fetchone()[0] or 0.0)
                    early_p95 = float(conn.execute(f"SELECT quantile(aggregated_value, 0.95) FROM ({early_q})").fetchone()[0] or 0.0)
                    late_p95 = float(conn.execute(f"SELECT quantile(aggregated_value, 0.95) FROM ({late_q})").fetchone()[0] or 0.0)
                    temporal = {
                        'slice_type': 'early_vs_late',
                        'ks_early_late': ks,
                        'median_shift': float(late_med - early_med),
                        'tail_shift': float(late_p95 - early_p95)
                    }

            engine3 = temporal

            contrib = []
            if total_mass > 0:
                sorted_vals = sorted([(v, abs(v)) for v in values], key=lambda x: x[0], reverse=True)
                nvals = len(sorted_vals)
                def segment_mass(frac: float) -> Tuple[int, float]:
                    k = max(1, int(math.ceil(nvals * frac)))
                    m = sum(av for _, av in sorted_vals[:k])
                    return k, float(m / total_mass * 100.0)
                top1_n, top1_pct = segment_mass(0.01)
                top5_n, top5_pct = segment_mass(0.05)
                contrib.append({'segment': 'top_1pct', 'entity_count': top1_n, 'contribution_pct': top1_pct})
                contrib.append({'segment': 'top_5pct', 'entity_count': top5_n, 'contribution_pct': top5_pct})

                mid_low = p50
                mid_high = p95
                mid_mass = sum(abs(v) for v in values if v >= mid_low and v < mid_high)
                mid_cnt = sum(1 for v in values if v >= mid_low and v < mid_high)
                contrib.append({'segment': 'middle_p50_p95', 'entity_count': int(mid_cnt), 'contribution_pct': float(mid_mass / total_mass * 100.0)})

            engine4 = {'segments': contrib}

            bins = int((view or {}).get('bins', 40) or 40)
            bins = max(10, min(200, bins))
            mn = min(values)
            mx = max(values)
            if mx == mn:
                hist = [{'bucket': 0, 'count': len(values)}]
            else:
                hist_rows = conn.execute(f"""
                    WITH vals AS ({filtered_query})
                    SELECT
                      CAST(FLOOR(((aggregated_value - {mn}) / NULLIF({mx}-{mn},0)) * {bins}) AS INTEGER) AS bucket,
                      COUNT(*) AS count
                    FROM vals
                    GROUP BY bucket
                    ORDER BY bucket
                """).fetchall()
                hist = [{'bucket': int(b if b is not None else 0), 'count': int(c)} for b, c in hist_rows]

            chart = {'min': float(mn), 'max': float(mx), 'bins': bins, 'rows': hist}

        finally:
            conn.close()

        view_json = json.dumps(view or {})
        aggregation_lens = ctx['aggregation_lens']

        with duckdb_pool.connection(self.db_path) as wconn:
            wconn.execute("""
                INSERT INTO signal_distribution_profiles (
                  session_id, aggregation_lens, view_json, entities,
                  median, p90, p95, p97, p99,
                  tail_top1_mass_pct, tail_top5_mass_pct,
                  gini, skewness, kurtosis
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                session_id, aggregation_lens, view_json, engine1['entities'],
                engine1['median'], engine1['p90'], engine1['p95'], engine1['p97'], engine1['p99'],
                engine1['tail']['top1_mass_pct'], engine1['tail']['top5_mass_pct'],
                engine1['gini'], engine1['skewness'], engine1['kurtosis']
            ])

            wconn.execute("""
                INSERT INTO signal_tail_analysis (
                  session_id, aggregation_lens, tail_type, smoothness_score, breakpoints_json, ks_uniform_tail
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, [
                session_id, aggregation_lens, engine2['tail_type'], engine2['smoothness_score'],
                json.dumps(engine2['breakpoints']), engine2['ks_uniform_tail']
            ])

            if engine3.get('slice_type') == 'early_vs_late':
                wconn.execute("""
                    INSERT INTO signal_temporal_stability (
                      session_id, aggregation_lens, slice_type, ks_stat, median_shift, tail_shift
                    ) VALUES (?, ?, 'early_vs_late', ?, ?, ?)
                """, [session_id, aggregation_lens, engine3.get('ks_early_late'), engine3.get('median_shift'), engine3.get('tail_shift')])

            for seg in engine4.get('segments') or []:
                wconn.execute("""
                    INSERT INTO signal_entity_contribution (
                      session_id, aggregation_lens, segment, entity_count, contribution_pct
                    ) VALUES (?, ?, ?, ?, ?)
                """, [session_id, aggregation_lens, seg['segment'], seg['entity_count'], seg['contribution_pct']])

        self.log_event(session_id, 'signal_compute', {'view': view or {}, 'aggregation_lens': aggregation_lens}, created_by)

        return {
            'aggregation_lens': aggregation_lens,
            'view': view or {},
            'distribution': engine1,
            'tail': engine2,
            'temporal': engine3,
            'entity_contribution': engine4,
            'chart': chart
        }
