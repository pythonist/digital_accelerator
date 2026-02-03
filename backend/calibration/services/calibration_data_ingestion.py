# backend/calibration/calibration_data_ingestion.py
"""
Calibration Data Ingestion Service
Handles CSV uploads and stores in calibration-specific tables
"""
import pandas as pd
import numpy as np
import os
import traceback
from pathlib import Path

class CalibrationDataIngestionService:
    """
    Handles data loading specifically for calibration tool.
    Separate from investigation tool to maintain clean separation.
    """
    
    def __init__(self, db_manager):
        # FIX: We accept the db_manager OBJECT here, not a path string.
        self.db = db_manager
        self.data_dir = None
    
    def set_environment_data_dir(self, env_id):
        """Set the data directory for specific environment"""
        self.data_dir = f"data/calibration/{env_id}/raw"
        Path(self.data_dir).mkdir(parents=True, exist_ok=True)
    
    def load_csv_to_db(self, file_path, table_name, env_id):
        """
        Load CSV file into calibration database.
        """
        try:
            print(f"📂 [CALIBRATION] Loading {table_name} from {file_path}")
            
            # Read CSV with error handling
            df = pd.read_csv(
                file_path,
                encoding="utf-8-sig",
                encoding_errors="replace",
                dtype=str,
                na_values=['', 'NA', 'N/A', 'NULL', 'null', 'None']
            )
            
            # Clean column names
            df.columns = [self._normalize_column_name(col) for col in df.columns]
            
            # Replace NaN with None for SQL compatibility
            df = df.replace({np.nan: None})
            
            # Check validation (Non-blocking)
            validation_result = self._validate_table_columns(table_name, df.columns.tolist())
            
            if not validation_result['valid']:
                print(f"⚠️ [WARNING] Missing standard columns in {table_name}: {validation_result['missing']}")
                print(f"   Continuing upload anyway...")
            else:
                print(f"✅ All standard columns found for {table_name}")
            
            # Store in database
            self._create_or_update_table(table_name, df, env_id)
            
            stats = {
                "table_name": table_name,
                "env_id": env_id,
                "total_rows": len(df),
                "columns": df.columns.tolist(),
                "column_count": len(df.columns),
                "memory_usage_mb": round(df.memory_usage(deep=True).sum() / 1024 / 1024, 2)
            }
            
            print(f"✅ [CALIBRATION] Loaded {len(df):,} rows into {table_name}")
            return stats
            
        except Exception as e:
            print(f"❌ [CALIBRATION] Data ingestion error: {e}")
            traceback.print_exc()
            raise e
    
    def _normalize_column_name(self, col_name):
        """Convert 'Customer ID' -> 'customer_id'"""
        if not col_name:
            return "col_unknown"
        return str(col_name).strip().lower().replace(' ', '_').replace('-', '_').replace('/', '_')
    
    def _validate_table_columns(self, table_name, columns):
        """Validate that required columns exist"""
        required_columns = {
            'transactions': [
                'transaction_id', 'account_id', 'transaction_date', 
                'transaction_amount', 'transaction_type'
            ],
            'accounts': [
                'account_id', 'customer_id', 'account_type'
            ],
            'customers': [
                'customer_id', 'customer_name'
            ]
        }
        
        required = required_columns.get(table_name, [])
        missing = [col for col in required if col not in columns]
        
        return {
            'valid': len(missing) == 0,
            'missing': missing,
            'found': [col for col in required if col in columns]
        }
    
    def _create_or_update_table(self, table_name, df, env_id):
        """
        Dynamically create table if it doesn't exist, or append/replace data.
        """
        full_table_name = f"{env_id}_{table_name}"
        
        conn = self.db.connect()
        cursor = conn.cursor()
        
        try:
            # Check if table exists
            cursor.execute(f"""
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name=?
            """, (full_table_name,))
            
            table_exists = cursor.fetchone() is not None
            
            if not table_exists:
                # Create table dynamically
                print(f"🆕 Creating table: {full_table_name}")
                col_defs = [f'"{col}" TEXT' for col in df.columns]
                cols_sql = ", ".join(col_defs)
                
                create_sql = f"""
                CREATE TABLE "{full_table_name}" (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    {cols_sql},
                    loaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
                cursor.execute(create_sql)
            else:
                # Clear existing data (replace strategy)
                print(f"🔄 Replacing data in: {full_table_name}")
                cursor.execute(f'DELETE FROM "{full_table_name}"')
            
            # Insert data
            columns = list(df.columns)
            cols_str = ", ".join([f'"{c}"' for c in columns])
            placeholders = ", ".join(["?"] * len(columns))
            
            insert_sql = f'INSERT INTO "{full_table_name}" ({cols_str}) VALUES ({placeholders})'
            
            data_to_insert = df.where(pd.notnull(df), None).values.tolist()
            cursor.executemany(insert_sql, data_to_insert)
            
            conn.commit()
            print(f"✅ Inserted {len(data_to_insert):,} rows into {full_table_name}")
            
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def get_table_stats(self, env_id):
        """Get row counts for all uploaded tables"""
        tables = ['transactions', 'accounts', 'customers']
        stats = {}
        
        conn = self.db.connect()
        cursor = conn.cursor()
        
        for table in tables:
            full_table_name = f"{env_id}_{table}"
            try:
                cursor.execute(f'SELECT COUNT(*) FROM "{full_table_name}"')
                count = cursor.fetchone()[0]
                stats[table] = count
            except:
                stats[table] = 0
        
        conn.close()
        return stats
    
    def check_data_readiness(self, env_id):
        """Check if all required data is loaded"""
        stats = self.get_table_stats(env_id)
        
        return {
            'ready': all(stats[t] > 0 for t in ['transactions', 'accounts', 'customers']),
            'stats': stats,
            'missing': [t for t in ['transactions', 'accounts', 'customers'] if stats.get(t, 0) == 0]
        }

    # --- NEW METHOD FOR MAPPING UI ---
    def get_environment_schema(self, env_id):
        """
        Get all available columns for the tables in this environment.
        Used by UI to populate mapping dropdowns.
        """
        tables = ['transactions', 'accounts', 'customers']
        schema_info = {}
        
        conn = self.db.connect()
        cursor = conn.cursor()
        
        for table in tables:
            full_table_name = f"{env_id}_{table}"
            try:
                # Use PRAGMA to get column info without querying data
                cursor.execute(f'PRAGMA table_info("{full_table_name}")')
                # row format: (cid, name, type, notnull, dflt_value, pk)
                # Filter out system columns like 'id' and 'loaded_at'
                columns = [row[1] for row in cursor.fetchall() if row[1] not in ('id', 'loaded_at')]
                schema_info[table] = columns
            except Exception:
                schema_info[table] = []
        
        conn.close()
        return schema_info
    
    def ingest_str_data(self, file_path, env_id):
        """
        Ingest STR data from CSV
        
        CRITICAL: This is ground truth data - post-investigation outcomes
        Used ONLY for evaluation in Step 3, never for calibration
        
        Handles ANY CSV columns - only inserts columns that exist in strs table
        """
        import pandas as pd
        import numpy as np
        import uuid
        
        try:
            print(f"📂 [STR] Loading STR data from {file_path}")
            
            # Read CSV
            df = pd.read_csv(
                file_path,
                encoding="utf-8-sig",
                encoding_errors="replace",
                dtype=str,
                na_values=['', 'NA', 'N/A', 'NULL', 'null', 'None']
            )
            
            print(f"📋 [STR] CSV columns found: {df.columns.tolist()}")
            
            # Clean column names
            df.columns = [self._normalize_column_name(col) for col in df.columns]
            
            # Check required columns
            required = ['account_id', 'str_filed_date']
            missing = [col for col in required if col not in df.columns]
            
            if missing:
                raise ValueError(f"Missing required columns: {missing}")
            
            # Get the actual table schema
            conn = self.db.connect()
            cursor = conn.cursor()
            
            # Get columns that exist in strs table
            cursor.execute("PRAGMA table_info(strs)")
            table_columns = [row[1] for row in cursor.fetchall()]
            
            # Filter dataframe to only include columns that exist in table
            valid_columns = [col for col in df.columns if col in table_columns]
            
            if not valid_columns:
                raise ValueError(f"No matching columns found. CSV: {df.columns.tolist()} vs Table: {table_columns}")
            
            # Keep only valid columns
            df_filtered = df[valid_columns].copy()
            
            # 1. Handle str_filed_date
            if 'str_filed_date' in df_filtered.columns:
                df_filtered['str_filed_date'] = pd.to_datetime(df_filtered['str_filed_date'], errors='coerce')
                df_filtered = df_filtered[df_filtered['str_filed_date'].notna()]
                df_filtered['str_filed_date'] = df_filtered['str_filed_date'].dt.strftime('%Y-%m-%d')
            
            # 2. Generate str_id if not present
            if 'str_id' not in df_filtered.columns and 'str_id' in table_columns:
                df_filtered['str_id'] = [f"STR_{uuid.uuid4().hex[:12]}" for _ in range(len(df_filtered))]
            
            # 3. Clean account_id
            df_filtered['account_id'] = df_filtered['account_id'].astype(str).str.strip()
            
            # Replace NaN with None for SQLite
            df_filtered = df_filtered.replace({np.nan: None})
            
            # Clear existing STR data
            cursor.execute("DELETE FROM strs")
            
            # Insert new data
            df_filtered.to_sql('strs', conn, if_exists='append', index=False)
            conn.commit()
            
            # --- SAFE STATS CALCULATION ---
            cursor.execute("SELECT COUNT(*) FROM strs")
            total_count = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(DISTINCT account_id) FROM strs")
            unique_accounts = cursor.fetchone()[0]
            
            cursor.execute("SELECT MIN(str_filed_date), MAX(str_filed_date) FROM strs")
            date_range = cursor.fetchone()
            
            # --- CRITICAL FIX: Check if tables exist before joining ---
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('transactions', 'accounts')")
            existing_tables = [row[0] for row in cursor.fetchall()]
            
            overlap_count = 0
            
            if existing_tables:
                # Dynamically build query based on which tables actually exist
                sub_queries = [f"SELECT DISTINCT account_id FROM {tbl}" for tbl in existing_tables]
                union_query = " UNION ".join(sub_queries)
                
                query = f"""
                    SELECT COUNT(DISTINCT s.account_id)
                    FROM strs s
                    INNER JOIN (
                        {union_query}
                    ) t ON s.account_id = t.account_id
                """
                cursor.execute(query)
                res = cursor.fetchone()
                overlap_count = res[0] if res else 0
                print(f"✅ [STR] Verified overlap against: {existing_tables}")
            else:
                print("⚠️ [STR] Skipping overlap check - 'transactions' or 'accounts' tables not found.")
            
            conn.close()
            
            return {
                'success': True,
                'rows_inserted': total_count,
                'unique_accounts': unique_accounts,
                'date_range': {'start': date_range[0], 'end': date_range[1]},
                'account_overlap': {
                    'str_accounts': unique_accounts,
                    'matching_accounts': overlap_count
                }
            }
            
        except Exception as e:
            print(f"❌ [STR] Ingestion failed: {e}")
            import traceback
            traceback.print_exc()
            raise