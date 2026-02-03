# ============================================================================
# backend/calibration/services/data_step_zero_services/sql_execution_service.py
# ============================================================================
"""
SQL Execution Service
Allows advanced users to write custom SQL joins.
Executes in safe, read-only mode with preview limits.
"""
import pandas as pd
import re
import sqlparse
from sqlparse.sql import IdentifierList, Identifier, Where
from sqlparse.tokens import Keyword, DML


class SQLExecutionService:
    """
    Executes user-provided SQL for join operations.
    
    SECURITY:
    - Read-only (SELECT only)
    - No DDL/DML except SELECT
    - Table name validation
    - Result size limits
    """
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def execute_sql_preview(self, env_id: str, sql: str, limit: int = 100) -> dict:
        """
        Execute user SQL and return preview.
        
        Args:
            env_id: Environment ID (for table validation)
            sql: User-provided SQL query
            limit: Maximum rows to return
        
        Returns:
            {
                'success': bool,
                'data': [...],
                'columns': [...],
                'metrics': {...},
                'warnings': [...]
            }
        """
        # Validate SQL
        validation = self._validate_sql(sql)
        if not validation['valid']:
            return {
                'success': False,
                'error': validation['error'],
                'category': 'validation'
            }
        
        # Extract and validate table names
        tables = self._extract_table_names(sql)
        table_validation = self._validate_tables(env_id, tables)
        if not table_validation['valid']:
            return {
                'success': False,
                'error': table_validation['error'],
                'category': 'tables'
            }
        
        # Add LIMIT if not present
        limited_sql = self._ensure_limit(sql, limit)
        
        # Execute
        conn = self.db.connect()
        
        try:
            df = pd.read_sql_query(limited_sql, conn)
            
            # Calculate metrics
            metrics = {
                'total_rows': len(df),
                'total_columns': len(df.columns),
                'null_percentage': round(df.isnull().sum().sum() / (len(df) * len(df.columns)) * 100, 2) if len(df) > 0 else 0,
                'tables_used': tables
            }
            
            # Check for warnings
            warnings = []
            if len(df) == limit:
                warnings.append(f"Result limited to {limit} rows. Actual result may be larger.")
            
            if metrics['null_percentage'] > 50:
                warnings.append(f"High null percentage ({metrics['null_percentage']}%). Check join conditions.")
            
            return {
                'success': True,
                'data': df.to_dict(orient='records'),
                'columns': df.columns.tolist(),
                'metrics': metrics,
                'warnings': warnings,
                'sql_executed': limited_sql
            }
            
        except Exception as e:
            print(f"❌ [SQL] Execution failed: {e}")
            return {
                'success': False,
                'error': f"SQL execution error: {str(e)}",
                'category': 'execution'
            }
        finally:
            conn.close()
    
    def validate_sql(self, env_id: str, sql: str) -> dict:
        """
        Validate SQL without executing.
        Returns validation status and suggestions.
        """
        # Basic validation
        validation = self._validate_sql(sql)
        if not validation['valid']:
            return validation
        
        # Table validation
        tables = self._extract_table_names(sql)
        table_validation = self._validate_tables(env_id, tables)
        if not table_validation['valid']:
            return table_validation
        
        # Parse for potential issues
        warnings = []
        
        # Check for LIMIT
        if 'LIMIT' not in sql.upper():
            warnings.append("Consider adding LIMIT clause for large result sets")
        
        # Check for WHERE clause in joins
        if 'JOIN' in sql.upper() and 'WHERE' not in sql.upper():
            warnings.append("No WHERE clause found. Result may be very large.")
        
        # Check for cartesian products
        join_count = sql.upper().count('JOIN')
        on_count = sql.upper().count('ON')
        if join_count > 0 and on_count < join_count:
            warnings.append("Possible cartesian product: JOIN without ON clause")
        
        return {
            'valid': True,
            'tables': tables,
            'warnings': warnings,
            'suggestions': self._get_suggestions(sql, tables)
        }
    
    def _validate_sql(self, sql: str) -> dict:
        """
        Validate SQL is safe and allowed.
        
        Checks:
        - SELECT only (no DDL/DML)
        - No dangerous keywords
        - Valid syntax
        """
        # Remove comments and normalize
        sql_clean = re.sub(r'--.*$', '', sql, flags=re.MULTILINE)
        sql_clean = re.sub(r'/\*.*?\*/', '', sql_clean, flags=re.DOTALL)
        sql_upper = sql_clean.upper().strip()
        
        # Must start with SELECT
        if not sql_upper.startswith('SELECT'):
            return {
                'valid': False,
                'error': "Only SELECT statements are allowed"
            }
        
        # Forbidden keywords
        forbidden = [
            'DROP', 'DELETE', 'INSERT', 'UPDATE', 'CREATE', 'ALTER',
            'TRUNCATE', 'REPLACE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE'
        ]
        
        for keyword in forbidden:
            if re.search(r'\b' + keyword + r'\b', sql_upper):
                return {
                    'valid': False,
                    'error': f"Forbidden keyword: {keyword}"
                }
        
        # Check for multiple statements
        if ';' in sql_clean.rstrip(';'):
            return {
                'valid': False,
                'error': "Multiple statements not allowed. Use single SELECT only."
            }
        
        # Try parsing
        try:
            parsed = sqlparse.parse(sql_clean)
            if not parsed:
                return {
                    'valid': False,
                    'error': "Invalid SQL syntax"
                }
        except Exception as e:
            return {
                'valid': False,
                'error': f"SQL parsing error: {str(e)}"
            }
        
        return {'valid': True}
    
    def _extract_table_names(self, sql: str) -> list:
        """
        Extract table names from SQL.
        Handles quoted identifiers and aliases.
        """
        tables = []
        
        # Parse SQL
        parsed = sqlparse.parse(sql)[0]
        
        # Extract from FROM and JOIN clauses
        from_seen = False
        
        for token in parsed.tokens:
            # Look for FROM keyword
            if token.ttype is Keyword and token.value.upper() == 'FROM':
                from_seen = True
                continue
            
            # After FROM, next identifier is table
            if from_seen and isinstance(token, Identifier):
                table_name = self._extract_table_name(token)
                if table_name:
                    tables.append(table_name)
                from_seen = False
            
            # Handle identifier lists (multiple tables)
            if from_seen and isinstance(token, IdentifierList):
                for identifier in token.get_identifiers():
                    table_name = self._extract_table_name(identifier)
                    if table_name:
                        tables.append(table_name)
                from_seen = False
            
            # Handle JOIN clauses
            if token.ttype is Keyword and 'JOIN' in token.value.upper():
                # Next non-whitespace token should be table
                idx = parsed.tokens.index(token)
                for next_token in parsed.tokens[idx+1:]:
                    if next_token.ttype is not sqlparse.tokens.Whitespace:
                        if isinstance(next_token, Identifier):
                            table_name = self._extract_table_name(next_token)
                            if table_name:
                                tables.append(table_name)
                        break
        
        return list(set(tables))  # Remove duplicates
    
    def _extract_table_name(self, identifier) -> str:
        """Extract actual table name from identifier (handles aliases and quotes)"""
        # Get real name (without alias)
        name = identifier.get_real_name()
        
        # Remove quotes if present
        if name:
            name = name.strip('"').strip("'").strip('`')
        
        return name
    
    def _validate_tables(self, env_id: str, tables: list) -> dict:
        """
        Validate that all tables exist and belong to this environment.
        """
        if not tables:
            return {
                'valid': False,
                'error': "No tables found in query"
            }
        
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            # Get valid tables for this environment
            cursor.execute("""
                SELECT table_name FROM datasets
                WHERE env_id = ?
            """, (env_id,))
            
            valid_tables = {row[0] for row in cursor.fetchall()}
            
            # Check each table
            invalid_tables = [t for t in tables if t not in valid_tables]
            
            if invalid_tables:
                return {
                    'valid': False,
                    'error': f"Invalid table(s): {', '.join(invalid_tables)}. Use only datasets uploaded to this environment."
                }
            
            return {'valid': True}
            
        finally:
            conn.close()
    
    def _ensure_limit(self, sql: str, limit: int) -> str:
        """Add LIMIT clause if not present"""
        sql_upper = sql.upper()
        
        if 'LIMIT' in sql_upper:
            # Extract existing limit
            match = re.search(r'LIMIT\s+(\d+)', sql_upper)
            if match:
                existing_limit = int(match.group(1))
                if existing_limit > limit:
                    # Replace with our limit
                    sql = re.sub(r'LIMIT\s+\d+', f'LIMIT {limit}', sql, flags=re.IGNORECASE)
        else:
            # Add limit
            sql = sql.rstrip(';').strip() + f' LIMIT {limit}'
        
        return sql
    
    def _get_suggestions(self, sql: str, tables: list) -> list:
        """
        Provide helpful suggestions based on SQL pattern.
        """
        suggestions = []
        sql_upper = sql.upper()
        
        # Suggest using LEFT JOIN for preservation
        if 'INNER JOIN' in sql_upper:
            suggestions.append("Consider using LEFT JOIN to preserve all records from base table")
        
        # Suggest column selection
        if sql_upper.strip().startswith('SELECT *'):
            suggestions.append("Consider selecting specific columns for better performance")
        
        # Suggest adding WHERE for filtering
        if len(tables) == 1 and 'WHERE' not in sql_upper:
            suggestions.append("Add WHERE clause to filter results")
        
        return suggestions
    
    def get_table_info(self, env_id: str, table_name: str) -> dict:
        """
        Get column information for a table.
        Useful for SQL editor autocomplete.
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            # Validate table belongs to environment
            cursor.execute("""
                SELECT dataset_id, dataset_name FROM datasets
                WHERE table_name = ? AND env_id = ?
            """, (table_name, env_id))
            
            row = cursor.fetchone()
            if not row:
                return {
                    'success': False,
                    'error': 'Table not found'
                }
            
            dataset_id, dataset_name = row
            
            # Get columns from schema_metadata
            cursor.execute("""
                SELECT column_name, inferred_type, user_override_type
                FROM schema_metadata
                WHERE dataset_id = ?
            """, (dataset_id,))
            
            columns = []
            for col_row in cursor.fetchall():
                columns.append({
                    'name': col_row[0],
                    'type': col_row[2] or col_row[1]
                })
            
            return {
                'success': True,
                'table_name': table_name,
                'dataset_name': dataset_name,
                'columns': columns
            }
            
        finally:
            conn.close()