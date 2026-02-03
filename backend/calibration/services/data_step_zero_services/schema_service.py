# ============================================================================
# backend/calibration/services/data_step_zero_services/schema_service.py
# ============================================================================
"""
Schema Service - Pure Metadata Management
Handles schema inference, type overrides, and effective schema computation
NO data mutation - only metadata
"""
import pandas as pd
import json
from datetime import datetime
import uuid


class SchemaService:
    """
    Manages schema inference and user overrides.
    Principles:
    - Infer types from data
    - Allow user overrides
    - Track effective schema (inferred + overrides)
    - Never mutate actual data
    """
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def infer_schema(self, env_id: str, dataset_id: str) -> dict:
        """
        Infer schema from uploaded dataset.
        Returns column metadata including types, nulls, uniqueness, samples.
        
        This is called after upload to populate schema_metadata table.
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            # Get dataset table name
            cursor.execute("""
                SELECT table_name, dataset_name 
                FROM datasets 
                WHERE dataset_id = ? AND env_id = ?
            """, (dataset_id, env_id))
            
            row = cursor.fetchone()
            if not row:
                raise ValueError(f"Dataset {dataset_id} not found")
            
            table_name, dataset_name = row
            
            # Load data for analysis (sample for large datasets)
            df = pd.read_sql_query(f'SELECT * FROM "{table_name}" LIMIT 10000', conn)
            
            print(f"🔍 [SCHEMA] Analyzing {dataset_name}: {len(df)} rows, {len(df.columns)} columns")
            
            columns_metadata = []
            
            for col in df.columns:
                # Skip system columns
                if col in ['id', 'loaded_at']:
                    continue
                
                # Infer type
                inferred_type = self._infer_column_type(df[col])
                
                # Check for existing override
                cursor.execute("""
                    SELECT user_override_type 
                    FROM schema_metadata 
                    WHERE dataset_id = ? AND column_name = ?
                """, (dataset_id, col))
                
                override_row = cursor.fetchone()
                user_override = override_row[0] if override_row else None
                
                # Calculate statistics
                null_count = df[col].isnull().sum()
                null_pct = round((null_count / len(df)) * 100, 2) if len(df) > 0 else 0
                unique_count = df[col].nunique()
                unique_pct = round((unique_count / len(df)) * 100, 2) if len(df) > 0 else 0
                
                # Sample values (non-null, unique)
                samples = df[col].dropna().unique()[:5].tolist()
                sample_values = [str(s) for s in samples]
                
                columns_metadata.append({
                    'name': col,
                    'inferred_type': inferred_type,
                    'user_override': user_override,
                    'effective_type': user_override or inferred_type,
                    'null_pct': null_pct,
                    'unique_pct': unique_pct,
                    'unique_count': unique_count,
                    'sample_values': sample_values
                })
            
            # Save to schema_metadata table
            self._save_schema_metadata(dataset_id, columns_metadata)
            
            print(f"✅ [SCHEMA] Inferred schema for {dataset_name}")
            
            return {
                'success': True,
                'dataset_id': dataset_id,
                'dataset_name': dataset_name,
                'columns': columns_metadata
            }
            
        except Exception as e:
            print(f"❌ [SCHEMA] Inference failed: {e}")
            return {
                'success': False,
                'error': str(e)
            }
        finally:
            conn.close()
    
    def _infer_column_type(self, series: pd.Series) -> str:
        """
        Infer column type from pandas series.
        
        Returns one of:
        - 'numeric': Integers or floats
        - 'date': Date or datetime
        - 'boolean': True/False, Yes/No, 1/0
        - 'string': Everything else
        """
        # Drop nulls for type checking
        non_null = series.dropna()
        
        if len(non_null) == 0:
            return 'string'
        
        # Try numeric
        try:
            pd.to_numeric(non_null, errors='raise')
            return 'numeric'
        except (ValueError, TypeError):
            pass
        
        # Try date
        try:
            parsed = pd.to_datetime(non_null, errors='raise')
            # Verify it's actually dates (not just parseable strings)
            # Check if dates span more than just one value
            if len(parsed.unique()) > 1 or any(char in str(non_null.iloc[0]) for char in ['-', '/']):
                return 'date'
        except:
            pass
        
        # Try boolean
        unique_vals = non_null.unique()
        if len(unique_vals) <= 2:
            bool_vals = {'true', 'false', '1', '0', 'yes', 'no', 't', 'f', 'y', 'n', '1.0', '0.0'}
            if all(str(v).lower() in bool_vals for v in unique_vals):
                return 'boolean'
        
        # Default to string
        return 'string'
    
    def _save_schema_metadata(self, dataset_id: str, columns: list):
        """
        Persist schema metadata to database.
        Replaces existing metadata for this dataset.
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            # Delete existing metadata
            cursor.execute("DELETE FROM schema_metadata WHERE dataset_id = ?", (dataset_id,))
            
            # Insert new metadata
            for col in columns:
                schema_id = str(uuid.uuid4())
                cursor.execute("""
                    INSERT INTO schema_metadata 
                    (schema_id, dataset_id, column_name, inferred_type, 
                     user_override_type, null_pct, unique_pct, sample_values)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    schema_id,
                    dataset_id,
                    col['name'],
                    col['inferred_type'],
                    col.get('user_override'),
                    col['null_pct'],
                    col['unique_pct'],
                    json.dumps(col['sample_values'])
                ))
            
            conn.commit()
        finally:
            conn.close()
    
    def save_type_override(self, env_id: str, dataset_id: str, 
                          column_name: str, new_type: str) -> dict:
        """
        Save user's manual type override.
        
        This is metadata-only - does NOT change the actual data.
        The override is used during joins and validations.
        """
        valid_types = ['string', 'numeric', 'date', 'boolean']
        if new_type not in valid_types:
            return {
                'success': False,
                'error': f"Invalid type: {new_type}. Must be one of {valid_types}"
            }
        
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            # Verify dataset exists
            cursor.execute("""
                SELECT 1 FROM datasets 
                WHERE dataset_id = ? AND env_id = ?
            """, (dataset_id, env_id))
            
            if not cursor.fetchone():
                return {'success': False, 'error': 'Dataset not found'}
            
            # Update override
            cursor.execute("""
                UPDATE schema_metadata 
                SET user_override_type = ?
                WHERE dataset_id = ? AND column_name = ?
            """, (new_type, dataset_id, column_name))
            
            if cursor.rowcount == 0:
                return {
                    'success': False,
                    'error': f'Column {column_name} not found in dataset'
                }
            
            conn.commit()
            
            print(f"✏️ [SCHEMA] Override {column_name} → {new_type}")
            
            return {
                'success': True,
                'dataset_id': dataset_id,
                'column': column_name,
                'new_type': new_type
            }
        finally:
            conn.close()
    
    def get_effective_schema(self, env_id: str, dataset_id: str) -> dict:
        """
        Get merged schema (inferred + user overrides).
        
        This is what's used for:
        - Join validation
        - SQL execution
        - Type checking
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT column_name, inferred_type, user_override_type,
                       null_pct, unique_pct, sample_values
                FROM schema_metadata
                WHERE dataset_id = ?
                ORDER BY rowid
            """, (dataset_id,))
            
            columns = []
            for row in cursor.fetchall():
                col_name, inferred, override, null_pct, unique_pct, samples_json = row
                
                # Parse sample values
                try:
                    sample_values = json.loads(samples_json) if samples_json else []
                except:
                    sample_values = []
                
                columns.append({
                    'name': col_name,
                    'type': override or inferred,
                    'inferred_type': inferred,
                    'user_override': override,
                    'null_pct': null_pct,
                    'unique_pct': unique_pct,
                    'sample_values': sample_values
                })
            
            return {
                'success': True,
                'dataset_id': dataset_id,
                'columns': columns
            }
        finally:
            conn.close()
    
    def get_dataset_columns(self, env_id: str, dataset_id: str) -> list:
        """
        Simple helper to get column names for dropdowns.
        Returns list of {name, type} for UI consumption.
        """
        schema = self.get_effective_schema(env_id, dataset_id)
        if not schema.get('success'):
            return []
        
        return [
            {'name': col['name'], 'type': col['type']}
            for col in schema['columns']
        ]
    
    def get_join_compatible_columns(self, env_id: str, 
                                   left_dataset_id: str, 
                                   right_dataset_id: str) -> dict:
        """
        Find columns that are type-compatible for joins.
        
        Returns:
        {
            'left_columns': [...],
            'right_columns': [...],
            'suggestions': [{'left': ..., 'right': ..., 'confidence': ...}]
        }
        """
        left_schema = self.get_effective_schema(env_id, left_dataset_id)
        right_schema = self.get_effective_schema(env_id, right_dataset_id)
        
        if not left_schema.get('success') or not right_schema.get('success'):
            return {
                'success': False,
                'error': 'Failed to get schemas'
            }
        
        left_cols = left_schema['columns']
        right_cols = right_schema['columns']
        
        # Find potential join keys (same type + similar names)
        suggestions = []
        
        for left_col in left_cols:
            for right_col in right_cols:
                # Type must match
                if left_col['type'] != right_col['type']:
                    continue
                
                # Skip string types with low uniqueness (likely not join keys)
                if left_col['type'] == 'string':
                    if left_col.get('unique_pct', 0) < 10 or right_col.get('unique_pct', 0) < 10:
                        continue
                
                # Calculate name similarity
                left_name = left_col['name'].lower()
                right_name = right_col['name'].lower()
                
                # Exact match
                if left_name == right_name:
                    suggestions.append({
                        'left': left_col['name'],
                        'right': right_col['name'],
                        'type': left_col['type'],
                        'confidence': 100,
                        'reason': 'Exact name match'
                    })
                # Contains match (e.g., 'customer_id' and 'cust_id')
                elif left_name in right_name or right_name in left_name:
                    suggestions.append({
                        'left': left_col['name'],
                        'right': right_col['name'],
                        'type': left_col['type'],
                        'confidence': 80,
                        'reason': 'Partial name match'
                    })
                # ID columns
                elif 'id' in left_name and 'id' in right_name:
                    # Extract base names
                    left_base = left_name.replace('_id', '').replace('id', '')
                    right_base = right_name.replace('_id', '').replace('id', '')
                    if left_base and right_base and (left_base in right_base or right_base in left_base):
                        suggestions.append({
                            'left': left_col['name'],
                            'right': right_col['name'],
                            'type': left_col['type'],
                            'confidence': 70,
                            'reason': 'Similar ID pattern'
                        })
        
        # Sort by confidence
        suggestions.sort(key=lambda x: x['confidence'], reverse=True)
        
        return {
            'success': True,
            'left_columns': [{'name': c['name'], 'type': c['type']} for c in left_cols],
            'right_columns': [{'name': c['name'], 'type': c['type']} for c in right_cols],
            'suggestions': suggestions[:10]  # Top 10
        }
    
    def reset_overrides(self, dataset_id: str) -> dict:
        """
        Reset all user overrides for a dataset.
        Returns to inferred types.
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                UPDATE schema_metadata
                SET user_override_type = NULL
                WHERE dataset_id = ?
            """, (dataset_id,))
            
            conn.commit()
            
            return {
                'success': True,
                'dataset_id': dataset_id,
                'message': 'All overrides reset'
            }
        finally:
            conn.close()