# backend/calibration/services/aggregation_validator_service.py
"""
Aggregation Validator Service
Validates grain, cardinality, and structural integrity
"""
import pandas as pd
import numpy as np

class AggregationValidatorService:
    """Validate aggregation grain and structure"""
    
    @staticmethod
    def validate_aggregation_grain(v2_df, config):
        """
        Validate aggregation grain and detect fake aggregation
        Returns grain validation report
        """
        entity_col = f"{config['level']}_id"
        lookback_days = config.get('lookback_days', 30)
        
        validation = {
            'entity_type': config['level'],
            'time_grain': config.get('frequency', 'daily'),
            'lookback_days': lookback_days,
            'issues': [],
            'warnings': []
        }
        
        if entity_col not in v2_df.columns:
            validation['issues'].append({
                'severity': 'error',
                'message': f'Entity column {entity_col} not found'
            })
            return validation
        
        # Check 1: Transactions per snapshot
        count_col = f"agg_{lookback_days}d_count"
        if count_col in v2_df.columns:
            median_txns = v2_df[count_col].median()
            p90_txns = v2_df[count_col].quantile(0.9)
            single_txn_pct = (v2_df[count_col] == 1).sum() / len(v2_df) * 100
            
            validation['median_txns_per_snapshot'] = int(median_txns)
            validation['p90_txns_per_snapshot'] = int(p90_txns)
            
            # Detect fake aggregation
            if median_txns < 2:
                validation['issues'].append({
                    'severity': 'critical',
                    'message': 'Fake aggregation detected',
                    'detail': f'Median {median_txns} txn/snapshot - aggregation not meaningful'
                })
            elif single_txn_pct > 40:
                validation['warnings'].append({
                    'severity': 'warning',
                    'message': 'High single-transaction rate',
                    'detail': f'{single_txn_pct:.0f}% snapshots have only 1 transaction'
                })
            else:
                validation['status'] = 'pass'
                validation['message'] = f'Median {int(median_txns)} transactions per snapshot'
        
        # Check 2: Entity coverage
        unique_entities = v2_df[entity_col].nunique()
        snapshots_per_entity = len(v2_df) / unique_entities if unique_entities > 0 else 0
        
        validation['unique_entities'] = unique_entities
        validation['avg_snapshots_per_entity'] = round(snapshots_per_entity, 1)
        
        if snapshots_per_entity < 2:
            validation['warnings'].append({
                'severity': 'info',
                'message': 'Most entities have single snapshot',
                'detail': 'Limited temporal behavior captured'
            })
        
        return validation
    
    @staticmethod
    def compute_entity_cardinality(v2_df, v1_df, config):
        """
        Compute entity cardinality statistics
        Answers: "Is customer-level aggregation justified?"
        """
        entity_col = f"{config['level']}_id"
        
        cardinality = {
            'entity_type': config['level'],
            'unique_entities': v2_df[entity_col].nunique() if entity_col in v2_df.columns else 0
        }
        
        # Customer-specific: Check account cardinality
        if config['level'] == 'customer':
            if 'account_id' in v2_df.columns and 'customer_id' in v2_df.columns:
                # Accounts per customer
                accounts_per_customer = v2_df.groupby('customer_id')['account_id'].nunique()
                
                cardinality['avg_accounts_per_entity'] = round(accounts_per_customer.mean(), 1)
                cardinality['max_accounts_per_entity'] = int(accounts_per_customer.max())
                cardinality['pct_multi_account'] = round(
                    (accounts_per_customer > 1).sum() / len(accounts_per_customer) * 100, 1
                )
                
                # Validation
                if cardinality['pct_multi_account'] < 20:
                    cardinality['recommendation'] = 'Most customers have single account - customer-level may not add value'
                elif cardinality['avg_accounts_per_entity'] > 3:
                    cardinality['recommendation'] = 'Customer-level aggregation justified - significant account consolidation'
                else:
                    cardinality['recommendation'] = 'Moderate account consolidation - customer-level is valid'
        
        # Account-specific: Check transaction distribution
        elif config['level'] == 'account':
            lookback_days = config.get('lookback_days', 30)
            count_col = f"agg_{lookback_days}d_count"
            
            if count_col in v2_df.columns:
                median_txns = v2_df[count_col].median()
                
                if median_txns < 3:
                    cardinality['recommendation'] = 'Low transaction density - consider customer-level aggregation'
                else:
                    cardinality['recommendation'] = 'Account-level aggregation captures meaningful behavior'
        
        return cardinality
    
    @staticmethod
    def detect_cross_entity_spill(v2_df, config):
        """
        Customer mode only: Detect cross-account activity
        Validates if customer-level is capturing real multi-account behavior
        """
        if config['level'] != 'customer':
            return None
        
        if 'account_id' not in v2_df.columns or 'customer_id' not in v2_df.columns:
            return None
        
        lookback_days = config.get('lookback_days', 30)
        
        # Group by customer + date, count unique accounts
        if 'transaction_date' in v2_df.columns:
            accounts_per_snapshot = v2_df.groupby(['customer_id', 'transaction_date'])['account_id'].nunique()
            
            spill = {
                'median_active_accounts': round(accounts_per_snapshot.median(), 1),
                'p90_active_accounts': int(accounts_per_snapshot.quantile(0.9)),
                'pct_multi_account_snapshots': round(
                    (accounts_per_snapshot > 1).sum() / len(accounts_per_snapshot) * 100, 1
                )
            }
            
            # Interpretation
            if spill['pct_multi_account_snapshots'] < 10:
                spill['interpretation'] = 'Minimal cross-account activity - customer aggregation may over-smooth'
            elif spill['pct_multi_account_snapshots'] > 30:
                spill['interpretation'] = 'Significant cross-account activity - customer-level captures coordination'
            else:
                spill['interpretation'] = 'Moderate cross-account activity detected'
            
            return spill
        
        return None
    
    @staticmethod
    def compute_behavior_stability(v2_df, config):
        """
        Compute behavior stability signal
        NO thresholds - pure variance analysis
        """
        lookback_days = config.get('lookback_days', 30)
        metrics = config.get('metrics', [])
        
        stability = {}
        
        # Amount stability
        if 'amount' in metrics or 'sum_amount' in metrics:
            amount_col = f"agg_{lookback_days}d_amount"
            if amount_col in v2_df.columns:
                values = v2_df[amount_col].dropna()
                if len(values) > 0 and values.mean() > 0:
                    cv = values.std() / values.mean()
                    
                    stability['sum_amount'] = {
                        'metric': 'SUM(amount)',
                        'cv': round(cv, 2),
                        'interpretation': 'stable' if cv < 0.5 else 'moderate' if cv < 1.5 else 'volatile'
                    }
        
        # Count stability
        if 'count' in metrics:
            count_col = f"agg_{lookback_days}d_count"
            if count_col in v2_df.columns:
                values = v2_df[count_col].dropna()
                if len(values) > 0 and values.mean() > 0:
                    cv = values.std() / values.mean()
                    
                    stability['count'] = {
                        'metric': 'COUNT(*)',
                        'cv': round(cv, 2),
                        'interpretation': 'stable' if cv < 0.5 else 'bursty'
                    }
        
        return stability