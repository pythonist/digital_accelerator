# backend/calibration/builder/aggregation_engine.py
"""
FIXED Aggregation Engine - Robust Column Detection
"""
import pandas as pd
import numpy as np

class AggregationEngine:
    """
    Correct Implementation with Context Column Preservation
    """
    
    def __init__(self, scenario_df, all_transactions_df):
        self.scenario_df = scenario_df.copy()
        
        if all_transactions_df is None:
            print("⚠️ WARNING: all_transactions_df is None. Using scenario_df.")
            self.all_transactions = self.scenario_df.copy()
        else:
            self.all_transactions = all_transactions_df.copy()
        
        # ✅ FIX: Normalize columns immediately
        self._normalize_columns()
    
    def _normalize_columns(self):
        """Normalize column names and detect required columns"""
        # Normalize all column names
        self.scenario_df.columns = [c.lower().strip().replace(' ', '_') for c in self.scenario_df.columns]
        self.all_transactions.columns = [c.lower().strip().replace(' ', '_') for c in self.all_transactions.columns]
        
        # Smart column mapping
        column_map = {
            'date': 'transaction_date',
            'txn_date': 'transaction_date',
            'tx_date': 'transaction_date',
            'timestamp': 'transaction_date',
            'datetime': 'transaction_date',
            'amount': 'transaction_amount',
            'txn_amount': 'transaction_amount',
            'amt': 'transaction_amount',
            'value': 'transaction_amount',
            'id': 'transaction_id',
            'txn_id': 'transaction_id',
            'account': 'account_id',
            'acct_id': 'account_id',
            'acct': 'account_id',
            'customer': 'customer_id',
            'cust_id': 'customer_id',
            'cust': 'customer_id'
        }
        
        self.scenario_df.rename(columns=column_map, inplace=True)
        self.all_transactions.rename(columns=column_map, inplace=True)
        
        # ✅ Smart search for transaction_date if still missing
        if 'transaction_date' not in self.all_transactions.columns:
            date_candidates = [c for c in self.all_transactions.columns if 'date' in c or 'time' in c]
            if date_candidates:
                best_candidate = date_candidates[0]
                print(f"   📅 Found date column: '{best_candidate}' -> 'transaction_date'")
                self.all_transactions.rename(columns={best_candidate: 'transaction_date'}, inplace=True)
        
        if 'transaction_date' not in self.scenario_df.columns:
            date_candidates = [c for c in self.scenario_df.columns if 'date' in c or 'time' in c]
            if date_candidates:
                self.scenario_df.rename(columns={date_candidates[0]: 'transaction_date'}, inplace=True)
        
        # ✅ Verify critical columns exist
        for df_name, df in [('scenario_df', self.scenario_df), ('all_transactions', self.all_transactions)]:
            if 'transaction_date' not in df.columns:
                raise KeyError(f"❌ CRITICAL: 'transaction_date' not found in {df_name}. Available: {list(df.columns)}")
            if 'transaction_amount' not in df.columns:
                raise KeyError(f"❌ CRITICAL: 'transaction_amount' not found in {df_name}. Available: {list(df.columns)}")

    def aggregate(self, config):
        level = config.get('level', 'account')
        lookback_days = config.get('lookback_days', 30)
        metrics = config.get('metrics', ['amount'])
        filter_history = config.get('filter_history', True)
        
        # --- 1. Validation & Prep ---
        if self.scenario_df.empty:
            raise ValueError("v1 population is empty")
        
        # Ensure Datetimes
        self.scenario_df['transaction_date'] = pd.to_datetime(
            self.scenario_df['transaction_date'], errors='coerce'
        )
        self.all_transactions['transaction_date'] = pd.to_datetime(
            self.all_transactions['transaction_date'], errors='coerce'
        )
        
        # Drop invalid dates
        self.scenario_df = self.scenario_df.dropna(subset=['transaction_date'])
        self.all_transactions = self.all_transactions.dropna(subset=['transaction_date'])

        # --- 2. Determine Grouping Key ---
        if level == 'account':
            group_key = 'account_id'
        elif level == 'customer':
            group_key = 'customer_id'
        else:
            raise ValueError(f"Unknown aggregation level: {level}")

        if group_key not in self.all_transactions.columns:
            raise KeyError(f"Grouping key '{group_key}' not found in transactions.")

        # --- 3. IDENTIFY CONTEXT COLUMNS TO PRESERVE ---
        excluded_cols = {
            'transaction_id', 'id', 'txn_id',
            'transaction_amount', 'amount', 'amt',
            'transaction_date', 'date'
        }
        
        available_cols = set(self.scenario_df.columns)
        context_columns = [
            col for col in available_cols 
            if col not in excluded_cols and col != group_key
        ]
        
        print(f"   📋 Context columns to preserve: {context_columns}")

        # --- 4. DEDUPLICATE ANCHOR WITH CONTEXT ---
        print(f"   🧹 Deduplicating v1 to unique (entity, date) pairs...")
        
        grouping_cols = [group_key, 'transaction_date']
        unique_anchors = self.scenario_df.groupby(grouping_cols, as_index=False).first()
        
        cols_to_keep = grouping_cols + [c for c in context_columns if c in unique_anchors.columns]
        unique_anchors = unique_anchors[cols_to_keep]
        
        print(f"      v1 Raw Rows: {len(self.scenario_df):,}")
        print(f"      Unique Anchors: {len(unique_anchors):,}")
        print(f"      Preserved columns: {list(unique_anchors.columns)}")

        # --- 5. FILTER HISTORY ---
        history = self.all_transactions.copy()
        
        if filter_history:
            print(f"   🔍 Applying Step 1 filter to history...")
            
            if 'transaction_category' in self.scenario_df.columns:
                v1_categories = self.scenario_df['transaction_category'].unique()
                print(f"      Categories in v1: {v1_categories}")
                
                if 'transaction_category' in history.columns:
                    initial_count = len(history)
                    history = history[history['transaction_category'].isin(v1_categories)]
                    print(f"      Filtered history: {initial_count:,} → {len(history):,}")
                else:
                    print("      ⚠️ No category column in history, skipping filter")
        else:
            print(f"   📊 Using ALL transactions (filter_history=False)")

        # --- 6. CORRECT ROLLING WINDOW CALCULATION ---
        print(f"   🚀 Computing rolling windows ({lookback_days} days)...")
        
        results = []
        history_sorted = history.sort_values([group_key, 'transaction_date'])
        history_grouped = history_sorted.groupby(group_key)
        
        for idx, row in unique_anchors.iterrows():
            entity_id = row[group_key]
            anchor_date = row['transaction_date']
            
            agg_row = row.to_dict()
            
            if entity_id not in history_grouped.groups:
                if 'amount' in metrics:
                    agg_row[f'agg_{lookback_days}d_amount'] = 0
                    agg_row[f'avg_{lookback_days}d_amount'] = 0
                    agg_row[f'max_{lookback_days}d_amount'] = 0
                if 'count' in metrics:
                    agg_row[f'agg_{lookback_days}d_count'] = 0
                results.append(agg_row)
                continue
            
            entity_history = history_grouped.get_group(entity_id)
            
            window_start = anchor_date - pd.Timedelta(days=lookback_days - 1)
            window_end = anchor_date
            
            window_txns = entity_history[
                (entity_history['transaction_date'] >= window_start) &
                (entity_history['transaction_date'] <= window_end)
            ]
            
            if len(window_txns) > 0:
                if 'amount' in metrics:
                    amounts = window_txns['transaction_amount']
                    agg_row[f'agg_{lookback_days}d_amount'] = amounts.sum()
                    agg_row[f'avg_{lookback_days}d_amount'] = amounts.mean()
                    agg_row[f'max_{lookback_days}d_amount'] = amounts.max()
                
                if 'count' in metrics:
                    agg_row[f'agg_{lookback_days}d_count'] = len(window_txns)
            else:
                if 'amount' in metrics:
                    agg_row[f'agg_{lookback_days}d_amount'] = 0
                    agg_row[f'avg_{lookback_days}d_amount'] = 0
                    agg_row[f'max_{lookback_days}d_amount'] = 0
                if 'count' in metrics:
                    agg_row[f'agg_{lookback_days}d_count'] = 0
            
            results.append(agg_row)
        
        result_df = pd.DataFrame(results)
        
        # --- 7. COLUMN ORDERING ---
        agg_cols = [c for c in result_df.columns if c.startswith(('agg_', 'avg_', 'max_'))]
        
        ordered_cols = []
        if group_key in result_df.columns:
            ordered_cols.append(group_key)
        if 'transaction_date' in result_df.columns:
            ordered_cols.append('transaction_date')
        
        context_in_result = [
            c for c in sorted(result_df.columns) 
            if c not in ordered_cols 
            and c not in agg_cols
            and not c.endswith('_id')
            and c not in {'transaction_id', 'id', 'txn_id'}
        ]
        ordered_cols.extend(context_in_result)
        ordered_cols.extend(sorted(agg_cols))
        
        id_cols = [
            c for c in result_df.columns 
            if c not in ordered_cols 
            and (c.endswith('_id') or c in {'transaction_id', 'id', 'txn_id'})
            and c != group_key
        ]
        ordered_cols.extend(id_cols)
        
        result_df = result_df[[c for c in ordered_cols if c in result_df.columns]]
        
        print(f"   📊 Final columns: {list(result_df.columns)}")
        
        # --- 8. Calculate Stats ---
        stats = self._calculate_stats(result_df, metrics, lookback_days)
        stats['filter_applied'] = filter_history
        stats['history_rows_used'] = len(history)
        stats['context_columns_preserved'] = len(context_in_result)
        
        print(f"   ✅ Aggregation complete: {len(result_df):,} rows, {len(result_df.columns)} columns")
        
        return result_df, stats

    def get_distribution_summary(self, df, metric_column):
        if metric_column not in df.columns:
            return {}
        values = df[metric_column].dropna()
        if len(values) == 0:
            return {}
        
        percentiles = [10, 25, 50, 75, 90, 95, 99]
        return {f'p{p}': float(np.percentile(values, p)) for p in percentiles}

    def _calculate_stats(self, df, metrics, lookback_days):
        col_amt = f"agg_{lookback_days}d_amount"
        col_cnt = f"agg_{lookback_days}d_count"
        
        stats = {'row_count': len(df), 'unique_entities': 0}
        
        if 'account_id' in df.columns: 
            stats['unique_entities'] = df['account_id'].nunique()
        elif 'customer_id' in df.columns:
            stats['unique_entities'] = df['customer_id'].nunique()
        
        if 'amount' in metrics and col_amt in df.columns:
            stats['amount_stats'] = {
                'min': float(df[col_amt].min()), 
                'max': float(df[col_amt].max()),
                'mean': float(df[col_amt].mean()), 
                'median': float(df[col_amt].median()),
                'std': float(df[col_amt].std()) if len(df) > 1 else 0
            }
        
        if 'count' in metrics and col_cnt in df.columns:
            stats['count_stats'] = {
                'min': int(df[col_cnt].min()), 
                'max': int(df[col_cnt].max()),
                'mean': float(df[col_cnt].mean()), 
                'median': float(df[col_cnt].median())
            }
            
        return stats