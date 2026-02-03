# backend/calibration/services/scenario_catalog_service.py
"""
Scenario Catalog Service
Manages pre-built behavioral templates (NOT thresholds)
"""
import json
from datetime import datetime

class ScenarioCatalogService:
    """Manages scenario templates and metadata"""
    
    # Built-in templates (can move to DB later)
    BUILTIN_SCENARIOS = [
        {
            "scenario_id": "CASH_TOTAL",
            "name": "Total Cash Transactions",
            "description": "Aggregated cash credits over rolling window",
            "category": "CASH_MONITORING",
            "step1_defaults": {
                "transaction_category": ["CASH"],
                "transaction_direction": ["CREDIT"],
                "account_status": ["Active"]
            },
            "step2_defaults": {
                "aggregation_level": "ACCOUNT_DATE",
                "metrics": ["SUM_AMOUNT", "COUNT"],
                "lookback_days": 7,
                "frequency": "7_day"
            },
            "typical_behavior": "Detects high cumulative cash usage patterns",
            "risk_indicators": ["Structuring", "Large cash deposits"]
        },
        {
            "scenario_id": "DORMANT_REACTIVATION",
            "name": "Dormant Account Reactivation",
            "description": "Sudden activity in previously dormant accounts",
            "category": "ACCOUNT_BEHAVIOR",
            "step1_defaults": {
                "account_status": ["Active"],
                "transaction_direction": ["CREDIT", "DEBIT"]
            },
            "step2_defaults": {
                "aggregation_level": "ACCOUNT",
                "metrics": ["COUNT", "SUM_AMOUNT"],
                "lookback_days": 90,
                "frequency": "30_day"
            },
            "typical_behavior": "Identifies accounts with sudden transaction spikes",
            "risk_indicators": ["Account takeover", "Money mule"]
        },
        {
            "scenario_id": "HIGH_RISK_CUSTOMER_ACTIVITY",
            "name": "High-Risk Customer Activity",
            "description": "Transaction patterns for high-risk customers",
            "category": "CUSTOMER_RISK",
            "step1_defaults": {
                "customer_risk_rating": ["HIGH"],
                "account_status": ["Active"]
            },
            "step2_defaults": {
                "aggregation_level": "CUSTOMER",
                "metrics": ["SUM_AMOUNT", "COUNT"],
                "lookback_days": 30,
                "frequency": "30_day"
            },
            "typical_behavior": "Monitors elevated activity in high-risk segments",
            "risk_indicators": ["Enhanced monitoring required"]
        }
    ]
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def list_scenarios(self):
        """Get all available scenarios"""
        scenarios = self.BUILTIN_SCENARIOS.copy()
        
        # Enhance with usage stats from DB
        conn = self.db.connect()
        cursor = conn.cursor()
        
        for scenario in scenarios:
            cursor.execute("""
                SELECT 
                    COUNT(*) as use_count,
                    MAX(created_at) as last_used
                FROM calibration_runs
                WHERE scenario_config LIKE ?
            """, (f'%{scenario["scenario_id"]}%',))
            
            row = cursor.fetchone()
            scenario['use_count'] = row[0] if row else 0
            scenario['last_calibrated'] = row[1] if row else None
        
        conn.close()
        return scenarios
    
    def get_scenario(self, scenario_id):
        """Get specific scenario template"""
        for scenario in self.BUILTIN_SCENARIOS:
            if scenario['scenario_id'] == scenario_id:
                return scenario
        return None
    
    def save_custom_scenario(self, user_id, name, description, step1_defaults, step2_defaults):
        """Save user-defined scenario"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        scenario_id = f"CUSTOM_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        
        scenario = {
            "scenario_id": scenario_id,
            "name": name,
            "description": description,
            "category": "CUSTOM",
            "step1_defaults": step1_defaults,
            "step2_defaults": step2_defaults,
            "created_by": user_id,
            "created_at": datetime.utcnow().isoformat()
        }
        
        cursor.execute("""
            INSERT INTO custom_scenarios (scenario_id, created_by, scenario_config)
            VALUES (?, ?, ?)
        """, (scenario_id, user_id, json.dumps(scenario)))
        
        conn.commit()
        conn.close()
        
        return scenario