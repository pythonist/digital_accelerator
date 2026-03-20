# backend/services/focus_engine.py
"""
AML Focus Engine v2: Configurable Work Queue Generator
- Deterministic Scoring
- Explicit Selection Reasoning
- Run History & Metadata
- Bucketing (Priority, Monitor, Suppress)
"""
import pandas as pd
import sqlite3
import json
from datetime import datetime, timedelta
import traceback
import uuid

class FocusEngine:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self._ensure_schema()

    def _ensure_schema(self):
        """Create tables for Runs and Results."""
        conn = self.db_manager.connect()
        try:
            cursor = conn.cursor()
            
            # 1. Focus Runs (Metadata & Configuration History)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS focus_runs (
                    run_id TEXT PRIMARY KEY,
                    run_at TEXT,
                    configuration TEXT,  -- Stores the JSON config used for this run
                    total_cases INTEGER,
                    included_cases INTEGER,
                    excluded_cases INTEGER,
                    status TEXT
                )
            """)
            
            # 2. Focus Results (The Work Queue Snapshot)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS focus_results (
                    result_id TEXT PRIMARY KEY,
                    run_id TEXT,
                    entity_key TEXT,
                    entity_type TEXT,
                    risk_score INTEGER,
                    bucket TEXT,          -- Priority, Monitor, Suppress
                    reasons TEXT,         -- JSON list of human-readable strings
                    is_included BOOLEAN,  -- If false, purely for audit
                    alert_count INTEGER,
                    critical_count INTEGER,
                    last_alert_date TEXT,
                    alert_vector TEXT,
                    FOREIGN KEY(run_id) REFERENCES focus_runs(run_id)
                )
            """)
            
            # Index for fast Inbox retrieval
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_focus_run ON focus_results(run_id, is_included, bucket)")
            conn.commit()
        except Exception as e:
            print(f"[WARN] Focus Engine Schema Error: {e}")
        finally:
            self.db_manager.close_connection(conn)

    def run_focus_job(self, config_override=None):
        """
        Main execution method.
        1. Load Config
        2. Fetch Data
        3. Score & Reason
        4. Bucket & Select
        5. Persist Snapshot & Config
        """
        run_id = f"RUN-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4]}"
        
        # Default Configuration (The "Configurable" Part)
        config = {
            "min_score_threshold": 20,
            "lookback_days": 90,
            "weights": {"critical": 20, "high": 10, "medium": 5, "low": 1},
            "buckets": {
                "Priority": {"min_score": 80, "requires_critical": False},
                "Monitor": {"min_score": 40, "requires_critical": False}
            },
            "auto_exclusion": {
                "suppress_score_below": 10,
                "suppress_single_low_alert": True
            }
        }
        if config_override:
            config.update(config_override)

        conn = self.db_manager.connect()
        try:
            print(f"[INFO] Focus Engine: Starting Run {run_id} with Config: {json.dumps(config)}")
            
            # --- Step 1: Data Fetching ---
            try:
                alerts_df = pd.read_sql("SELECT * FROM alerts", conn)
                if alerts_df.empty:
                    self._record_empty_run(conn, run_id, config)
                    return {"success": True, "message": "No alerts found", "run_id": run_id}
            except Exception:
                return {"success": False, "error": "Alerts table missing"}

            # --- Step 2: Pre-processing ---
            alerts_df.columns = [c.lower() for c in alerts_df.columns]
            case_col = self._find_col(alerts_df, ['case_id', 'caseid', 'case'])
            
            if not case_col: 
                return {"success": False, "error": "No Case ID column found in alerts"}

            # --- Step 3: Analysis Loop ---
            results = []
            grouped = alerts_df.groupby(case_col)
            
            total_evaluated = 0
            included_count = 0
            excluded_count = 0

            for entity_key, group in grouped:
                total_evaluated += 1
                
                # A. Score & Reason
                analysis = self._analyze_entity(group, config)
                
                # B. Bucket & Inclusion Logic
                decision = self._decide_bucket_and_inclusion(analysis, config)
                
                # C. Prepare Record
                results.append({
                    "result_id": uuid.uuid4().hex,
                    "run_id": run_id,
                    "entity_key": str(entity_key),
                    "entity_type": "case",
                    "risk_score": analysis['score'],
                    "bucket": decision['bucket'],
                    "reasons": json.dumps(decision['reasons']),
                    "is_included": decision['included'],
                    "alert_count": analysis['count'],
                    "critical_count": analysis['critical'],
                    "last_alert_date": analysis['last_date'],
                    "alert_vector": json.dumps(analysis['vector'])
                })

                if decision['included']: included_count += 1
                else: excluded_count += 1

            # --- Step 4: Persistence ---
            cursor = conn.cursor()
            
            # Save Metadata (Including the Config!)
            # Explicitly converting config to JSON string
            config_json = json.dumps(config)
            
            cursor.execute("""
                INSERT INTO focus_runs (run_id, run_at, configuration, total_cases, included_cases, excluded_cases, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (run_id, datetime.now().isoformat(), config_json, total_evaluated, included_count, excluded_count, 'COMPLETED'))

            # Save Results
            if results:
                cursor.executemany("""
                    INSERT INTO focus_results (
                        result_id, run_id, entity_key, entity_type, risk_score, bucket, 
                        reasons, is_included, alert_count, critical_count, last_alert_date, alert_vector
                    ) VALUES (:result_id, :run_id, :entity_key, :entity_type, :risk_score, :bucket, 
                              :reasons, :is_included, :alert_count, :critical_count, :last_alert_date, :alert_vector)
                """, results)

            conn.commit()
            
            return {
                "success": True,
                "run_id": run_id,
                "stats": {
                    "total": total_evaluated,
                    "included": included_count,
                    "excluded": excluded_count
                },
                "buckets": self._summarize_buckets(results)
            }

        except Exception as e:
            traceback.print_exc()
            return {"success": False, "error": str(e)}
        finally:
            self.db_manager.close_connection(conn)

    def _analyze_entity(self, df, config):
        """Deterministic scoring using configured weights."""
        weights = config.get('weights', {})
        w_crit = weights.get('critical', 20)
        w_high = weights.get('high', 10)
        w_med = weights.get('medium', 5)
        
        sev_col = self._find_col(df, ['severity', 'priority', 'risk'])
        
        score = 0
        critical_count = 0
        vector = {}
        
        for _, row in df.iterrows():
            sev = str(row.get(sev_col, 'medium')).lower()
            vector[sev] = vector.get(sev, 0) + 1
            
            if 'critical' in sev:
                score += w_crit
                critical_count += 1
            elif 'high' in sev:
                score += w_high
            elif 'medium' in sev:
                score += w_med
            else:
                score += 1

        date_col = self._find_col(df, ['date', 'time', 'created'])
        last_date = None
        if date_col:
            try: last_date = df[date_col].max()
            except: pass
            
        return {
            "score": min(score, 100), 
            "count": len(df),
            "critical": critical_count,
            "vector": vector,
            "last_date": str(last_date) if last_date else None
        }

    def _decide_bucket_and_inclusion(self, analysis, config):
        """Decides Bucket (Priority/Monitor) using Config Thresholds."""
        score = analysis['score']
        crit = analysis['critical']
        reasons = []
        bucket = "Review"
        included = True
        
        # 1. Generate Reasons
        if crit > 0: reasons.append(f"{crit} Critical Alerts")
        if score > 80: reasons.append("High Risk Score")
        if analysis['count'] > 10: reasons.append("High Alert Volume")
        
        # 2. Determine Bucket
        buckets_cfg = config.get('buckets', {})
        
        # Check Priority
        p_cfg = buckets_cfg.get('Priority', {})
        if score >= p_cfg.get('min_score', 80) or (p_cfg.get('requires_critical') and crit > 0):
            bucket = "Priority"
        else:
            # Check Monitor
            m_cfg = buckets_cfg.get('Monitor', {})
            if score >= m_cfg.get('min_score', 40):
                bucket = "Monitor"
        
        # 3. Exclusion Logic
        ex_cfg = config.get('auto_exclusion', {})
        if score < ex_cfg.get('suppress_score_below', 10):
            included = False
            bucket = "Suppressed"
            reasons.append("Score below threshold")
        
        if not reasons:
            reasons.append("Routine Review")

        return {
            "bucket": bucket,
            "reasons": reasons,
            "included": included
        }

    def _find_col(self, df, keywords):
        cols_lower = [str(c).lower() for c in df.columns]
        for kw in keywords:
            for i, c_low in enumerate(cols_lower):
                if kw in c_low: return df.columns[i]
        return None

    def _record_empty_run(self, conn, run_id, config):
        cursor = conn.cursor()
        cursor.execute("INSERT INTO focus_runs (run_id, run_at, configuration, total_cases, status) VALUES (?,?,?,?,?)",
                       (run_id, datetime.now().isoformat(), json.dumps(config), 0, 'EMPTY'))
        conn.commit()

    def _summarize_buckets(self, results):
        summary = {}
        for r in results:
            if r['is_included']:
                b = r['bucket']
                summary[b] = summary.get(b, 0) + 1
        return summary
