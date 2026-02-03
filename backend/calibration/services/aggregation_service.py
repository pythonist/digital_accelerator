# backend/calibration/services/aggregation_service.py
"""
Aggregation Service - Complete with All Insights
FIXED: Uses calibration view instead of non-existent unified transaction table
"""
from ..builder.aggregation_engine import AggregationEngine
from .population_explorer_service import PopulationExplorerService
from .aggregation_config_service import AggregationConfigService
from .aggregation_stats_service import AggregationStatsService
from .aggregation_visual_service import AggregationVisualService
from .aggregation_narrative_service import AggregationNarrativeService
from .aggregation_health_service import AggregationHealthService
from .aggregation_insight_service import AggregationInsightService
from .aggregation_validator_service import AggregationValidatorService
import json
import uuid
import pandas as pd

class AggregationService:
    """Orchestrate aggregation workflow with full insights"""
    
    def __init__(self, db_manager):
        self.db = db_manager
        self.population_service = PopulationExplorerService(db_manager)
        self.config_service = AggregationConfigService()
        self.stats_service = AggregationStatsService()
        self.visual_service = AggregationVisualService()
        self.narrative_service = AggregationNarrativeService()
        self.health_service = AggregationHealthService()
        self.insight_service = AggregationInsightService()
        self.validator_service = AggregationValidatorService()
    
    def _load_step1_population(self, run_id, limit=None):
        """Load v1 with deduplication"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("SELECT env_id, population_filters FROM calibration_runs WHERE run_id = ?", (run_id,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            raise ValueError(f"Run {run_id} not found")
        
        env_id, filters = row[0], json.loads(row[1]) if row[1] else {}
        
        v1_df = self.population_service.fetch_population_dataframe(run_id, env_id, filters, limit)
        
        # Standardize columns
        v1_df.columns = [c.lower().strip().replace(' ', '_') for c in v1_df.columns]
        
        # Strict deduplication
        initial_count = len(v1_df)
        if 'transaction_id' in v1_df.columns:
            v1_df = v1_df.drop_duplicates(subset=['transaction_id'])
        else:
            # Try multiple fallback combinations
            dedup_cols = []
            if 'account_id' in v1_df.columns:
                dedup_cols.append('account_id')
            if 'transaction_date' in v1_df.columns:
                dedup_cols.append('transaction_date')
            elif 'transaction_datetime' in v1_df.columns:
                dedup_cols.append('transaction_datetime')
            if 'transaction_amount' in v1_df.columns:
                dedup_cols.append('transaction_amount')
            
            if dedup_cols:
                v1_df = v1_df.drop_duplicates(subset=dedup_cols)
        
        if len(v1_df) < initial_count:
            print(f"   🧹 Cleaned duplicates: {initial_count} -> {len(v1_df)} rows")
        
        return v1_df, env_id
    
    def _load_all_transactions(self, env_id):
        """
        🔥 FIXED: Load transactions from calibration view instead of non-existent unified table
        
        The calibration view already contains all joined data from Step 0.
        We just need to extract the raw transactions for the aggregation engine.
        """
        conn = self.db.connect()
        view_name = f"{env_id}_calibration_data"
        
        try:
            # 🔥 NEW: Use the calibration view created in Step 0
            print(f"📊 [AGG SERVICE] Loading transactions from view: {view_name}")
            
            # Select only transaction-related columns to minimize data load
            query = f'SELECT * FROM "{view_name}"'
            
            all_txns_df = pd.read_sql(query, conn)
            all_txns_df.columns = [c.lower().strip().replace(' ', '_') for c in all_txns_df.columns]
            
            print(f"✅ [AGG SERVICE] Loaded {len(all_txns_df):,} rows from view")
            
            # 🔥 NEW: Smart column mapping for view columns
            # The view has prefixed columns like t0_transaction_date, t0_transaction_amount
            column_map = {}
            
            for col in all_txns_df.columns:
                col_lower = col.lower()
                
                # Transaction date mapping
                if 'transaction_date' in col_lower or 'transaction_datetime' in col_lower:
                    if 'transaction_date' not in column_map:
                        column_map[col] = 'transaction_date'
                
                # Transaction amount mapping
                elif 'transaction_amount' in col_lower or col_lower.endswith('_amount'):
                    if 'transaction_amount' not in column_map:
                        column_map[col] = 'transaction_amount'
                
                # Transaction ID mapping
                elif 'transaction_id' in col_lower:
                    if 'transaction_id' not in column_map:
                        column_map[col] = 'transaction_id'
                
                # Account ID mapping
                elif 'account_id' in col_lower:
                    if 'account_id' not in column_map:
                        column_map[col] = 'account_id'
                
                # Customer ID mapping
                elif 'customer_id' in col_lower:
                    if 'customer_id' not in column_map:
                        column_map[col] = 'customer_id'
                
                # Transaction category mapping
                elif 'transaction_category' in col_lower or col_lower.endswith('_category'):
                    if 'transaction_category' not in column_map:
                        column_map[col] = 'transaction_category'
                
                # Transaction type mapping
                elif 'transaction_type' in col_lower or col_lower.endswith('_type'):
                    if 'transaction_type' not in column_map:
                        column_map[col] = 'transaction_type'
            
            # Rename mapped columns
            if column_map:
                all_txns_df.rename(columns=column_map, inplace=True)
                print(f"📋 [AGG SERVICE] Mapped columns: {list(column_map.values())}")
            
            # Type conversion
            if 'transaction_date' in all_txns_df.columns:
                all_txns_df['transaction_date'] = pd.to_datetime(
                    all_txns_df['transaction_date'], 
                    errors='coerce'
                )
                print(f"✅ [AGG SERVICE] Parsed transaction_date")
            
            if 'transaction_amount' in all_txns_df.columns:
                all_txns_df['transaction_amount'] = pd.to_numeric(
                    all_txns_df['transaction_amount'], 
                    errors='coerce'
                ).fillna(0.0)
                print(f"✅ [AGG SERVICE] Parsed transaction_amount")
            
            # Ensure required columns exist
            required_cols = ['transaction_date', 'transaction_amount', 'account_id']
            missing_cols = [col for col in required_cols if col not in all_txns_df.columns]
            
            if missing_cols:
                raise ValueError(f"Missing required columns after mapping: {missing_cols}")
            
            print(f"✅ [AGG SERVICE] All transactions loaded successfully")
            return all_txns_df
            
        except Exception as e:
            print(f"❌ [AGG SERVICE] Failed to load transactions: {e}")
            raise
        finally:
            conn.close()
    
    def preview_aggregation_impact(self, run_id, aggregation_config):
        """Preview with complete insights"""
        # Validate config
        validation = self.config_service.validate_config(aggregation_config)
        if not validation['valid']:
            # Try to fix missing defaults if validation fails initially
            defaults = self.config_service.get_defaults()
            aggregation_config = {**defaults, **aggregation_config}
            validation = self.config_service.validate_config(aggregation_config)
            
            if not validation['valid']:
                raise ValueError(f"Invalid config: {validation['errors']}")
        
        # Load data
        v1_df, env_id = self._load_step1_population(run_id, limit=50000)
        all_txns_df = self._load_all_transactions(env_id)
        
        if v1_df.empty:
            return self._empty_preview_response()
        
        # Prepare engine config
        engine_config = self.config_service.prepare_for_engine(aggregation_config)
        
        # Aggregate
        agg_engine = AggregationEngine(v1_df, all_txns_df)
        v2_df, engine_stats = agg_engine.aggregate(engine_config)
        
        # Compute all statistics
        compression_stats = self.stats_service.compute_compression_stats(v1_df, v2_df)
        entity_col = f"{aggregation_config['level']}_id"
        entity_stats = self.stats_service.compute_entity_stats(v2_df, entity_col)
        metric_stats = self.stats_service.compute_metric_stats(
            v2_df, 
            aggregation_config.get('metrics', []),
            engine_config['lookback_days']
        )
        
        # Generate visuals
        visuals = self.visual_service.prepare_visual_bundle(
            v1_df, v2_df, engine_config, engine_config['lookback_days']
        )
        
        # Generate narrative
        combined_stats = {
            **compression_stats,
            'stats': metric_stats,
            'entity_stats': entity_stats
        }
        narrative = self.narrative_service.generate_full_explanation(
            aggregation_config,
            combined_stats
        )
        
        # ✅ Health checks
        health_checks = self.health_service.run_health_checks(v1_df, v2_df, engine_config)
        
        # ✅ Grain validation
        grain_validation = self.validator_service.validate_aggregation_grain(v2_df, aggregation_config)
        
        # ✅ Cardinality analysis
        cardinality = self.validator_service.compute_entity_cardinality(v2_df, v1_df, aggregation_config)
        
        # ✅ Cross-entity spill (customer mode)
        cross_entity_spill = self.validator_service.detect_cross_entity_spill(v2_df, aggregation_config)
        
        # ✅ Behavior stability
        behavior_stability = self.validator_service.compute_behavior_stability(v2_df, aggregation_config)
        
        # ✅ Missed behavior warnings
        missed_warnings = self.insight_service.generate_missed_behavior_warnings(aggregation_config)
        
        # ✅ Calibration risk preview
        calibration_risks = self.insight_service.generate_calibration_risk_preview(v2_df, aggregation_config)
        
        # ✅ Snapshot explainer
        snapshot_explainer = self.insight_service.generate_snapshot_explainer(v2_df, aggregation_config)
        
        # Sample rows
        preview_rows = v2_df.head(50).copy()
        for col in preview_rows.select_dtypes(include=['datetime64']).columns:
            preview_rows[col] = preview_rows[col].dt.strftime('%Y-%m-%d')
        
        return {
            **compression_stats,
            'stats': {
                **metric_stats,
                **entity_stats,
                'cardinality': cardinality,
                'behavior_stability': behavior_stability
            },
            'visuals': visuals,
            'narrative': narrative,
            'health_checks': health_checks,
            'grain_validation': grain_validation,
            'cross_entity_spill': cross_entity_spill,
            'missed_warnings': missed_warnings,
            'calibration_risks': calibration_risks,
            'snapshot_explainer': snapshot_explainer,
            'sample_rows': preview_rows.to_dict('records'),
            'config_validation': validation,
            'aggregated_df': v2_df
        }
    
    def _empty_preview_response(self):
        """Return empty response structure"""
        return {
            'input_rows': 0,
            'output_rows': 0,
            'compression_ratio': 0,
            'stats': {},
            'visuals': {},
            'narrative': {},
            'health_checks': [],
            'grain_validation': {},
            'cross_entity_spill': None,
            'missed_warnings': [],
            'calibration_risks': [],
            'snapshot_explainer': None,
            'sample_rows': []
        }
    
    def execute_aggregation(self, run_id, aggregation_config):
        """
        Execute full aggregation
        Handles both UI config (lookback_value) and Engine config (lookback_days)
        
        ✅ UPDATED: Now caches aggregated population for fast retrieval
        """
        # 1. Validation with fallback
        validation = self.config_service.validate_config(aggregation_config)
        if not validation['valid']:
            print(f"⚠️ Config validation warning: {validation['errors']}. Attempting to merge defaults.")
            defaults = self.config_service.get_defaults()
            safe_config = {**defaults, **aggregation_config}
            
            validation = self.config_service.validate_config(safe_config)
            if validation['valid']:
                aggregation_config = safe_config
            else:
                raise ValueError(f"Invalid config: {validation['errors']}")
        
        # 2. Load full data
        v1_df, env_id = self._load_step1_population(run_id, limit=None)
        all_txns_df = self._load_all_transactions(env_id)
        
        if v1_df.empty:
            raise ValueError("Step 1 returned 0 rows")
        
        # 3. Prepare and execute
        engine_config = self.config_service.prepare_for_engine(aggregation_config)
        agg_engine = AggregationEngine(v1_df, all_txns_df)
        v2_df, engine_stats = agg_engine.aggregate(engine_config)
        
        # ================================================================
        # ✅ Cache the aggregated population immediately
        # ================================================================
        from calibration.shared.calibration_helpers import cache_aggregated_population
        
        cache_metadata = {
            'level': aggregation_config['level'],
            'lookback_days': engine_config['lookback_days'],
            'frequency': aggregation_config.get('frequency', 'daily'),
            'metrics': aggregation_config.get('metrics', [])
        }
        
        cache_success = cache_aggregated_population(run_id, v2_df, cache_metadata, self.db)
        
        if cache_success:
            print(f"✅ Cached aggregation result for {run_id}")
        else:
            print(f"⚠️ Warning: Failed to cache aggregation (will impact performance)")
        # ================================================================
        
        # 4. Compute stats
        compression_stats = self.stats_service.compute_compression_stats(v1_df, v2_df)
        entity_col = f"{aggregation_config['level']}_id"
        entity_stats = self.stats_service.compute_entity_stats(v2_df, entity_col)
        metric_stats = self.stats_service.compute_metric_stats(
            v2_df,
            aggregation_config.get('metrics', []),
            engine_config['lookback_days']
        )
        
        # 5. Store metadata
        aggregation_id = str(uuid.uuid4())
        self._store_aggregation_result(
            aggregation_id, run_id, v2_df,
            aggregation_config, {**compression_stats, **entity_stats, **metric_stats}
        )
        
        # Update run status
        conn = self.db.connect()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE calibration_runs
            SET aggregation_config = ?,
                aggregated_population_count = ?,
                status = 'aggregated',
                current_step = 3,
                updated_at = CURRENT_TIMESTAMP
            WHERE run_id = ?
        """, (json.dumps(aggregation_config), len(v2_df), run_id))
        conn.commit()
        conn.close()
        
        return {
            'aggregation_id': aggregation_id,
            'stats': {**compression_stats, **entity_stats, **metric_stats},
            'aggregated_df': v2_df 
        }
    
    def _store_aggregation_result(self, aggregation_id, run_id, df, config, stats):
        """Store aggregation metadata"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("DELETE FROM aggregated_populations WHERE run_id = ?", (run_id,))
        
        amount_stats = stats.get('amount', {})
        lookback_days = self.config_service.normalize_to_days(
            config.get('lookback_value', None),
            config.get('lookback_unit', 'days')
        )
        if lookback_days is None or lookback_days == 30:
             lookback_days = config.get('lookback_days', 30)

        cursor.execute("""
            INSERT INTO aggregated_populations
            (aggregation_id, run_id, aggregation_level, lookback_days, frequency,
             row_count, unique_entities, min_amount, max_amount, mean_amount, median_amount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            aggregation_id, run_id,
            config['level'], lookback_days, config.get('frequency', 'daily'),
            len(df), stats.get('unique_entities', 0),
            amount_stats.get('min', 0), amount_stats.get('max', 0),
            amount_stats.get('mean', 0), amount_stats.get('median', 0)
        ))
        
        conn.commit()
        conn.close()
    
    def get_aggregation_result(self, run_id):
        """Retrieve aggregation results"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT aggregation_id, aggregation_level, lookback_days, frequency,
                   row_count, unique_entities, min_amount, max_amount, mean_amount, median_amount
            FROM aggregated_populations
            WHERE run_id = ?
            ORDER BY created_at DESC LIMIT 1
        """, (run_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
        
        return {
            'aggregation_id': row[0],
            'level': row[1],
            'lookback_days': row[2],
            'frequency': row[3],
            'row_count': row[4],
            'unique_entities': row[5],
            'amount_stats': {
                'min': row[6], 'max': row[7],
                'mean': row[8], 'median': row[9]
            }
        }