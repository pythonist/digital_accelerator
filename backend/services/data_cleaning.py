import pandas as pd
import numpy as np
import sqlite3
import traceback
import os
class DataCleaningService:
    def __init__(self, db_manager):
        self.db_manager = db_manager

    def _load_df(self, table):
        """Safely load a table into a DataFrame."""
        conn = self.db_manager.connect()
        try:
            # Verify table exists first
            cursor = conn.cursor()
            cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'")
            if not cursor.fetchone():
                return None
            
            return pd.read_sql(f"SELECT * FROM {table}", conn)
        except Exception as e:
            print(f"Error loading {table}: {e}")
            return None
        finally:
            self.db_manager.close_connection(conn)

    def _save_df(self, df, table):
        """Safely save DataFrame back to DB."""
        conn = self.db_manager.connect()
        try:
            df.to_sql(table, conn, if_exists='replace', index=False)
            return True
        except Exception as e:
            print(f"Error saving {table}: {e}")
            raise e
        finally:
            self.db_manager.close_connection(conn)

    def get_column_metadata(self, table):
        """
        Returns rich metadata: Missing counts, Current Type, Inferred Type.
        """
        df = self._load_df(table)
        if df is None: 
            return {"columns": [], "total_rows": 0, "error": "Table not found"}

        metadata = []
        total_rows = len(df)

        for col in df.columns:
            # 1. Calculate Missing
            null_count = int(df[col].isnull().sum())
            null_pct = round((null_count / total_rows) * 100, 1) if total_rows > 0 else 0

            # 2. Infer Type
            current_type = str(df[col].dtype)
            inferred_type = current_type
            
            # Try to infer better type if it's generic 'object'
            if df[col].dtype == 'object':
                try:
                    # Check numeric
                    pd.to_numeric(df[col].dropna())
                    inferred_type = 'numeric'
                except:
                    # Check date
                    if any(x in col.lower() for x in ['date', 'time', 'dob', 'created']):
                        try:
                            pd.to_datetime(df[col].dropna())
                            inferred_type = 'datetime'
                        except:
                            pass
            
            metadata.append({
                "name": col,
                "type": current_type,
                "inferred_type": inferred_type,
                "missing_count": null_count,
                "missing_pct": null_pct
            })
            
        return {"columns": metadata, "total_rows": total_rows}

    def auto_convert_types(self, table):
        """
        Automatically converts columns to their inferred types.
        """
        df = self._load_df(table)
        if df is None: return {"success": False, "error": "Table not found"}
        
        converted_cols = []
        
        for col in df.columns:
            # 1. Try Numeric
            if df[col].dtype == 'object':
                try:
                    df[col] = pd.to_numeric(df[col])
                    converted_cols.append(f"{col} -> Numeric")
                    continue
                except:
                    pass
                
                # 2. Try Date (only if name suggests it)
                if any(x in col.lower() for x in ['date', 'time', 'dob', 'created']):
                    try:
                        df[col] = pd.to_datetime(df[col])
                        converted_cols.append(f"{col} -> Datetime")
                    except:
                        pass

        self._save_df(df, table)
        return {"success": True, "converted": converted_cols}

    def batch_rename_columns(self, source_table, renames, target_table=None):
        df = self._load_df(source_table)
        if df is None: return {"success": False, "error": "Source table not found"}

        # 1. Check for duplicates in NEW names
        new_names = list(df.columns)
        for old, new in renames.items():
            if old in new_names:
                idx = new_names.index(old)
                new_names[idx] = new
        
        if len(new_names) != len(set(new_names)):
             return {"success": False, "error": "Duplicate column names detected. Please ensure all names are unique."}

        # 2. Apply Rename
        df = df.rename(columns=renames)
        
        # 3. Save
        save_dest = target_table if target_table else source_table
        self._save_df(df, save_dest)
        
        # 4. Update System Config to point to new master
        if 'master' in save_dest:
            import json
            config_path = 'data/app_config.json'
            if os.path.exists(config_path):
                with open(config_path, 'r') as f: config = json.load(f)
                config['master_table'] = save_dest
                with open(config_path, 'w') as f: json.dump(config, f, indent=2)

        return {"success": True, "table": save_dest}

    def drop_column(self, table, column_name):
        df = self._load_df(table)
        if column_name in df.columns:
            df = df.drop(columns=[column_name])
            self._save_df(df, table)
        return {"success": True}

    def fill_missing(self, table, column_name, strategy, value=None):
        df = self._load_df(table)
        if column_name not in df.columns: return {"success": False, "error": "Column not found"}
        
        if strategy == 'value': 
            df[column_name] = df[column_name].fillna(value)
        elif strategy == 'mean': 
            df[column_name] = pd.to_numeric(df[column_name], errors='coerce').fillna(df[column_name].mean())
        elif strategy == 'median': 
            df[column_name] = pd.to_numeric(df[column_name], errors='coerce').fillna(df[column_name].median())
        elif strategy == 'mode': 
            df[column_name] = df[column_name].fillna(df[column_name].mode()[0])
        
        self._save_df(df, table)
        return {"success": True}

    def add_formula_column(self, table, new_col_name, expression):
        df = self._load_df(table)
        try:
            df.eval(f"{new_col_name} = {expression}", inplace=True)
            self._save_df(df, table)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
        
    def convert_text_to_uppercase(self, table):
        """
        Converts all string/text columns in the table to UPPERCASE.
        """
        df = self._load_df(table)
        if df is None: return {"success": False, "error": "Table not found"}
        
        converted_cols = []
        
        for col in df.columns:
            # Check if column is of object (string) type
            if df[col].dtype == 'object':
                try:
                    # Apply .str.upper()
                    df[col] = df[col].astype(str).str.upper()
                    
                    # Restore NuLLs (astype(str) converts None to 'None' or 'nan')
                    df[col] = df[col].replace({'NAN': None, 'NONE': None, '<NA>': None})
                    
                    converted_cols.append(col)
                except Exception as e:
                    print(f"Skipping col {col}: {e}")

        if not converted_cols:
            return {"success": True, "message": "No text columns found to convert."}

        self._save_df(df, table)
        return {"success": True, "converted": converted_cols}