# backend/calibration/services/scenario_service.py
"""
Scenario Service - Step 1
Orchestrates scenario population building using ScenarioEngine
"""
from ..builder.scenario_engine import ScenarioEngine
from .golden_dataset_builder import GoldenDatasetBuilder
import json
import uuid

class ScenarioService:
    """Handle scenario definition and population building"""
    
    def __init__(self, db_manager):
        self.db = db_manager
        self.golden_builder = GoldenDatasetBuilder(db_manager)
    
    def build_scenario_population(self, run_id, scenario_config):
        """
        Execute Step 1: Apply scenario filters to golden dataset
        
        Args:
            run_id: Calibration run ID
            scenario_config: {
                'transaction_filters': {...},
                'customer_filters': {...},
                'account_filters': {...}
            }
        
        Returns:
            {
                'population_id': str,
                'scenario_df': DataFrame,
                'stats': {...},
                'reduction_summary': {...}
            }
        """
        # Get run details
        conn = self.db.connect()
        cursor = conn.cursor()
        cursor.execute("SELECT env_id FROM calibration_runs WHERE run_id = ?", (run_id,))
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Run {run_id} not found")
        
        env_id = row[0]
        conn.close()
        
        # Load golden dataset
        print(f"📊 Loading golden dataset for {env_id}")
        golden_df = self.golden_builder.load_golden_dataset(env_id)
        
        # Apply scenario filters using ScenarioEngine
        print(f"🎯 Applying scenario filters")
        scenario_engine = ScenarioEngine(golden_df)
        filtered_df, filter_stats = scenario_engine.apply_scenario(scenario_config)
        
        # Generate population summary
        population_summary = scenario_engine.get_population_summary(filtered_df)
        
        # Store scenario population record
        population_id = str(uuid.uuid4())
        self._store_scenario_population(
            population_id,
            run_id,
            filtered_df,
            filter_stats,
            population_summary
        )
        
        # Update run state
        conn = self.db.connect()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE calibration_runs
            SET scenario_config = ?,
                base_population_count = ?,
                status = 'scenario_defined',
                current_step = 2
            WHERE run_id = ?
        """, (
            json.dumps(scenario_config),
            len(filtered_df),
            run_id
        ))
        conn.commit()
        conn.close()
        
        print(f"✅ Scenario population built: {len(filtered_df):,} rows")
        
        return {
            'population_id': population_id,
            'scenario_df': filtered_df,
            'stats': filter_stats,
            'population_summary': population_summary
        }
    
    def _store_scenario_population(self, population_id, run_id, df, filter_stats, summary):
        """Store scenario population metadata"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO scenario_populations
            (population_id, run_id, transaction_count, account_count, customer_count,
             date_range_start, date_range_end, filters_applied)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            population_id,
            run_id,
            summary['total_transactions'],
            summary['unique_accounts'],
            summary['unique_customers'],
            summary.get('date_range_start'),
            summary.get('date_range_end'),
            json.dumps(filter_stats)
        ))
        
        conn.commit()
        conn.close()
    
    def get_scenario_population(self, run_id):
        """Retrieve scenario population for a run"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT population_id, transaction_count, account_count, customer_count,
                   date_range_start, date_range_end, filters_applied
            FROM scenario_populations
            WHERE run_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        """, (run_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
        
        return {
            'population_id': row[0],
            'transaction_count': row[1],
            'account_count': row[2],
            'customer_count': row[3],
            'date_range_start': row[4],
            'date_range_end': row[5],
            'filters_applied': json.loads(row[6]) if row[6] else {}
        }
    
    def preview_scenario_impact(self, env_id, scenario_config, sample_size=5000):
        """
        Preview what scenario filters will do WITHOUT saving
        
        Returns:
            {
                'original_count': int,
                'filtered_count': int,
                'reduction_pct': float,
                'filter_breakdown': {...},
                'sample_rows': [...]
            }
        """
        # Load golden dataset sample
        golden_df = self.golden_builder.load_golden_dataset(env_id)
        
        # Sample for preview
        if len(golden_df) > sample_size:
            golden_df = golden_df.sample(n=sample_size, random_state=42)
        
        original_count = len(golden_df)
        
        # Apply filters
        scenario_engine = ScenarioEngine(golden_df)
        filtered_df, stats = scenario_engine.apply_scenario(scenario_config)
        
        reduction_pct = round(
            (1 - len(filtered_df) / original_count) * 100, 2
        ) if original_count > 0 else 0
        
        return {
            'original_count': original_count,
            'filtered_count': len(filtered_df),
            'reduction_pct': reduction_pct,
            'filter_breakdown': stats['reduction_by_filter'],
            'filters_applied': stats['filters_applied'],
            'sample_rows': filtered_df.head(100).to_dict('records')
        }