# backend/calibration/services/report_data_service.py
"""
Report Data Service
Aggregates data from all steps for report generation
"""
from asyncio import run
import json
from datetime import datetime

class ReportDataService:
    """Collects and structures data for reports"""
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def collect_report_data(self, run_id, env_id):
        """
        Aggregate all data needed for comprehensive report
        Returns structured dict matching UI report sections
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        # 1. Core Run Data
        cursor.execute("SELECT * FROM calibration_runs WHERE run_id = ?", (run_id,))
        run = dict(cursor.fetchone())
        
        # 2. Step 0: Data Foundation
        data_foundation = self._get_data_foundation(cursor, run)
        
        # 3. Step 1: Scenario/Population
        scenario_analysis = self._get_scenario_analysis(cursor, run_id, run)
        
        # 4. Step 2: Aggregation
        aggregation_analysis = self._get_aggregation_analysis(cursor, run_id, run)
        
        # 5. Step 3: Threshold Calibration
        threshold_analysis = self._get_threshold_analysis(cursor, run_id, run)
        ks_analysis = self._get_ks_analysis(cursor, run_id, run)
    
    # 7. ATL/BTL Analysis (NEW)
        atl_btl_analysis = self._get_atl_btl_analysis(cursor, run_id, run)
        # 6. Step 4: Approval/Governance
        governance_data = self._get_governance_data(cursor, run_id, run)
        
        # 7. Optional: Bank Comparison
        comparison_data = self._get_comparison_data(cursor, run_id)
        
        conn.close()
        
        # Assemble complete report
        return {
            'meta': {
                'run_id': run_id,
                'scenario': run['scenario_name'],
                'env_id': env_id,
                'created_at': run['created_at'],
                'created_by': run['created_by'],
                'status': run['status'],
                'generated_at': datetime.now().isoformat()
            },
            'data_foundation': data_foundation,
            'scenario_analysis': scenario_analysis,
            'aggregation_analysis': aggregation_analysis,
            'threshold_analysis': threshold_analysis,
            'ks_statistics': ks_analysis,      # NEW
            'atl_btl_analysis': atl_btl_analysis,
            'governance': governance_data,
            'comparison': comparison_data,
            'recommendations': self._generate_recommendations(run, threshold_analysis)
        }
    
    def _get_data_foundation(self, cursor, run):
        """
        Step 0: Data Foundation summary
        Uses calibration metadata instead of physical tables
        """

        # Base population already computed during Step 1
        base_txn_count = run.get('base_population_count', 0)

        # Fetch Step-0 cached metadata (if available)
        cursor.execute("""
            SELECT metadata
            FROM golden_dataset_cache
            WHERE env_id = ? AND status = 'ready'
            ORDER BY created_at DESC
            LIMIT 1
        """, (run['env_id'],))

        row = cursor.fetchone()
        meta = json.loads(row['metadata']) if row and row['metadata'] else {}
        join_stats = meta.get('join_stats', {})

        return {
            'total_transactions': base_txn_count,
            'account_match_rate': join_stats.get('account_match_rate'),
            'customer_match_rate': join_stats.get('customer_match_rate'),
            'data_quality_score': meta.get('quality_score', 'N/A'),
            'join_strategy': meta.get('join_strategy', 'User-defined logical joins')
        }

    
    def _get_scenario_analysis(self, cursor, run_id, run):
        """Step 1: Population filtering"""
        filters = json.loads(run.get('population_filters') or '{}')
        
        return {
            'filters_applied': list(filters.keys()),
            'filter_details': filters,
            'original_count': run.get('base_population_count', 0),
            'final_count': run.get('v1_population_count', 0),
            'reduction_pct': round(
                (1 - run.get('v1_population_count', 0) / run.get('base_population_count', 1)) * 100, 2
            ),
            'logic_summary': self._build_filter_summary(filters)
        }
    
    def _get_aggregation_analysis(self, cursor, run_id, run):
        """Step 2: Aggregation transformation"""
        config = json.loads(run.get('aggregation_config') or '{}')
        
        return {
            'config': config,
            'input_rows': run.get('v1_population_count', 0),
            'output_rows': run.get('aggregated_population_count', 0),
            'unique_entities': run.get('unique_entity_count', 0),
            'compression_ratio': round(
                run.get('v1_population_count', 0) / max(run.get('aggregated_population_count', 1), 1), 1
            ),
            'aggregation_level': config.get('level', 'account'),
            'lookback_days': config.get('lookback_days', 90),
            'frequency': config.get('frequency', 'monthly')
        }
    
    def _get_threshold_analysis(self, cursor, run_id, run):
        """Step 3: Threshold selection"""
        # Get percentile distribution
        cursor.execute("""
            SELECT percentile, value, alert_count, pct_population
            FROM calibration_percentiles
            WHERE run_id = ?
            ORDER BY percentile
        """, (run_id,))
        
        percentiles = [dict(row) for row in cursor.fetchall()]
        
        # Get selected threshold details
        cursor.execute("""
            SELECT * FROM selected_thresholds WHERE run_id = ?
        """, (run_id,))
        
        selected = cursor.fetchone()
        selected_data = dict(selected) if selected else {}
        
        return {
            'percentile_distribution': percentiles,
            'selected_threshold': run.get('selected_threshold'),
            'selected_percentile': run.get('selected_percentile'),
            'estimated_alerts': run.get('estimated_alert_count'),
            'pct_flagged': round(
                run.get('estimated_alert_count', 0) / max(run.get('aggregated_population_count', 1), 1) * 100, 2
            ),
            'rationale': selected_data.get('rationale', 'Data-driven percentile selection'),
            'selection_method': 'Percentile-based distribution analysis'
        }

    def _get_ks_analysis(self, cursor, run_id, run):
        """Get KS statistics for the selected threshold"""
        threshold = run.get('selected_threshold')
        if not threshold:
            return None
        
        try:
            from calibration.services.calibration_ks_service import CalibrationKSService
            ks_service = CalibrationKSService(self.db)
            return ks_service.compute_ks_statistic(run_id, threshold)
        except:
            return None

    def _get_atl_btl_analysis(self, cursor, run_id, run):
        """Get ATL/BTL split analysis"""
        threshold = run.get('selected_threshold')
        if not threshold:
            return None
        
        try:
            from calibration.services.calibration_atl_btl_service import CalibrationATLBTLService
            atl_btl_service = CalibrationATLBTLService(self.db)
            return atl_btl_service.compute_atl_btl_split(run_id, threshold)
        except:
            return None
    
    def _get_governance_data(self, cursor, run_id, run):
        """Step 4: Approval metadata"""
        return {
            'status': run['status'],
            'approved_by': run.get('approved_by'),
            'approved_at': run.get('approved_at'),
            'approval_comment': run.get('approval_comment'),
            'is_locked': run['status'] in ['approved', 'rejected']
        }
    
    def _get_comparison_data(self, cursor, run_id):
        """Optional: Bank alert comparison"""
        try:
            cursor.execute("""
                SELECT * FROM bank_alert_comparison
                WHERE run_id = ?
                ORDER BY created_at DESC LIMIT 1
            """, (run_id,))
            
            row = cursor.fetchone()
            if not row:
                return None
            
            comp = dict(row)
            tp = comp['common_alerts']
            fp = comp['tool_only_alerts']
            fn = comp['bank_only_alerts']
            
            precision = round(tp / (tp + fp) * 100, 2) if (tp + fp) > 0 else 0
            recall = round(tp / (tp + fn) * 100, 2) if (tp + fn) > 0 else 0
            f1 = round(2 * precision * recall / (precision + recall), 2) if (precision + recall) > 0 else 0
            
            return {
                'matched': tp,
                'tool_only': fp,
                'bank_only': fn,
                'precision': precision,
                'recall': recall,
                'f1_score': f1
            }
        except:
            return None
    
    def _generate_recommendations(self, run, threshold_analysis):
        """Generate deployment recommendations"""
        threshold = run.get('selected_threshold', 0)
        alerts = run.get('estimated_alert_count', 0)
        
        return {
            'deployment': f"Deploy threshold of ₹{threshold:,.0f} in staging for 30-day pilot",
            'monitoring': f"Track actual alert volume against estimate of {alerts:,} per period",
            'review_cadence': "Quarterly re-calibration or when behavioral shifts detected",
            'audit_retention': "Maintain full audit trail for regulatory review",
            'team_training': "Brief investigation team on statistical methodology"
        }
    
    def _build_filter_summary(self, filters):
        """Generate human-readable filter summary"""
        if not filters:
            return "No filters applied"
        
        parts = []
        for key, val in filters.items():
            parts.append(f"{key}: {val}")
        
        return " AND ".join(parts)