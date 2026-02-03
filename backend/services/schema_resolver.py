"""
Schema Resolver for Dynamic AML Data
Resolves varying column names to standard internal keys using fuzzy matching.
"""
import pandas as pd
from difflib import get_close_matches
from typing import List, Dict, Any

class SchemaResolver:
    # Standard Internal Keys mapped to potential aliases
    FIELD_MAPPING = {
        'amount': ['txn_amount', 'amount', 'amt', 'val', 'value', 'transaction_amount', 'inr_amount'],
        'date': ['txn_date', 'date', 'timestamp', 'time', 'created_at', 'value_date'],
        'type': ['dr_cr', 'type', 'txn_type', 'credit_debit', 'direction', 'indicator'],
        'channel': ['channel', 'mode', 'txn_mode', 'delivery_channel', 'payment_mode'],
        'description': ['narration', 'description', 'remarks', 'txn_desc', 'particulars'],
        'balance': ['balance', 'bal', 'running_balance', 'ac_bal', 'closing_balance'],
        'branch': ['sol_id', 'branch_code', 'branch', 'location_id'],
        'country': ['country', 'geo', 'jurisdiction', 'remitter_country', 'beneficiary_country'],
        'party_name': ['counterparty', 'beneficiary', 'remitter', 'party_name', 'txn_party']
    }

    def normalize_dataset(self, data: List[Dict[str, Any]]) -> pd.DataFrame:
        """
        Converts a list of dicts (raw data) into a Normalized Pandas DataFrame
        """
        if not data:
            return pd.DataFrame()

        df = pd.DataFrame(data)
        normalized_df = pd.DataFrame()
        missing_fields = []

        # Map columns
        raw_columns = [str(c).lower().strip() for c in df.columns]
        
        for standard_key, aliases in self.FIELD_MAPPING.items():
            found_col = None
            
            # 1. Exact Match (Priority)
            for alias in aliases:
                if alias in raw_columns:
                    found_col = df.columns[raw_columns.index(alias)]
                    break
            
            # 2. Fuzzy Match (Fallback)
            if not found_col:
                matches = get_close_matches(standard_key, raw_columns, n=1, cutoff=0.8)
                if matches:
                    found_col = df.columns[raw_columns.index(matches[0])]

            if found_col:
                normalized_df[standard_key] = df[found_col]
            else:
                # Initialize empty if critical, else ignore
                normalized_df[standard_key] = None
                missing_fields.append(standard_key)

        # Type Casting for Critical Fields
        if 'amount' in normalized_df.columns:
            normalized_df['amount'] = pd.to_numeric(normalized_df['amount'], errors='coerce').fillna(0)
        
        if 'date' in normalized_df.columns:
            normalized_df['date'] = pd.to_datetime(normalized_df['date'], errors='coerce')

        return normalized_df, missing_fields