# backend/calibration/services/aggregation_stats_service.py
"""
Aggregation Stats Service
Computes compression, coverage, and impact metrics
"""
import pandas as pd
from datetime import datetime, timedelta

class AggregationStatsService:
    """Compute aggregation statistics"""
    
    @staticmethod
    def compute_compression_stats(v1_df, v2_df):
        """Compute input → output compression"""
        input_rows = len(v1_df)
        output_rows = len(v2_df)
        compression_ratio = round(input_rows / output_rows, 2) if output_rows > 0 else 0
        
        return {
            'input_rows': input_rows,
            'output_rows': output_rows,
            'compression_ratio': compression_ratio,
            'compression_pct': round((1 - output_rows / input_rows) * 100, 1) if input_rows > 0 else 0
        }
    
    @staticmethod
    def compute_coverage_stats(df, date_col='transaction_date', freq='D'):
        """Compute time coverage statistics"""
        if df.empty or date_col not in df.columns:
            return []
        
        df_copy = df.copy()
        df_copy[date_col] = pd.to_datetime(df_copy[date_col], errors='coerce')
        df_copy = df_copy.dropna(subset=[date_col])
        
        if df_copy.empty:
            return []
        
        # Group by time period
        df_copy['period'] = df_copy[date_col].dt.to_period(freq)
        coverage = df_copy.groupby('period').size().reset_index(name='row_count')
        coverage['period'] = coverage['period'].astype(str)
        
        return coverage.to_dict('records')
    
    @staticmethod
    def compute_metric_stats(df, metrics, lookback_days):
        """Compute stats for each metric"""
        stats = {}
        
        # Amount metrics
        amount_col = f"agg_{lookback_days}d_amount"
        if amount_col in df.columns:
            values = df[amount_col].dropna()
            if len(values) > 0:
                stats['amount'] = {
                    'min': float(values.min()),
                    'max': float(values.max()),
                    'mean': float(values.mean()),
                    'median': float(values.median()),
                    'std': float(values.std()) if len(values) > 1 else 0,
                    'sum': float(values.sum()),
                    'zeros': int((values == 0).sum()),
                    'zeros_pct': round((values == 0).sum() / len(values) * 100, 1)
                }
        
        # Count metrics
        count_col = f"agg_{lookback_days}d_count"
        if count_col in df.columns:
            values = df[count_col].dropna()
            if len(values) > 0:
                stats['count'] = {
                    'min': int(values.min()),
                    'max': int(values.max()),
                    'mean': float(values.mean()),
                    'median': float(values.median()),
                    'zeros': int((values == 0).sum()),
                    'zeros_pct': round((values == 0).sum() / len(values) * 100, 1)
                }
        
        return stats
    
    @staticmethod
    def compute_entity_stats(df, entity_col):
        """Compute entity-level statistics"""
        if entity_col not in df.columns:
            return {}
        
        unique_entities = df[entity_col].nunique()
        rows_per_entity = df.groupby(entity_col).size()
        
        return {
            'unique_entities': unique_entities,
            'min_rows_per_entity': int(rows_per_entity.min()),
            'max_rows_per_entity': int(rows_per_entity.max()),
            'avg_rows_per_entity': round(rows_per_entity.mean(), 1)
        }
    
    @staticmethod
    def detect_anomalies(df, metrics, lookback_days):
        """Detect potential data quality issues"""
        warnings = []
        
        # Check for high zero rate
        amount_col = f"agg_{lookback_days}d_amount"
        if amount_col in df.columns:
            zero_rate = (df[amount_col] == 0).sum() / len(df) * 100
            if zero_rate > 30:
                warnings.append({
                    'type': 'high_zero_rate',
                    'message': f"{zero_rate:.1f}% of rows have zero amount",
                    'severity': 'warning'
                })
        
        # Check for date gaps
        if 'transaction_date' in df.columns:
            dates = pd.to_datetime(df['transaction_date'], errors='coerce').dropna()
            if len(dates) > 0:
                date_range = (dates.max() - dates.min()).days
                unique_dates = dates.nunique()
                coverage = unique_dates / date_range * 100 if date_range > 0 else 100
                
                if coverage < 70:
                    warnings.append({
                        'type': 'sparse_coverage',
                        'message': f"Only {coverage:.1f}% date coverage in range",
                        'severity': 'warning'
                    })
        
        return warnings