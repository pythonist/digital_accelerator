# backend/calibration/services/data_preview_service.py
"""
Data Preview Service
Provides preview and statistics for uploaded data tables
"""
import pandas as pd
import numpy as np

class DataPreviewService:
    """Handle data preview and statistics for calibration tables"""
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def get_table_preview(self, env_id, table_name, limit=100):
        """
        Get preview of uploaded table
        
        Args:
            env_id: Environment ID
            table_name: 'transactions', 'accounts', or 'customers'
            limit: Max rows to return
        
        Returns:
            {
                'columns': list,
                'rows': list of dicts,
                'total_count': int,
                'stats': dict
            }
        """
        full_table_name = f"{env_id}_{table_name}"
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            # Check if table exists
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (full_table_name,)
            )
            if not cursor.fetchone():
                return None
            
            # Get total count
            cursor.execute(f'SELECT COUNT(*) FROM "{full_table_name}"')
            total_count = cursor.fetchone()[0]
            
            # Get preview data
            cursor.execute(f'SELECT * FROM "{full_table_name}" LIMIT ?', (limit,))
            columns = [desc[0] for desc in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            
            # Get column statistics
            stats = self._compute_table_stats(full_table_name, conn)
            
            return {
                'table_name': table_name,
                'columns': columns,
                'rows': rows,
                'total_count': total_count,
                'preview_count': len(rows),
                'stats': stats
            }
            
        finally:
            conn.close()
    
    def _compute_table_stats(self, table_name, conn):
        """Compute statistics for table columns"""
        df = pd.read_sql_query(f'SELECT * FROM "{table_name}" LIMIT 10000', conn)
        
        stats = {
            'row_count': len(df),
            'column_count': len(df.columns),
            'columns': {}
        }
        
        for col in df.columns:
            col_stats = {
                'null_count': int(df[col].isnull().sum()),
                'null_pct': round(float(df[col].isnull().sum() / len(df) * 100), 2),
                'unique_count': int(df[col].nunique())
            }
            
            # Numeric column stats
            if pd.api.types.is_numeric_dtype(df[col]):
                non_null = df[col].dropna()
                if len(non_null) > 0:
                    col_stats.update({
                        'min': float(non_null.min()),
                        'max': float(non_null.max()),
                        'mean': float(non_null.mean()),
                        'median': float(non_null.median())
                    })
            
            # Date column detection
            elif 'date' in col.lower():
                try:
                    dates = pd.to_datetime(df[col], errors='coerce').dropna()
                    if len(dates) > 0:
                        col_stats.update({
                            'min_date': dates.min().isoformat(),
                            'max_date': dates.max().isoformat(),
                            'date_span_days': (dates.max() - dates.min()).days
                        })
                except:
                    pass
            
            stats['columns'][col] = col_stats
        
        return stats
    
    def get_data_quality_report(self, env_id):
        """
        Generate data quality report across all tables
        
        Returns:
            {
                'transactions': {...},
                'accounts': {...},
                'customers': {...},
                'overall_quality_score': float
            }
        """
        report = {}
        quality_scores = []
        
        for table_name in ['transactions', 'accounts', 'customers']:
            table_report = self._analyze_table_quality(env_id, table_name)
            if table_report:
                report[table_name] = table_report
                quality_scores.append(table_report['quality_score'])
        
        report['overall_quality_score'] = round(
            sum(quality_scores) / len(quality_scores), 2
        ) if quality_scores else 0
        
        return report
    
    def _analyze_table_quality(self, env_id, table_name):
        """Analyze quality metrics for single table"""
        full_table_name = f"{env_id}_{table_name}"
        conn = self.db.connect()
        
        try:
            df = pd.read_sql_query(f'SELECT * FROM "{full_table_name}" LIMIT 5000', conn)
            
            if df.empty:
                return None
            
            # Key quality metrics
            null_pct = df.isnull().sum().sum() / (len(df) * len(df.columns)) * 100
            completeness = 100 - null_pct
            
            # Check for required columns
            required_cols = {
                'transactions': ['transaction_id', 'account_id', 'transaction_date', 'transaction_amount'],
                'accounts': ['account_id', 'customer_id'],
                'customers': ['customer_id']
            }
            
            has_required = all(col in df.columns for col in required_cols.get(table_name, []))
            
            # Quality score (0-100)
            quality_score = (
                completeness * 0.5 +  # 50% weight on completeness
                (100 if has_required else 0) * 0.3 +  # 30% on required columns
                min(100, df.shape[0] / 100) * 0.2  # 20% on row count
            )
            
            return {
                'row_count': len(df),
                'column_count': len(df.columns),
                'completeness_pct': round(completeness, 2),
                'has_required_columns': has_required,
                'missing_required': [
                    col for col in required_cols.get(table_name, []) 
                    if col not in df.columns
                ],
                'quality_score': round(quality_score, 2),
                'issues': self._identify_issues(df, table_name)
            }
            
        except Exception as e:
            return None
        finally:
            conn.close()
    
    def _identify_issues(self, df, table_name):
        """Identify common data quality issues"""
        issues = []
        
        # Check for duplicate IDs
        id_cols = {
            'transactions': 'transaction_id',
            'accounts': 'account_id',
            'customers': 'customer_id'
        }
        
        if id_col := id_cols.get(table_name):
            if id_col in df.columns:
                dup_count = df[id_col].duplicated().sum()
                if dup_count > 0:
                    issues.append(f"{dup_count} duplicate {id_col}s found")
        
        # Check for negative amounts (transactions only)
        if table_name == 'transactions' and 'transaction_amount' in df.columns:
            try:
                amounts = pd.to_numeric(df['transaction_amount'], errors='coerce')
                neg_count = (amounts < 0).sum()
                if neg_count > 0:
                    issues.append(f"{neg_count} negative transaction amounts")
            except:
                pass
        
        # Check date validity
        date_cols = [col for col in df.columns if 'date' in col.lower()]
        for col in date_cols:
            try:
                dates = pd.to_datetime(df[col], errors='coerce')
                invalid_count = dates.isnull().sum()
                if invalid_count > 0:
                    issues.append(f"{invalid_count} invalid dates in {col}")
            except:
                pass
        
        return issues