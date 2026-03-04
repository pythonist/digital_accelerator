# backend/calibration/services/data_step_zero_services/dataset_manager.py
import json
import re
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime
import uuid
import os

# ✅ TRY TO IMPORT PYARROW
try:
    import pyarrow as pa
    import pyarrow.parquet as pq
    HAS_PYARROW = True
except ImportError:
    HAS_PYARROW = False
    print("WARNING: PyArrow not found. Install with: pip install pyarrow")

class DatasetManager:
    def __init__(self, db_manager):
        self.db = db_manager
    
    
    
    def upload_dataset(self, env_id, file_path, dataset_name=None, original_filename=None):
        """Upload CSV and STORE data in SQLite (Step-0, schema-safe, NOT NULL safe)"""
        print(f"📤 [UPLOAD] Starting upload for: {dataset_name}")

        try:
            # ---------- helpers ----------
            def ensure_column(cursor, table, column, col_type):
                cursor.execute(f"PRAGMA table_info({table})")
                cols = {row[1] for row in cursor.fetchall()}
                if column not in cols:
                    print(f"🛠️ [MIGRATION] {table}: adding column {column}")
                    cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")

            def infer_semantic_type(dtype_str):
                d = dtype_str.lower()
                if "int" in d:
                    return "INTEGER"
                if "float" in d:
                    return "FLOAT"
                if "bool" in d:
                    return "BOOLEAN"
                if "datetime" in d or "date" in d:
                    return "DATETIME"
                return "STRING"

            # ---------- 1. Read CSV ----------
            df = pd.read_csv(file_path)
            print(f"📊 [UPLOAD] Read {len(df)} rows × {len(df.columns)} columns")

            if df.empty:
                return {'success': False, 'error': 'CSV file is empty'}

            # ---------- 2. IDs ----------
            dataset_id = str(uuid.uuid4())
            safe_name = (dataset_name or original_filename or "dataset").lower().replace(" ", "_")
            table_name = f"temp_{env_id}_{safe_name}_{dataset_id[:8]}"

            print(f"📍 [UPLOAD] Table name: {table_name}")

            # ---------- 3. Store data ----------
            conn = self.db.connect()
            df.to_sql(table_name, conn, index=False, if_exists='replace')
            print(f"✅ [UPLOAD] Data stored in table: {table_name}")

            cursor = conn.cursor()

            # ---------- 4. Verify ----------
            cursor.execute(f'SELECT COUNT(*) FROM "{table_name}"')
            if cursor.fetchone()[0] == 0:
                raise ValueError("Data was not stored")

            # ---------- 5. MIGRATIONS ----------
            ensure_column(cursor, "datasets", "file_size", "INTEGER")

            ensure_column(cursor, "schema_metadata", "data_type", "TEXT")
            ensure_column(cursor, "schema_metadata", "sample_values", "TEXT")
            # inferred_type already exists AND is NOT NULL → do NOT alter it

            # ---------- 6. Insert dataset metadata ----------
            cursor.execute("""
                INSERT INTO datasets
                (dataset_id, env_id, dataset_name, table_name,
                row_count, column_count, original_filename,
                uploaded_at, file_size)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                dataset_id,
                env_id,
                dataset_name or original_filename,
                table_name,
                len(df),
                len(df.columns),
                original_filename,
                datetime.now().isoformat(),
                os.path.getsize(file_path)
            ))

            # ---------- 7. Insert schema metadata (🔥 FIXED) ----------
            for col in df.columns:
                dtype_str = str(df[col].dtype)
                inferred_type = infer_semantic_type(dtype_str)

                cursor.execute("""
                    INSERT INTO schema_metadata
                    (dataset_id, column_name, data_type, inferred_type, sample_values)
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    dataset_id,
                    col,
                    dtype_str,
                    inferred_type,
                    json.dumps(df[col].head(5).tolist())
                ))

            conn.commit()
            conn.close()

            return {
                "success": True,
                "dataset_id": dataset_id,
                "table_name": table_name,
                "row_count": len(df),
                "column_count": len(df.columns)
            }

        except Exception as e:
            print(f"❌ [UPLOAD] Failed: {e}")
            import traceback
            traceback.print_exc()
        return {"success": False, "error": str(e)}


    
    def _intelligent_name_from_filename(self, filename: str) -> str:
        """
        Extract intelligent dataset name from filename.
        
        Examples:
        - "transactions_2024.csv" → "Transactions"
        - "customer_data.csv" → "Customers"
        - "account_list.csv" → "Accounts"
        - "alert_data.csv" → "Alerts"
        - "str_file.csv" → "STR Data"
        """
        # Remove common suffixes
        name = filename.lower()
        name = re.sub(r'_(data|file|list|export|dump|extract|raw|clean|final)$', '', name)
        name = re.sub(r'_\d{4}(_\d{2})?(_\d{2})?$', '', name)  # Remove dates
        
        # Detect known patterns
        if 'transaction' in name or 'txn' in name or 'trans' in name:
            return 'Transactions'
        elif 'customer' in name or 'client' in name or 'cust' in name:
            return 'Customers'
        elif 'account' in name or 'acct' in name:
            return 'Accounts'
        elif 'alert' in name:
            return 'Alerts'
        elif 'str' in name or 'suspicious' in name:
            return 'STR Data'
        elif 'sanction' in name:
            return 'Sanctions'
        elif 'case' in name:
            return 'Cases'
        else:
            # Capitalize first letter of each word
            words = name.replace('_', ' ').replace('-', ' ').split()
            return ' '.join(word.capitalize() for word in words) if words else 'Dataset'
    
    def rename_dataset(self, dataset_id: str, new_name: str) -> dict:
        """Rename a dataset (metadata only)"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                UPDATE datasets
                SET dataset_name = ?
                WHERE dataset_id = ?
            """, (new_name, dataset_id))
            
            if cursor.rowcount == 0:
                return {'success': False, 'error': 'Dataset not found'}
            
            conn.commit()
            
            return {
                'success': True,
                'dataset_id': dataset_id,
                'new_name': new_name
            }
        finally:
            conn.close()
    
    def delete_dataset(self, dataset_id: str) -> dict:
        """Delete dataset and its table"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT table_name FROM datasets
                WHERE dataset_id = ?
            """, (dataset_id,))
            
            row = cursor.fetchone()
            if not row:
                return {'success': False, 'error': 'Dataset not found'}
            
            table_name = row[0]
            
            cursor.execute(f'DROP TABLE IF EXISTS "{table_name}"')
            cursor.execute("DELETE FROM datasets WHERE dataset_id = ?", (dataset_id,))
            cursor.execute("DELETE FROM schema_metadata WHERE dataset_id = ?", (dataset_id,))
            try:
                cursor.execute("DELETE FROM semantic_mappings WHERE dataset_id = ?", (dataset_id,))
            except Exception:
                pass
            
            conn.commit()
            
            print(f"🗑️ [DATASET] Deleted {dataset_id}")
            
            return {
                'success': True,
                'dataset_id': dataset_id,
                'message': 'Dataset deleted'
            }
            
        except Exception as e:
            conn.rollback()
            return {
                'success': False,
                'error': str(e)
            }
        finally:
            conn.close()
    
    def list_datasets(self, env_id: str) -> list:
        """Get all datasets for an environment"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT dataset_id, dataset_name, table_name, row_count, uploaded_at
                FROM datasets
                WHERE env_id = ?
                ORDER BY uploaded_at DESC
            """, (env_id,))
            
            datasets = []
            for row in cursor.fetchall():
                datasets.append({
                    'id': row[0],
                    'name': row[1],
                    'table': row[2],
                    'row_count': row[3],
                    'uploaded_at': row[4]
                })
            
            return datasets
            
        finally:
            conn.close()
    
    def get_dataset_info(self, dataset_id: str) -> dict:
        """Get detailed info about a dataset"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT dataset_id, env_id, dataset_name, table_name, 
                       row_count, uploaded_at
                FROM datasets
                WHERE dataset_id = ?
            """, (dataset_id,))
            
            row = cursor.fetchone()
            if not row:
                return None
            
            table_name = row[3]
            cursor.execute(f'PRAGMA table_info("{table_name}")')
            columns = [col[1] for col in cursor.fetchall() if col[1] not in ('id', 'loaded_at')]
            
            return {
                'dataset_id': row[0],
                'env_id': row[1],
                'dataset_name': row[2],
                'table_name': row[3],
                'row_count': row[4],
                'column_count': len(columns),
                'columns': columns,
                'uploaded_at': row[5]
            }
            
        finally:
            conn.close()
    
    def get_preview(self, dataset_id: str, limit: int = 100) -> dict:
        """Get preview of dataset rows"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                SELECT table_name FROM datasets
                WHERE dataset_id = ?
            """, (dataset_id,))
            
            row = cursor.fetchone()
            if not row:
                return {'success': False, 'error': 'Dataset not found'}
            
            table_name = row[0]
            df = pd.read_sql_query(f'SELECT * FROM "{table_name}" LIMIT {limit}', conn)
            
            return {
                'success': True,
                'dataset_id': dataset_id,
                'rows': df.to_dict(orient='records'),
                'columns': df.columns.tolist(),
                'row_count': len(df)
            }
            
        finally:
            conn.close()
    
    def _normalize_column_name(self, col_name: str) -> str:
        """Convert 'Column Name' -> 'column_name'"""
        if not col_name:
            return "col_unknown"
        
        normalized = str(col_name).strip().lower()
        normalized = normalized.replace(' ', '_').replace('-', '_')
        normalized = normalized.replace('/', '_').replace('\\', '_')
        normalized = ''.join(c if c.isalnum() or c == '_' else '' for c in normalized)
        
        if normalized and normalized[0].isdigit():
            normalized = 'col_' + normalized
        
        return normalized or 'col_unknown'
    
    def _sanitize_name(self, name: str) -> str:
        """Sanitize dataset name for table name"""
        sanitized = ''.join(c if c.isalnum() or c == '_' else '_' for c in name)
        
        while '__' in sanitized:
            sanitized = sanitized.replace('__', '_')
        
        sanitized = sanitized.strip('_')[:40]
        
        return sanitized or 'dataset'
    
    def _delete_dataset_data(self, dataset_id: str):
        """Helper to delete dataset table"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            cursor.execute("SELECT table_name FROM datasets WHERE dataset_id = ?", (dataset_id,))
            row = cursor.fetchone()
            if row:
                cursor.execute(f'DROP TABLE IF EXISTS "{row[0]}"')
                conn.commit()
        finally:
            conn.close()
