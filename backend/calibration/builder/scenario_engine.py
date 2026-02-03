# backend/calibration/scenario_engine.py
"""
Scenario Engine - Step 1
Applies filters to golden dataset to create scenario population
"""
import pandas as pd
import json
from datetime import datetime

class ScenarioEngine:
    """
    Applies scenario filters to golden dataset.
    
    Filters include:
    - Transaction filters (category, direction, type)
    - Customer filters (risk rating, type, PEP, sanctions)
    - Account filters (type, status, dormancy)
    """
    
    def __init__(self, golden_df):
        self.golden_df = golden_df.copy()
        self.original_count = len(golden_df)
    
    def apply_scenario(self, scenario_config):
        """
        Apply all filters from scenario config.
        
        Args:
            scenario_config: dict with transaction_filters, customer_filters, account_filters
        
        Returns:
            tuple: (filtered_df, stats_dict)
        """
        df = self.golden_df.copy()
        
        stats = {
            'original_count': self.original_count,
            'filters_applied': [],
            'reduction_by_filter': {}
        }
        
        # Apply transaction filters
        if 'transaction_filters' in scenario_config:
            df, txn_stats = self._apply_transaction_filters(
                df, scenario_config['transaction_filters']
            )
            stats['filters_applied'].extend(txn_stats['filters'])
            stats['reduction_by_filter'].update(txn_stats['reduction'])
        
        # Apply customer filters
        if 'customer_filters' in scenario_config:
            df, cust_stats = self._apply_customer_filters(
                df, scenario_config['customer_filters']
            )
            stats['filters_applied'].extend(cust_stats['filters'])
            stats['reduction_by_filter'].update(cust_stats['reduction'])
        
        # Apply account filters
        if 'account_filters' in scenario_config:
            df, acc_stats = self._apply_account_filters(
                df, scenario_config['account_filters']
            )
            stats['filters_applied'].extend(acc_stats['filters'])
            stats['reduction_by_filter'].update(acc_stats['reduction'])
        
        stats['final_count'] = len(df)
        stats['total_reduction_pct'] = round(
            (1 - len(df) / self.original_count) * 100, 2
        ) if self.original_count > 0 else 0
        
        return df, stats
    
    def _apply_transaction_filters(self, df, filters):
        """Apply transaction-specific filters"""
        initial_count = len(df)
        stats = {'filters': [], 'reduction': {}}
        
        # Category filter (Cash / Non-Cash)
        if 'category' in filters and filters['category']:
            categories = filters['category'] if isinstance(filters['category'], list) else [filters['category']]
            if 'transaction_category' in df.columns:
                df = df[df['transaction_category'].isin(categories)]
                stats['filters'].append(f"Category: {', '.join(categories)}")
                stats['reduction']['category'] = initial_count - len(df)
                initial_count = len(df)
        
        # Direction filter (Debit / Credit)
        if 'direction' in filters and filters['direction']:
            directions = filters['direction'] if isinstance(filters['direction'], list) else [filters['direction']]
            if 'transaction_direction' in df.columns:
                df = df[df['transaction_direction'].isin(directions)]
                stats['filters'].append(f"Direction: {', '.join(directions)}")
                stats['reduction']['direction'] = initial_count - len(df)
                initial_count = len(df)
        
        # Transaction type filter
        if 'transaction_type' in filters and filters['transaction_type']:
            types = filters['transaction_type'] if isinstance(filters['transaction_type'], list) else [filters['transaction_type']]
            if 'transaction_type' in df.columns:
                df = df[df['transaction_type'].isin(types)]
                stats['filters'].append(f"Type: {', '.join(types)}")
                stats['reduction']['transaction_type'] = initial_count - len(df)
                initial_count = len(df)
        
        # Amount range filter
        if 'min_amount' in filters and filters['min_amount'] is not None:
            if 'transaction_amount' in df.columns:
                df = df[df['transaction_amount'] >= filters['min_amount']]
                stats['filters'].append(f"Min Amount: {filters['min_amount']}")
                stats['reduction']['min_amount'] = initial_count - len(df)
                initial_count = len(df)
        
        if 'max_amount' in filters and filters['max_amount'] is not None:
            if 'transaction_amount' in df.columns:
                df = df[df['transaction_amount'] <= filters['max_amount']]
                stats['filters'].append(f"Max Amount: {filters['max_amount']}")
                stats['reduction']['max_amount'] = initial_count - len(df)
                initial_count = len(df)
        
        # Date range filter
        if 'start_date' in filters and filters['start_date']:
            if 'transaction_date' in df.columns:
                df = df[df['transaction_date'] >= pd.to_datetime(filters['start_date'])]
                stats['filters'].append(f"Start Date: {filters['start_date']}")
                stats['reduction']['start_date'] = initial_count - len(df)
                initial_count = len(df)
        
        if 'end_date' in filters and filters['end_date']:
            if 'transaction_date' in df.columns:
                df = df[df['transaction_date'] <= pd.to_datetime(filters['end_date'])]
                stats['filters'].append(f"End Date: {filters['end_date']}")
                stats['reduction']['end_date'] = initial_count - len(df)
        
        return df, stats
    
    def _apply_customer_filters(self, df, filters):
        """Apply customer-specific filters"""
        initial_count = len(df)
        stats = {'filters': [], 'reduction': {}}
        
        # Risk rating filter
        if 'risk_rating' in filters and filters['risk_rating']:
            ratings = filters['risk_rating'] if isinstance(filters['risk_rating'], list) else [filters['risk_rating']]
            if 'risk_rating' in df.columns:
                df = df[df['risk_rating'].isin(ratings)]
                stats['filters'].append(f"Risk Rating: {', '.join(ratings)}")
                stats['reduction']['risk_rating'] = initial_count - len(df)
                initial_count = len(df)
        
        # Customer type filter
        if 'customer_type' in filters and filters['customer_type']:
            types = filters['customer_type'] if isinstance(filters['customer_type'], list) else [filters['customer_type']]
            if 'customer_type' in df.columns:
                df = df[df['customer_type'].isin(types)]
                stats['filters'].append(f"Customer Type: {', '.join(types)}")
                stats['reduction']['customer_type'] = initial_count - len(df)
                initial_count = len(df)
        
        # PEP filter
        if 'is_pep' in filters and filters['is_pep'] is not None:
            if 'is_pep' in df.columns:
                df = df[df['is_pep'] == filters['is_pep']]
                stats['filters'].append(f"PEP: {filters['is_pep']}")
                stats['reduction']['is_pep'] = initial_count - len(df)
                initial_count = len(df)
        
        # Sanctions filter
        if 'is_sanctioned' in filters and filters['is_sanctioned'] is not None:
            if 'is_sanctioned' in df.columns:
                df = df[df['is_sanctioned'] == filters['is_sanctioned']]
                stats['filters'].append(f"Sanctioned: {filters['is_sanctioned']}")
                stats['reduction']['is_sanctioned'] = initial_count - len(df)
                initial_count = len(df)
        
        # Watchlist filter
        if 'on_watchlist' in filters and filters['on_watchlist'] is not None:
            if 'on_watchlist' in df.columns:
                df = df[df['on_watchlist'] == filters['on_watchlist']]
                stats['filters'].append(f"Watchlist: {filters['on_watchlist']}")
                stats['reduction']['on_watchlist'] = initial_count - len(df)
        
        return df, stats
    
    def _apply_account_filters(self, df, filters):
        """Apply account-specific filters"""
        initial_count = len(df)
        stats = {'filters': [], 'reduction': {}}
        
        # Account type filter
        if 'account_type' in filters and filters['account_type']:
            types = filters['account_type'] if isinstance(filters['account_type'], list) else [filters['account_type']]
            if 'account_type' in df.columns:
                df = df[df['account_type'].isin(types)]
                stats['filters'].append(f"Account Type: {', '.join(types)}")
                stats['reduction']['account_type'] = initial_count - len(df)
                initial_count = len(df)
        
        # Account status filter
        if 'status' in filters and filters['status']:
            statuses = filters['status'] if isinstance(filters['status'], list) else [filters['status']]
            if 'account_status' in df.columns:
                df = df[df['account_status'].isin(statuses)]
                stats['filters'].append(f"Account Status: {', '.join(statuses)}")
                stats['reduction']['status'] = initial_count - len(df)
                initial_count = len(df)
        
        # Dormancy filter
        if 'is_dormant' in filters and filters['is_dormant'] is not None:
            if 'is_dormant' in df.columns:
                df = df[df['is_dormant'] == filters['is_dormant']]
                stats['filters'].append(f"Dormant: {filters['is_dormant']}")
                stats['reduction']['is_dormant'] = initial_count - len(df)
        
        return df, stats
    
    def get_population_summary(self, df):
        """Generate summary statistics for filtered population"""
        summary = {
            'total_transactions': len(df),
            'unique_accounts': df['account_id'].nunique() if 'account_id' in df.columns else 0,
            'unique_customers': df['customer_id'].nunique() if 'customer_id' in df.columns else 0
        }
        
        # Amount statistics
        if 'transaction_amount' in df.columns:
            amounts = df['transaction_amount'].dropna()
            summary.update({
                'total_amount': float(amounts.sum()),
                'avg_amount': float(amounts.mean()),
                'median_amount': float(amounts.median()),
                'min_amount': float(amounts.min()),
                'max_amount': float(amounts.max())
            })
        
        # Date range
        if 'transaction_date' in df.columns:
            dates = df['transaction_date'].dropna()
            summary.update({
                'date_range_start': dates.min().isoformat() if len(dates) > 0 else None,
                'date_range_end': dates.max().isoformat() if len(dates) > 0 else None,
                'date_span_days': (dates.max() - dates.min()).days if len(dates) > 0 else 0
            })
        
        # Breakdown by risk (if available)
        if 'risk_rating' in df.columns:
            risk_breakdown = df['risk_rating'].value_counts().to_dict()
            summary['risk_breakdown'] = {str(k): int(v) for k, v in risk_breakdown.items()}
        
        return summary