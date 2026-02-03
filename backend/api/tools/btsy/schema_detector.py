# backend/api/tools/btsy/schema_detector.py
"""
Schema Detection Service
Detects candidate bank columns for canonical fields using:
- Name similarity (fuzzy matching)
- Datatype compatibility
- Null ratio
- Cardinality hints
"""
import duckdb
from pathlib import Path
from typing import Dict, List, Tuple
from difflib import SequenceMatcher
import logging

logger = logging.getLogger(__name__)


class SchemaDetector:
    """
    Intelligent schema detector that suggests mappings
    from bank columns to canonical fields.
    """
    
    # Common column name patterns for canonical fields
    FIELD_PATTERNS = {
        'transaction_id': ['txn_id', 'transaction_id', 'trans_id', 'trx_id', 'id'],
        'transaction_datetime': ['txn_date', 'transaction_date', 'trans_date', 'datetime', 'timestamp', 'date'],
        'transaction_amount': ['amount', 'txn_amount', 'transaction_amount', 'trans_amt', 'value'],
        'transaction_category': ['category', 'txn_category', 'transaction_category', 'payment_method', 'channel', 'mode'],  # FIX
        'transaction_type': ['txn_type', 'transaction_type', 'trans_type', 'type', 'dr_cr', 'debit_credit', 'direction'],  # NEW
        'account_id': ['account_id', 'acct_id', 'account_number', 'acct_num'],
        'customer_id': ['customer_id', 'cust_id', 'client_id', 'party_id'],
        'account_status': ['status', 'account_status', 'acct_status'],
        'account_open_date': ['open_date', 'opening_date', 'start_date', 'creation_date'],
        'account_close_date': ['close_date', 'closing_date', 'end_date', 'termination_date'],
        'customer_risk_rating': ['risk_rating', 'risk', 'rating', 'risk_level'],
        'pep_flag': ['pep', 'pep_flag', 'is_pep', 'politically_exposed'],
        'sanction_flag': ['sanction', 'sanction_flag', 'is_sanctioned', 'sanctions'],
        'str_filed_date': ['filed_date', 'str_date', 'filing_date', 'report_date'],
    }
    
    # Expected data types for canonical fields
    EXPECTED_TYPES = {
        'transaction_id': ['VARCHAR', 'STRING', 'BIGINT', 'INTEGER'],
        'transaction_datetime': ['TIMESTAMP', 'DATE', 'VARCHAR'],
        'transaction_amount': ['DOUBLE', 'DECIMAL', 'FLOAT', 'BIGINT', 'INTEGER'],
        'transaction_category': ['VARCHAR', 'STRING'],  # FIX
        'transaction_type': ['VARCHAR', 'STRING'],  # NEW
        'account_id': ['VARCHAR', 'STRING', 'BIGINT', 'INTEGER'],
        'customer_id': ['VARCHAR', 'STRING', 'BIGINT', 'INTEGER'],
        'account_status': ['VARCHAR', 'STRING'],
        'account_open_date': ['TIMESTAMP', 'DATE', 'VARCHAR'],
        'account_close_date': ['TIMESTAMP', 'DATE', 'VARCHAR'],
        'customer_risk_rating': ['VARCHAR', 'STRING'],
        'pep_flag': ['BOOLEAN', 'VARCHAR', 'INTEGER'],
        'sanction_flag': ['BOOLEAN', 'VARCHAR', 'INTEGER'],
        'str_filed_date': ['TIMESTAMP', 'DATE', 'VARCHAR'],
    }
    
    def __init__(self, conn: duckdb.DuckDBPyConnection):
        self.conn = conn

    def _relation_expr(self, file_path: Path) -> str:
        p = str(file_path).replace("'", "''")
        ext = file_path.suffix.lower()
        if ext in ('.parquet', '.pq'):
            return f"read_parquet('{p}')"
        return f"read_csv_auto('{p}')"
    
    def _similarity_score(self, str1: str, str2: str) -> float:
        """Calculate similarity between two strings (0-1)"""
        return SequenceMatcher(None, str1.lower(), str2.lower()).ratio()
    
    def _get_column_info(self, file_path: Path) -> List[Dict]:
        """Get detailed column information from file"""
        try:
            rel = self._relation_expr(file_path)
            # Get schema
            columns_query = f"DESCRIBE SELECT * FROM {rel}"
            columns_result = self.conn.execute(columns_query).fetchall()
            
            column_info = []
            for col_info in columns_result:
                col_name = col_info[0]
                col_type = col_info[1]
                
                # Get null percentage
                null_query = f"""
                    SELECT 
                        COUNT(*) - COUNT("{col_name}") as null_count,
                        COUNT(*) as total_count
                    FROM {rel}
                """
                null_result = self.conn.execute(null_query).fetchone()
                null_pct = (null_result[0] / null_result[1] * 100) if null_result[1] > 0 else 0
                
                # Get cardinality
                card_query = f"""
                    SELECT COUNT(DISTINCT "{col_name}") as distinct_count
                    FROM {rel}
                """
                card_result = self.conn.execute(card_query).fetchone()
                distinct_count = card_result[0] if card_result else 0
                
                column_info.append({
                    'name': col_name,
                    'type': col_type,
                    'null_pct': null_pct,
                    'distinct_count': distinct_count
                })
            
            return column_info
            
        except Exception as e:
            logger.error(f"Failed to get column info: {str(e)}")
            return []
    
    def detect_candidates(self, file_path: Path, canonical_fields: List[str]) -> Dict[str, List[Dict]]:
        """
        Detect candidate columns for each canonical field.
        Returns a dict: canonical_field -> [candidates with scores]
        """
        column_info = self._get_column_info(file_path)
        if not column_info:
            return {}
        
        candidates = {}
        
        for canonical_field in canonical_fields:
            field_candidates = []
            patterns = self.FIELD_PATTERNS.get(canonical_field, [canonical_field])
            expected_types = self.EXPECTED_TYPES.get(canonical_field, [])
            
            for col in column_info:
                col_name = col['name']
                col_type = col['type']
                
                # Name similarity score
                name_score = max(
                    self._similarity_score(col_name, pattern)
                    for pattern in patterns
                )
                
                # Type compatibility score
                type_score = 1.0 if col_type in expected_types else 0.3
                
                # Null ratio penalty
                null_penalty = 1.0 - (col['null_pct'] / 100.0 * 0.5)
                
                # Combined confidence score
                confidence = (name_score * 0.5 + type_score * 0.3) * null_penalty
                
                if confidence > 0.3:  # Only include reasonable candidates
                    field_candidates.append({
                        'column': col_name,
                        'type': col_type,
                        'confidence': round(confidence, 3),
                        'null_pct': round(col['null_pct'], 2),
                        'distinct_count': col['distinct_count']
                    })
            
            # Sort by confidence
            field_candidates.sort(key=lambda x: x['confidence'], reverse=True)
            candidates[canonical_field] = field_candidates[:5]  # Top 5 candidates
        
        return candidates
    
    def auto_suggest_mapping(self, file_path: Path, canonical_fields: List[str]) -> Dict[str, str]:
        """
        Auto-suggest best mapping for each canonical field.
        Returns dict: canonical_field -> suggested_bank_column
        """
        candidates = self.detect_candidates(file_path, canonical_fields)
        
        suggested_mapping = {}
        used_columns = set()
        
        # First pass: high-confidence matches (>0.7)
        for canonical_field, field_candidates in candidates.items():
            if field_candidates and field_candidates[0]['confidence'] > 0.7:
                best_candidate = field_candidates[0]['column']
                if best_candidate not in used_columns:
                    suggested_mapping[canonical_field] = best_candidate
                    used_columns.add(best_candidate)
        
        # Second pass: medium-confidence matches (>0.5) for unmapped fields
        for canonical_field, field_candidates in candidates.items():
            if canonical_field not in suggested_mapping and field_candidates:
                for candidate in field_candidates:
                    if candidate['confidence'] > 0.5 and candidate['column'] not in used_columns:
                        suggested_mapping[canonical_field] = candidate['column']
                        used_columns.add(candidate['column'])
                        break
        
        return suggested_mapping
