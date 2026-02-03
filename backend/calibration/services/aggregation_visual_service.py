# backend/calibration/services/aggregation_visual_service.py
"""
Aggregation Visual Service
Generates data for investigator-grade visuals
"""
import pandas as pd
import numpy as np

class AggregationVisualService:
    """Generate visual data for Step 2"""
    
    @staticmethod
    def generate_compression_flow(v1_df, v2_df, entity_col):
        """Generate compression flow visual data"""
        return {
            'input': {
                'label': 'Input (v1)',
                'rows': len(v1_df),
                'unique_entities': v1_df[entity_col].nunique() if entity_col in v1_df.columns else 0
            },
            'output': {
                'label': 'Output (v2)',
                'rows': len(v2_df),
                'unique_entities': v2_df[entity_col].nunique() if entity_col in v2_df.columns else 0
            },
            'compression_ratio': round(len(v1_df) / len(v2_df), 2) if len(v2_df) > 0 else 0
        }
    
    @staticmethod
    def generate_time_series_sample(df, entity_col, date_col, metric_cols, n_samples=2):
        """Generate time-series data for sample entities"""
        if df.empty or entity_col not in df.columns:
            return []
        
        # Pick entities with most data points
        entity_counts = df[entity_col].value_counts().head(n_samples)
        sample_entities = entity_counts.index.tolist()
        
        result = []
        for entity_id in sample_entities:
            entity_df = df[df[entity_col] == entity_id].copy()
            entity_df = entity_df.sort_values(date_col)
            
            series_data = []
            for _, row in entity_df.iterrows():
                point = {'date': str(row[date_col])}
                for col in metric_cols:
                    if col in row:
                        point[col] = float(row[col]) if pd.notna(row[col]) else 0
                series_data.append(point)
            
            result.append({
                'entity_id': str(entity_id),
                'data_points': len(series_data),
                'series': series_data
            })
        
        return result
    
    @staticmethod
    def generate_coverage_chart(df, date_col='transaction_date', freq='D'):
        """Generate time coverage chart data"""
        if df.empty or date_col not in df.columns:
            return []
        
        df_copy = df.copy()
        df_copy[date_col] = pd.to_datetime(df_copy[date_col], errors='coerce')
        df_copy = df_copy.dropna(subset=[date_col])
        
        if df_copy.empty:
            return []
        
        # Group by period
        df_copy['period'] = df_copy[date_col].dt.to_period(freq)
        coverage = df_copy.groupby('period').agg({
            date_col: 'count'
        }).reset_index()
        coverage.columns = ['period', 'row_count']
        coverage['period'] = coverage['period'].astype(str)
        
        # Add percentage
        total = coverage['row_count'].sum()
        coverage['pct'] = round(coverage['row_count'] / total * 100, 1)
        
        return coverage.to_dict('records')
    
    @staticmethod
    def generate_metric_relationship(df, metric1_col, metric2_col, sample_size=500):
        """Generate metric relationship scatter data (sampled)"""
        if df.empty or metric1_col not in df.columns or metric2_col not in df.columns:
            return []
        
        # Sample for performance
        sample_df = df[[metric1_col, metric2_col]].dropna()
        if len(sample_df) > sample_size:
            sample_df = sample_df.sample(n=sample_size, random_state=42)
        
        return [
            {
                'x': float(row[metric1_col]),
                'y': float(row[metric2_col])
            }
            for _, row in sample_df.iterrows()
        ]
    
    @staticmethod
    def prepare_visual_bundle(v1_df, v2_df, config, lookback_days):
        """Generate complete visual bundle"""
        entity_col = f"{config['level']}_id"
        date_col = 'transaction_date'
        
        # Determine metric columns
        metric_cols = []
        if 'amount' in config.get('metrics', []):
            metric_cols.extend([
                f"agg_{lookback_days}d_amount",
                f"avg_{lookback_days}d_amount"
            ])
        if 'count' in config.get('metrics', []):
            metric_cols.append(f"agg_{lookback_days}d_count")
        
        # Filter to existing columns
        metric_cols = [c for c in metric_cols if c in v2_df.columns]
        
        return {
            'compression_flow': AggregationVisualService.generate_compression_flow(
                v1_df, v2_df, entity_col
            ),
            'time_series_sample': AggregationVisualService.generate_time_series_sample(
                v2_df, entity_col, date_col, metric_cols, n_samples=2
            ),
            'coverage_chart': AggregationVisualService.generate_coverage_chart(
                v2_df, date_col, freq='D'
            )
        }