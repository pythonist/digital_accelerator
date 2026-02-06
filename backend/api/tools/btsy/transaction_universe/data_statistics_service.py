# backend/api/tools/btsy/transaction_universe/data_statistics_service.py
"""
Data Statistics Service - ENHANCED VERSION
- Returns BOTH transaction_type (CREDIT/DEBIT) and transaction_category (RTGS/NEFT/etc)
- Provides separate distributions for both filter types
"""
import warnings
warnings.filterwarnings('ignore')

import pandas as pd
pd.options.mode.chained_assignment = None
pd.set_option('display.max_rows', 10)
pd.set_option('display.max_columns', 10)

import numpy as np
np.set_printoptions(threshold=10)

import logging
from pathlib import Path
from typing import Dict, List, Optional
import duckdb
from datetime import datetime

logger = logging.getLogger(__name__)
logging.getLogger('duckdb').setLevel(logging.ERROR)


class DataStatisticsService:
    """Computes and caches data statistics for transaction universes"""
    
    def __init__(self, snapshot_storage_path: Path, snapshots_db_path: Path):
        self.snapshot_storage_path = snapshot_storage_path
        self.snapshots_db_path = snapshots_db_path
    
    def _normalize_tx_type(self, value: str) -> str:
        v = str(value).strip().upper()
        if v in ('DR', 'D', 'DEBIT', 'DBIT'):
            return 'DEBIT'
        if v in ('CR', 'C', 'CREDIT', 'CRDT'):
            return 'CREDIT'
        return v

    def _get_transactions_file(self, snapshot_id: str) -> Path:
        from api.tools.btsy.snapshot_manager import SnapshotManager

        mgr = SnapshotManager(self.snapshots_db_path)
        snap = mgr.get_snapshot(str(snapshot_id))
        if snap:
            for d in (snap.get("domains") or []):
                if d.get("domain") == "transactions" and d.get("normalized_file_path"):
                    return Path(d["normalized_file_path"])
        base = self.snapshot_storage_path.parent / "normalized" / str(snapshot_id)
        return base / "transactions.parquet"
    
    def get_transaction_statistics(self, snapshot_id: str) -> Dict:
        """
        Get comprehensive statistics about available transaction data
        Returns BOTH transaction_type and transaction_category distributions
        """
        try:
            tx_file = self._get_transactions_file(snapshot_id)
            
            if not tx_file.exists():
                raise FileNotFoundError(f"Transaction file not found: {tx_file}")
            
            logger.info(f"[STATS] Computing statistics for {tx_file}")
            
            conn = duckdb.connect()
            
            # Get basic counts
            total_count = conn.execute(f"""
                SELECT COUNT(*) FROM read_parquet('{tx_file}')
            """).fetchone()[0]
            
            # Get date range
            date_stats = conn.execute(f"""
                SELECT 
                    MIN(transaction_datetime) as min_date,
                    MAX(transaction_datetime) as max_date
                FROM read_parquet('{tx_file}')
            """).fetchone()
            
            # Get amount statistics
            amount_stats = conn.execute(f"""
                SELECT 
                    MIN(CAST(transaction_amount AS DOUBLE)) as min_amount,
                    MAX(CAST(transaction_amount AS DOUBLE)) as max_amount,
                    AVG(CAST(transaction_amount AS DOUBLE)) as avg_amount,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(transaction_amount AS DOUBLE)) as median_amount
                FROM read_parquet('{tx_file}')
            """).fetchone()
            
            # Get monthly distribution
            monthly_dist = conn.execute(f"""
                SELECT 
                    STRFTIME(transaction_datetime, '%Y-%m') as month,
                    COUNT(*) as count
                FROM read_parquet('{tx_file}')
                GROUP BY month
                ORDER BY month
            """).fetchall()
            
            # Get transaction TYPE distribution (CREDIT/DEBIT)
            type_dist = []
            try:
                type_norm = """
                    CASE
                      WHEN UPPER(transaction_type) IN ('DR','D','DEBIT','DBIT') THEN 'DEBIT'
                      WHEN UPPER(transaction_type) IN ('CR','C','CREDIT','CRDT') THEN 'CREDIT'
                      ELSE UPPER(transaction_type)
                    END
                """
                type_dist = conn.execute(f"""
                    SELECT 
                        {type_norm} AS transaction_type,
                        COUNT(*) as count
                    FROM read_parquet('{tx_file}')
                    WHERE transaction_type IS NOT NULL
                    GROUP BY transaction_type
                    ORDER BY count DESC
                """).fetchall()
                logger.info(f"[STATS] Found {len(type_dist)} transaction types")
            except Exception as e:
                logger.warning(f"[STATS] Transaction type distribution failed (column may not exist): {e}")
            
            # Get transaction CATEGORY distribution (RTGS, NEFT, CHEQUE, etc.)
            category_dist = []
            try:
                category_dist = conn.execute(f"""
                    SELECT 
                        transaction_category,
                        COUNT(*) as count
                    FROM read_parquet('{tx_file}')
                    WHERE transaction_category IS NOT NULL
                    GROUP BY transaction_category
                    ORDER BY count DESC
                """).fetchall()
                logger.info(f"[STATS] Found {len(category_dist)} transaction categories")
            except Exception as e:
                logger.warning(f"[STATS] Category distribution failed: {e}")
            
            conn.close()
            
            # Format results - Include BOTH type and category
            stats = {
                'total_transactions': total_count,
                'date_range': {
                    'min_date': str(date_stats[0])[:10] if date_stats[0] else None,
                    'max_date': str(date_stats[1])[:10] if date_stats[1] else None
                },
                'amount_range': {
                    'min': float(amount_stats[0]) if amount_stats[0] is not None else None,
                    'max': float(amount_stats[1]) if amount_stats[1] is not None else None,
                    'avg': float(amount_stats[2]) if amount_stats[2] is not None else None,
                    'median': float(amount_stats[3]) if amount_stats[3] is not None else None
                },
                # BOTH distributions returned
                'type_distribution': {
                    str(typ): int(count) for typ, count in type_dist
                },
                'category_distribution': {
                    str(cat): int(count) for cat, count in category_dist
                },
                'monthly_distribution': [
                    {'month': month, 'count': int(count)}
                    for month, count in monthly_dist
                ]
            }
            
            logger.info(f"[STATS] Stats computed: {total_count} txns, {len(stats['type_distribution'])} types, {len(stats['category_distribution'])} categories")
            
            return stats
            
        except Exception as e:
            logger.error(f"[STATS] Failed to compute statistics: {e}", exc_info=True)
            raise
    
    def get_filtered_statistics(
        self, 
        snapshot_id: str,
        types: List[str] = None,  # NEW: transaction_type filter
        categories: List[str] = None,  # transaction_category filter
        date_start: str = None,
        date_end: str = None,
        amount_min: float = None,
        amount_max: float = None
    ) -> Dict:
        """Get statistics for a filtered subset of data"""
        try:
            tx_file = self._get_transactions_file(snapshot_id)
            
            if not tx_file.exists():
                raise FileNotFoundError(f"Transaction file not found: {tx_file}")
            
            conn = duckdb.connect()
            
            # Build WHERE clause
            where_clauses = []
            
            # NEW: transaction_type filter
            if types:
                norm_types = [self._normalize_tx_type(t) for t in types]
                type_list = "', '".join(norm_types)
                type_norm = """
                    CASE
                      WHEN UPPER(transaction_type) IN ('DR','D','DEBIT','DBIT') THEN 'DEBIT'
                      WHEN UPPER(transaction_type) IN ('CR','C','CREDIT','CRDT') THEN 'CREDIT'
                      ELSE UPPER(transaction_type)
                    END
                """
                where_clauses.append(f"{type_norm} IN ('{type_list}')")
            
            # transaction_category filter
            if categories:
                cat_list = "', '".join(categories)
                where_clauses.append(f"transaction_category IN ('{cat_list}')")
            
            if date_start:
                where_clauses.append(f"transaction_datetime >= '{date_start}'")
            
            if date_end:
                where_clauses.append(f"transaction_datetime <= '{date_end}'")
            
            if amount_min is not None:
                where_clauses.append(f"transaction_amount >= {amount_min}")
            
            if amount_max is not None:
                where_clauses.append(f"transaction_amount <= {amount_max}")
            
            where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"
            
            # Get filtered count
            filtered_count = conn.execute(f"""
                SELECT COUNT(*) FROM read_parquet('{tx_file}')
                WHERE {where_sql}
            """).fetchone()[0]
            
            # Get total for percentage
            total_count = conn.execute(f"""
                SELECT COUNT(*) FROM read_parquet('{tx_file}')
            """).fetchone()[0]
            
            conn.close()
            
            percentage = round((filtered_count / total_count) * 100, 2) if total_count > 0 else 0
            
            return {
                'filtered_count': filtered_count,
                'total_count': total_count,
                'coverage_percentage': percentage
            }
            
        except Exception as e:
            logger.error(f"[STATS] Failed to compute filtered statistics: {e}", exc_info=True)
            raise
