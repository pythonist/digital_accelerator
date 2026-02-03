# backend/calibration/services/population_stats_service.py
"""
Population Statistics Service
Computes cardinality, exclusions, warnings (FAST, approximate where needed)
"""
import pandas as pd

class PopulationStatsService:
    """Enhanced statistics beyond basic counts"""
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def compute_cardinality_stats(self, df):
        """
        Compute cardinality metrics
        FAST: Uses aggregation, not row-by-row
        """
        if df.empty:
            return {
                "avg_txn_per_account": 0,
                "max_txn_single_account": 0,
                "top_1pct_concentration": 0
            }
        
        # Group by account
        account_counts = df.groupby('account_id').size()
        
        # Stats
        avg_txn = float(account_counts.mean())
        max_txn = int(account_counts.max())
        
        # Top 1% concentration
        sorted_counts = account_counts.sort_values(ascending=False)
        top_1pct_idx = max(1, int(len(sorted_counts) * 0.01))
        top_1pct_txns = sorted_counts.head(top_1pct_idx).sum()
        concentration = round((top_1pct_txns / len(df)) * 100, 1)
        
        return {
            "avg_txn_per_account": round(avg_txn, 1),
            "max_txn_single_account": max_txn,
            "top_1pct_concentration": concentration
        }
    
    def compute_excluded_summary(self, run_id, env_id, filters, mapping):
        """
        Analyze what was excluded by filters
        Uses COMPLEMENTARY queries with proper column mapping
        """
        conn = self.db.connect()
        
        try:
            from calibration.services.population_explorer_service import PopulationExplorerService
            explorer = PopulationExplorerService(self.db)
            
            excluded = {}
            
            # Get view and mapping
            view_name = f"{env_id}_calibration_data"
            
            # Get transaction category mapping
            cat_col = mapping.get('transactions', {}).get('transaction_category', 'transaction_category')

            cursor = conn.cursor()
            
            # Get all distinct categories from view
            try:
                cursor.execute(f'''
                    SELECT DISTINCT "{cat_col}"
                    FROM "{view_name}"
                    WHERE "{cat_col}" IS NOT NULL
                ''')
                all_categories = [r[0] for r in cursor.fetchall()]
            except Exception as e:
                print(f"⚠️ [EXCLUDED] Failed to get categories: {e}")
                all_categories = []
            
            # Calculate excluded categories
            included_cats = filters.get('transaction_filters', {}).get('transaction_category', [])
            if included_cats and all_categories:
                excluded_cats = [c for c in all_categories if c not in included_cats]
                
                if excluded_cats:
                    # Get counts for excluded categories
                    excluded['by_category'] = self._get_category_counts(
                        conn, view_name, excluded_cats, cat_col
                    )
            
            # Calculate total excluded count
            if excluded.get('by_category'):
                total_excluded = sum(excluded['by_category'].values())
                excluded['total_excluded_transactions'] = total_excluded
            
            return excluded
            
        finally:
            conn.close()
    
    def generate_warnings(self, stats):
        """Generate advisory warnings based on stats"""
        warnings = []
        
        # High concentration warning
        if stats.get('cardinality', {}).get('top_1pct_concentration', 0) > 40:
            warnings.append({
                "type": "HIGH_CONCENTRATION",
                "message": f"{stats['cardinality']['top_1pct_concentration']}% of transactions from top 1% accounts",
                "severity": "ADVISORY",
                "recommendation": "Consider segmenting by account size"
            })
        
        # High reduction warning
        if stats.get('reduction_pct', 0) > 90:
            warnings.append({
                "type": "HIGH_REDUCTION",
                "message": "Over 90% of population excluded",
                "severity": "WARNING",
                "recommendation": "Verify filters are not too restrictive"
            })
        
        # Low volume warning
        if stats.get('filtered_count', 0) < 1000:
            warnings.append({
                "type": "LOW_VOLUME",
                "message": "Filtered population below 1,000 transactions",
                "severity": "WARNING",
                "recommendation": "May not provide statistically significant calibration"
            })
        
        return warnings
    
    def _get_distinct_values(self, conn, table, column):
        """Get distinct values for a column"""
        try:
            query = f'SELECT DISTINCT "{column}" FROM "{table}" WHERE "{column}" IS NOT NULL'
            return [row[0] for row in conn.execute(query).fetchall()]
        except:
            return []
    
    def _get_category_counts(self, conn, view_name, categories, cat_col):
        """Get transaction counts for specific categories"""
        if not categories:
            return {}
        
        placeholders = ','.join([f"'{c}'" for c in categories])
        
        query = f'''
            SELECT "{cat_col}", COUNT(*) as cnt
            FROM "{view_name}"
            WHERE "{cat_col}" IN ({placeholders})
            GROUP BY "{cat_col}"
            ORDER BY cnt DESC
        '''
        
        try:
            rows = conn.execute(query).fetchall()
            
            # Return as dictionary with category: count
            result = {}
            for row in rows:
                category = row[0]
                count = row[1]
                result[category] = count
            
            return result
        except Exception as e:
            print(f"⚠️ [EXCLUDED] Failed to get category counts: {e}")
            return {}