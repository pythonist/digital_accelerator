# backend/calibration/services/aggregation_health_service.py
"""
Aggregation Health Service
Pre-flight sanity checks for aggregation configuration
"""
import pandas as pd
import numpy as np

class AggregationHealthService:
    """Generate aggregation health checks"""
    
    @staticmethod
    def run_health_checks(v1_df, v2_df, config):
        """Run comprehensive health checks"""
        checks = []
        
        entity_col = f"{config['level']}_id"
        
        # Check 1: Entity definition consistency
        v1_entities = v1_df[entity_col].nunique() if entity_col in v1_df.columns else 0
        v2_entities = v2_df[entity_col].nunique() if entity_col in v2_df.columns else 0
        
        if v1_entities == v2_entities:
            checks.append({
                'status': 'pass',
                'message': 'Entity definition consistent',
                'detail': f'{v2_entities} unique entities preserved'
            })
        else:
            checks.append({
                'status': 'warning',
                'message': 'Entity count mismatch',
                'detail': f'v1: {v1_entities}, v2: {v2_entities}'
            })
        
        # Check 2: Multi-transaction snapshots
        if 'agg_' in ''.join(v2_df.columns):
            lookback_days = config.get('lookback_days', 30)
            count_col = f"agg_{lookback_days}d_count"
            
            if count_col in v2_df.columns:
                median_txns = v2_df[count_col].median()
                pct_single = (v2_df[count_col] == 1).sum() / len(v2_df) * 100
                
                if median_txns >= 2:
                    checks.append({
                        'status': 'pass',
                        'message': 'Rolling window produces multi-transaction snapshots',
                        'detail': f'Median {int(median_txns)} transactions per snapshot'
                    })
                else:
                    checks.append({
                        'status': 'warning',
                        'message': 'Most snapshots have single transactions',
                        'detail': f'{pct_single:.0f}% snapshots are single-transaction'
                    })
        
        # Check 3: Window completeness
        window_health = AggregationHealthService._check_window_completeness(v1_df, v2_df, config)
        checks.append(window_health)
        
        # Check 4: Compression ratio
        compression = len(v1_df) / len(v2_df) if len(v2_df) > 0 else 0
        if 2 <= compression <= 50:
            checks.append({
                'status': 'pass',
                'message': 'Compression within expected range',
                'detail': f'{compression:.1f}x compression'
            })
        elif compression < 2:
            checks.append({
                'status': 'warning',
                'message': 'Low compression detected',
                'detail': f'{compression:.1f}x - output may be too granular'
            })
        else:
            checks.append({
                'status': 'warning',
                'message': 'Very high compression',
                'detail': f'{compression:.1f}x - may lose important detail'
            })
        
        # Check 5: Single-transaction dominance
        if count_col in v2_df.columns:
            single_txn_pct = (v2_df[count_col] == 1).sum() / len(v2_df) * 100
            if single_txn_pct > 30:
                checks.append({
                    'status': 'warning',
                    'message': f'{single_txn_pct:.0f}% snapshots driven by single transaction',
                    'detail': 'Consider longer lookback window'
                })
        
        return checks
    
    @staticmethod
    def _check_window_completeness(v1_df, v2_df, config):
        """Check if rolling windows have full history"""
        if 'transaction_date' not in v1_df.columns:
            return {'status': 'unknown', 'message': 'Cannot assess window completeness', 'detail': ''}
        
        lookback_days = config.get('lookback_days', 30)
        
        # Get date range
        v1_df['transaction_date'] = pd.to_datetime(v1_df['transaction_date'], errors='coerce')
        min_date = v1_df['transaction_date'].min()
        max_date = v1_df['transaction_date'].max()
        
        # Calculate how many days have full lookback
        full_window_start = min_date + pd.Timedelta(days=lookback_days - 1)
        
        if 'transaction_date' in v2_df.columns:
            v2_df['transaction_date'] = pd.to_datetime(v2_df['transaction_date'], errors='coerce')
            full_windows = v2_df[v2_df['transaction_date'] >= full_window_start]
            partial_windows = v2_df[v2_df['transaction_date'] < full_window_start]
            
            pct_partial = len(partial_windows) / len(v2_df) * 100
            
            if pct_partial < 5:
                return {
                    'status': 'pass',
                    'message': 'Nearly all snapshots have full history',
                    'detail': f'{100 - pct_partial:.0f}% with complete {lookback_days}d window'
                }
            elif pct_partial < 20:
                return {
                    'status': 'info',
                    'message': f'{pct_partial:.0f}% snapshots have partial history',
                    'detail': f'First {lookback_days - 1} days have incomplete windows'
                }
            else:
                return {
                    'status': 'warning',
                    'message': f'{pct_partial:.0f}% snapshots have partial history',
                    'detail': 'May distort early behavior patterns'
                }
        
        return {'status': 'unknown', 'message': 'Window completeness unclear', 'detail': ''}
    
    @staticmethod
    def compute_cardinality_stats(v2_df, config):
        """Compute entity cardinality statistics"""
        entity_col = f"{config['level']}_id"
        
        if entity_col not in v2_df.columns:
            return None
        
        # Snapshots per entity
        entity_counts = v2_df[entity_col].value_counts()
        
        stats = {
            'entity_type': config['level'],
            'unique_entities': len(entity_counts),
            'avg_snapshots_per_entity': float(entity_counts.mean()),
            'median_snapshots_per_entity': float(entity_counts.median()),
            'max_snapshots_per_entity': int(entity_counts.max()),
            'pct_multi_snapshot': float((entity_counts > 1).sum() / len(entity_counts) * 100)
        }
        
        # Customer-specific: account cardinality
        if config['level'] == 'customer' and 'account_id' in v2_df.columns:
            accounts_per_customer = v2_df.groupby('customer_id')['account_id'].nunique()
            stats['avg_accounts_per_entity'] = float(accounts_per_customer.mean())
            stats['max_accounts_per_entity'] = int(accounts_per_customer.max())
            stats['pct_multi_account'] = float((accounts_per_customer > 1).sum() / len(accounts_per_customer) * 100)
        
        return stats