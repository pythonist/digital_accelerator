# services/data_ingestion.py
import pandas as pd
import json
import traceback
import numpy as np
import os
from datetime import datetime

class DataIngestionService:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self._ensure_history_table()

    def _ensure_history_table(self):
        """Creates the upload_history table if it doesn't exist."""
        try:
            conn = self.db_manager.connect()
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS upload_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT,
                    entity_type TEXT,
                    table_name TEXT,
                    rows_loaded INTEGER,
                    columns_loaded INTEGER,
                    status TEXT,
                    error_message TEXT,
                    upload_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"⚠️ Warning: Could not check/create upload_history table: {e}")

    def _log_upload(self, filename, entity_type, table_name, rows, cols, status, error=None):
        """Logs the upload attempt to the database."""
        try:
            conn = self.db_manager.connect()
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO upload_history 
                (filename, entity_type, table_name, rows_loaded, columns_loaded, status, error_message)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (filename, entity_type, table_name, rows, cols, status, str(error) if error else None))
            conn.commit()
            conn.close()
            print(f"✅ Logged upload history: {filename} ({status})")
        except Exception as e:
            print(f"❌ Failed to log upload history: {e}")

    def load_csv(self, file_path, table_name=None, persist_to_db=True):
        """
        Reads CSV, ingests to DB, and logs the history.
        """
        filename = os.path.basename(file_path)
        try:
            print(f"📂 Reading CSV: {file_path}")
            
            # 1. Read CSV
            df = pd.read_csv(file_path, encoding="utf-8-sig", encoding_errors="replace", dtype=str)
            
            # 2. Basic Data Cleanup
            df = df.replace({np.nan: None, "nan": None, "NaN": None})
            
            # 3. Stats
            stats = {
                "total_rows": len(df),
                "columns": df.columns.tolist(),
                "table_name": table_name
            }

            # 4. Persist & Log
            if persist_to_db and table_name:
                self.db_manager.bulk_insert_table(table_name, df)
                self._log_upload(filename, table_name, table_name, len(df), len(df.columns), 'success')

            return df, stats
            
        except Exception as e:
            print(f"❌ Data Ingestion Error for {table_name}: {e}")
            # Log Failure
            if persist_to_db and table_name:
                self._log_upload(filename, table_name, table_name, 0, 0, 'failed', e)
            traceback.print_exc()
            raise e

    def load_json(self, file_path, table_name=None, persist_to_db=True):
        filename = os.path.basename(file_path)
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            if isinstance(data, dict) and 'records' in data:
                df = pd.DataFrame(data['records'], dtype=str)
            elif isinstance(data, list):
                df = pd.DataFrame(data, dtype=str)
            else:
                raise ValueError("Invalid JSON format")

            stats = {
                "total_rows": len(df),
                "columns": df.columns.tolist(),
                "table_name": table_name
            }

            if persist_to_db and table_name:
                self.db_manager.bulk_insert_table(table_name, df)
                self._log_upload(filename, table_name, table_name, len(df), len(df.columns), 'success')
                
            return df, stats
        except Exception as e:
            print(f"❌ JSON Ingestion Error: {e}")
            if persist_to_db and table_name:
                self._log_upload(filename, table_name, table_name, 0, 0, 'failed', e)
            raise e