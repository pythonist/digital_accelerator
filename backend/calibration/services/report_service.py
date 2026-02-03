import json
from datetime import datetime
import pandas as pd

class ReportService:
    """
    The 'Data Archaeologist' Service.
    Gathers evidence from all previous steps to generate the final Audit Report.
    """
    
    def __init__(self, db_manager):
        self.db = db_manager

    def generate_complete_report(self, run_id, env_id):
        """
        Builds the master report JSON used by the UI and PDF generator.
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        # 1. GET RUN DETAILS (The Core Record)
        cursor.execute("SELECT * FROM calibration_runs WHERE run_id = ?", (run_id,))
        run = dict(cursor.fetchone())
        
        # 2. GET STEP 0 DATA (Foundation)
        # We fetch the latest Golden Dataset stats for this environment
        cursor.execute("""
            SELECT metadata FROM golden_dataset_cache 
            WHERE env_id = ? ORDER BY created_at DESC LIMIT 1
        """, (env_id,))
        gd_row = cursor.fetchone()
        gd_meta = json.loads(gd_row['metadata']) if gd_row else {}
        
        # 3. GET STEP 3 THRESHOLD DATA (The Decision)
        cursor.execute("SELECT * FROM selected_thresholds WHERE run_id = ?", (run_id,))
        threshold_row = cursor.fetchone()
        threshold_data = dict(threshold_row) if threshold_row else {}

        # 4. GET AGGREGATION STATS (Step 2)
        cursor.execute("SELECT * FROM aggregated_populations WHERE run_id = ?", (run_id,))
        agg_row = cursor.fetchone()
        agg_stats = dict(agg_row) if agg_row else {}

        conn.close()

        # 5. ASSEMBLE THE REPORT
        # This structure maps directly to your React components
        report = {
            # --- HEADER INFO ---
            "meta": {
                "run_id": run['run_id'],
                "scenario": run['scenario_name'],
                "status": run['status'],
                "generated_at": datetime.now().isoformat(),
                "created_by": run['created_by']
            },

            # --- SECTION 1: DATA FOUNDATION (Step 0) ---
            "data_foundation": {
                "total_transactions": gd_meta.get('total_rows', 0),
                "data_sources": ["Transactions", "Accounts", "Customers"], # Dynamic if needed
                "completeness_score": 98.5, # Example placeholder or calc
                "issues_detected": []
            },

            # --- SECTION 2: SCENARIO DEFINITION (Step 1) ---
            "scenario_definition": {
                "filters": json.loads(run['population_filters'] or '{}'),
                "initial_population": run['base_population_count'],
                "logic_summary": "High-risk customers with Cash transactions > $10k" # Generate dynamically based on filters
            },

            # --- SECTION 3: AGGREGATION LOGIC (Step 2) ---
            "aggregation": {
                "config": json.loads(run['aggregation_config'] or '{}'),
                "input_count": run['base_population_count'],
                "output_count": run['aggregated_population_count'],
                "compression_ratio": f"1:{round(run['base_population_count']/run['aggregated_population_count'], 1)}" if run['aggregated_population_count'] else "N/A"
            },

            # --- SECTION 4: CALIBRATION DECISION (Step 3) ---
            "decision": {
                "selected_threshold": run['selected_threshold'],
                "percentile_rank": run['selected_percentile'],
                "est_alerts_monthly": run['estimated_alert_count'],
                "percent_population_flagged": round((run['estimated_alert_count'] / run['aggregated_population_count']) * 100, 2) if run['aggregated_population_count'] else 0,
                "rationale": threshold_data.get('rationale', 'No rationale provided.')
            },

            # --- SECTION 5: GOVERNANCE (Step 4) ---
            "approval": {
                "approved_by": run.get('approved_by'),
                "approved_at": run.get('approved_at'),
                "comments": run.get('approval_comment')
            }
        }

        return report