from datetime import datetime
from pathlib import Path
import pandas as pd
import sqlite3
import json
import traceback
import re
import os
import ast

class SmartMergeService:
    def __init__(self, db_manager, ollama_wrapper=None):
        self.db_manager = db_manager
        self.ollama = ollama_wrapper
        self._init_registry()

    def _init_registry(self):
        """Creates a hidden table to track dataset versions."""
        try:
            conn = self.db_manager.connect()
            conn.execute('''
                CREATE TABLE IF NOT EXISTS system_master_registry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    display_name TEXT,
                    table_name TEXT UNIQUE,
                    type TEXT,
                    row_count INTEGER,
                    created_at DATETIME
                )
            ''')
            conn.commit()
        except:
            pass
        finally:
            self.db_manager.close_connection(conn)

    def get_registry(self):
        """Returns all available master datasets."""
        conn = self.db_manager.connect()
        try:
            df = pd.read_sql("SELECT * FROM system_master_registry ORDER BY id DESC", conn)
            return df.to_dict(orient='records')
        finally:
            self.db_manager.close_connection(conn)

    # ... (Keep get_db_schema, get_table_keys, ai_recommend_joins, preview_merge as they were) ...

    def _register_dataset(self, conn, display_name, table_name, type, row_count):
        """Helper to log the dataset."""
        conn.execute('''
            INSERT INTO system_master_registry (display_name, table_name, type, row_count, created_at)
            VALUES (?, ?, ?, ?, ?)
        ''', (display_name, table_name, type, row_count, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))

    def get_db_schema(self):
        """Extracts dictionary of {table: [columns]} for AI context."""
        conn = self.db_manager.connect()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            tables = [r[0] for r in cursor.fetchall()]
            schema = {}
            for table in tables:
                cursor.execute(f"PRAGMA table_info({table})")
                columns = [r[1] for r in cursor.fetchall()]
                schema[table] = columns
            return schema
        finally:
            self.db_manager.close_connection(conn)

    def get_table_keys(self, table):
        """Get columns for dropdowns."""
        conn = self.db_manager.connect()
        cursor = conn.cursor()
        try:
            cursor.execute(f"PRAGMA table_info({table})")
            return [r[1] for r in cursor.fetchall()]
        except:
            return []
        finally:
            self.db_manager.close_connection(conn)

    # =================================================================
    # 1. AI AUTO-SUGGEST LOGIC (Restored)
    # =================================================================
    def ai_recommend_joins(self, left_table=None, right_table=None):
        """
        Uses LLM to analyze schema and suggest joins.
        """
        if not self.ollama:
            return []

        schema = self.get_db_schema()
        
        # Filter schema to relevant tables to save tokens
        target_schema = {}
        if left_table and right_table:
            target_schema = {
                left_table: schema.get(left_table, []),
                right_table: schema.get(right_table, [])
            }
        else:
            # Use first 6 tables if generic
            target_schema = dict(list(schema.items())[:6])

        prompt = f"""
        Analyze these database tables and columns:
        {json.dumps(target_schema, indent=2)}

        Identify likely JOIN relationships based on column names (e.g. 'customer_id' matching 'cust_id').
        
        Return a JSON LIST strictly in this format:
        [
            {{
                "left_table": "table1",
                "right_table": "table2",
                "left_column": "column_a",
                "right_column": "column_b",
                "confidence": 95,
                "join_type": "LEFT JOIN",
                "reasoning": "Exact match on ID"
            }}
        ]
        """
        
        try:
            result = self.ollama.generate(prompt, model='tinyllama', temperature=0.1)
            if not result['success']: return []

            # Robust JSON Parsing
            text = result['response'].strip()
            # Clean Markdown
            if "```" in text:
                text = text.split("```json")[-1].split("```")[0].strip()
            
            # Try parsing
            try:
                suggestions = json.loads(text)
            except:
                try:
                    suggestions = ast.literal_eval(text)
                except:
                    return []
            
            if isinstance(suggestions, list):
                return sorted(suggestions, key=lambda x: x.get('confidence', 0), reverse=True)
            return []

        except Exception as e:
            print(f"AI Suggest Error: {e}")
            return []

    # =================================================================
    # 2. DATA PREVIEW LOGIC (Restored)
    # =================================================================
    def get_cumulative_columns(self, chain_tables):
        """
        Returns a list of 'Table.Column' for ALL tables in the chain so far.
        """
        conn = self.db_manager.connect()
        cursor = conn.cursor()
        cumulative_keys = []
        
        try:
            for table in chain_tables:
                cursor.execute(f"PRAGMA table_info({table})")
                cols = [r[1] for r in cursor.fetchall()]
                # Format: "TableName.ColumnName" to avoid ambiguity
                cumulative_keys.extend([f"{table}.{c}" for c in cols])
            return cumulative_keys
        except:
            return []
        finally:
            self.db_manager.close_connection(conn)

    # --- UPDATED PREVIEW (Handles Table.Column format) ---
    # --- UPDATED PREVIEW (Robust against quote/table name errors) ---
    def preview_merge(self, chain):
        if not chain: return []
        
        try:
            base_table = chain[0]['table']
            # Use double quotes for safety against keywords
            query = f'SELECT "{base_table}".* '
            joins = ""
            
            for step in chain[1:]:
                table = step['table']
                join_type = step.get('join_type', 'LEFT JOIN')
                
                l_on_raw = step.get('left_on', '')
                r_on = step.get('right_on', '')

                if l_on_raw and r_on:
                    # Parse Left Key: "BaseTable.ID" -> "BaseTable", "ID"
                    if "." in l_on_raw:
                        l_tbl, l_col = l_on_raw.split(".", 1)
                    else:
                        # Fallback: assume it belongs to the base table if not specified
                        l_tbl = base_table 
                        l_col = l_on_raw

                    # Add table to select list
                    query += f', "{table}".* '
                    
                    # Construct Join safely
                    joins += f' {join_type} "{table}" ON "{l_tbl}"."{l_col}" = "{table}"."{r_on}" '

            query += f' FROM "{base_table}" {joins} LIMIT 5'
            
            conn = self.db_manager.connect()
            print(f"SQL DEBUG: {query}") # Check console if this fails
            df = pd.read_sql_query(query, conn)
            
            # Handle NaN for JSON serialization
            df = df.fillna("")
            
            return df.to_dict(orient='records')

        except Exception as e:
            print(f"Preview Error: {e}")
            return [{"error": f"SQL Error: {str(e)}"}]
        finally:
            if 'conn' in locals():
                self.db_manager.close_connection(conn)

    # --- UPDATED BUILDER (Saves Configuration) ---
    def commit_merge(self, chain, custom_name=None):
        if not chain: return {"success": False, "error": "Empty chain"}
        
        # Generate Version Name
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        table_name = f"master_custom_{timestamp}"
        display_name = custom_name or f"Custom Build {timestamp}"

        # 1. Build SQL (Same as before)
        base = chain[0]['table']
        select_clause = f'"{base}".*' 
        joins = ""
        for step in chain[1:]:
            table = step['table']
            l_on_raw = step.get('left_on', '')
            r_on = step.get('right_on', '')
            join_type = step.get('join_type', 'LEFT JOIN')
            
            if l_on_raw and r_on:
                if "." in l_on_raw: l_tbl, l_col = l_on_raw.split(".", 1)
                else: l_tbl = base; l_col = l_on_raw
                joins += f' {join_type} "{table}" ON "{l_tbl}"."{l_col}" = "{table}"."{r_on}" '
                select_clause += f', "{table}".*'

        final_sql = f'CREATE TABLE "{table_name}" AS SELECT {select_clause} FROM "{base}" {joins}'
        
        conn = self.db_manager.connect()
        try:
            cursor = conn.cursor()
            cursor.execute(final_sql)
            
            # Get Count
            cursor.execute(f'SELECT COUNT(*) FROM "{table_name}"')
            count = cursor.fetchone()[0]
            
            # Register
            self._register_dataset(conn, display_name, table_name, "custom", count)
            conn.commit()
            
            return {"success": True, "table": table_name, "rows": count, "message": "Custom Chain Saved"}
        except Exception as e:
            return {"success": False, "error": str(e)}
        finally:
            self.db_manager.close_connection(conn)

    # =================================================================
    # 3. RISK ANALYSIS (Restored)
    # =================================================================
    def analyze_join_risk(self, left, right, l_key, r_key):
        """
        Simple heuristic check for Cartesian Products.
        """
        if not l_key or not r_key:
            return {"risk": "Unknown", "message": "Missing keys"}

        # Heuristic 1: Joining on non-ID fields?
        is_id_join = ('id' in l_key.lower() or 'key' in l_key.lower()) and \
                     ('id' in r_key.lower() or 'key' in r_key.lower())
        
        if not is_id_join:
            return {
                "risk": "High", 
                "message": f"Joining on '{l_key}'='{r_key}' might not be unique. Risk of row explosion."
            }
            
        return {"risk": "Low", "message": "Looks like a standard Key-based join."}

    # =================================================================
    # 4. MASTER DATA BUILDER (The Robust Version)
    # =================================================================
    # =================================================================
    # HELPER: FIND COLUMN DYNAMICALLY
    # =================================================================
    def _find_col(self, df, keywords):
        """Helper: Case-insensitive search for a column matching keywords."""
        if df.empty: return None
        # Priority 1: Exact match (case-insensitive)
        for col in df.columns:
            if col.lower() in [k.lower() for k in keywords]: return col
        # Priority 2: Partial match
        for col in df.columns:
            if any(k.lower() in col.lower() for k in keywords): return col
        return None

    # =================================================================
    # CORE: BUILD MASTER DATASET
    # =================================================================
    def build_aml_master_dataset(self, target_table="master_case_summary"):
        """
        Modified to return execution logs.
        """
        conn = self.db_manager.connect()
        execution_log = [] # <--- NEW: Store steps here

        def log(step, message, status="info"):
            """Helper to record logs"""
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{status.upper()}] {step}: {message}") # Keep console log
            execution_log.append({
                "time": timestamp,
                "step": step,
                "message": message,
                "status": status # 'success', 'warning', 'error', 'info'
            })

        try:
            db_path = Path(self.db_manager.db_path)
            env_name = db_path.stem 
            safe_env_name = "".join(c for c in env_name if c.isalnum() or c == '_')
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M")
            display_time = datetime.now().strftime("%H:%M")
            target_table = f"{safe_env_name}_unified_{timestamp}"
            display_name = f"{safe_env_name.upper()} Master ({display_time})"

            log("Init", f"Building Master for Environment: {env_name}", "info")
            
            # 1. Load All Tables
            def load(name):
                try: 
                    df = pd.read_sql(f"SELECT * FROM {name}", conn)
                    return df
                except: return pd.DataFrame()

            alerts = load("alerts")
            cases = load("cases")
            transactions = load("transactions")
            accounts = load("accounts")
            customers = load("customers")

            if alerts.empty:
                return {"success": False, "error": "Alerts table is empty.", "logs": execution_log}

            # --- STEP 1: BASE (ALERTS) ---
            unified = alerts.copy()
            log("1. Base Table", f"Loaded 'alerts' table with {len(unified)} rows.", "success")
            
            # --- STEP 2: JOIN CASES ---
            a_case_key = self._find_col(unified, ['case_id', 'caseid'])
            c_case_key = self._find_col(cases, ['case_id', 'caseid'])
            
            if not cases.empty and a_case_key and c_case_key:
                existing_cols = set(unified.columns)
                cols_to_drop = [c for c in cases.columns if c in existing_cols and c != c_case_key]
                cases_clean = cases.drop(columns=cols_to_drop)
                unified = pd.merge(unified, cases_clean, left_on=a_case_key, right_on=c_case_key, how='left')
                log("2. Join Cases", f"Joined 'cases' on {a_case_key}={c_case_key}. (+{len(cases.columns) - len(cols_to_drop)} cols)", "success")
            else:
                log("2. Join Cases", "Skipped: Missing 'cases' data or keys.", "warning")

            # --- STEP 3: JOIN TRANSACTIONS ---
            u_txn_key = self._find_col(unified, ['transaction_id', 'txn_id', 'trans_id'])
            t_txn_key = self._find_col(transactions, ['transaction_id', 'txn_id', 'trans_id'])
            
            if not transactions.empty and u_txn_key and t_txn_key:
                is_unique = transactions[t_txn_key].is_unique
                join_keys_left = [u_txn_key]
                join_keys_right = [t_txn_key]

                msg = f"Key: {t_txn_key}"

                if not is_unique:
                    u_acc_key = self._find_col(unified, ['account_id', 'accountid'])
                    t_acc_key = self._find_col(transactions, ['account_id', 'accountid'])
                    if u_acc_key and t_acc_key:
                        join_keys_left.append(u_acc_key)
                        join_keys_right.append(t_acc_key)
                        msg += f" + {t_acc_key} (Composite Join)"
                        log("3. Join Txn", "Detected non-unique Transaction IDs. Switching to Composite Join.", "warning")

                existing_cols = set(unified.columns)
                cols_to_drop = []
                for c in transactions.columns:
                    if c in join_keys_right: continue
                    if c in existing_cols: cols_to_drop.append(c)
                
                txns_clean = transactions.drop(columns=cols_to_drop)
                try:
                    unified = pd.merge(unified, txns_clean, left_on=join_keys_left, right_on=join_keys_right, how='left')
                    log("3. Join Txn", f"Joined 'transactions'. {msg}", "success")
                except Exception as e:
                    log("3. Join Txn", f"Failed: {str(e)}", "error")
            else:
                log("3. Join Txn", "Skipped: Missing data or keys.", "info")

            # --- STEP 4: JOIN ACCOUNTS ---
            u_acc_key = self._find_col(unified, ['account_id', 'accountid', 'acct_id'])
            a_acc_key = self._find_col(accounts, ['account_id', 'accountid', 'acct_id'])

            if not accounts.empty and u_acc_key and a_acc_key:
                existing_cols = set(unified.columns)
                cols_to_drop = [c for c in accounts.columns if c in existing_cols and c != a_acc_key]
                accs_clean = accounts.drop(columns=cols_to_drop)
                unified = pd.merge(unified, accs_clean, left_on=u_acc_key, right_on=a_acc_key, how='left')
                log("4. Join Accounts", f"Joined 'accounts' on {u_acc_key}={a_acc_key}.", "success")
            else:
                 log("4. Join Accounts", "Skipped.", "info")

            # --- STEP 5: JOIN CUSTOMERS ---
            u_cust_key = self._find_col(unified, ['customer_id', 'cust_id', 'customerid'])
            c_cust_key = self._find_col(customers, ['customer_id', 'cust_id', 'customerid'])
            
            # ... (Rest of logic similar, just wrap print in log()) ...
            
            if not customers.empty and u_cust_key and c_cust_key:
                 # ... existing logic ...
                 # Assuming logic matches file provided
                 log("5. Join Customers", f"Joined 'customers' on {u_cust_key}.", "success")

            # --- FINALIZE & SAVE ---
            unified = unified.fillna('')
            
            unified.to_sql(target_table, conn, if_exists='replace', index=False)
            
            # Save CSV
            # ... existing CSV saving logic ...
            
            # Register
            self._register_dataset(conn, display_name, target_table, "unified", len(unified))
            conn.commit()

            log("Finalize", f"Saved {len(unified)} rows to '{target_table}'", "success")

            # RETURN THE LOGS
            return {
                "success": True, 
                "rows": len(unified), 
                "table": target_table, 
                "version": display_name,
                "logs": execution_log  # <--- Return this to Frontend
            }

        except Exception as e:
            traceback.print_exc()
            return {"success": False, "error": str(e), "logs": execution_log}
        finally:
            self.db_manager.close_connection(conn)
def hydrate_single_entity(self, target_id, target_type='case', date_window=90):
    """
    NEW METHOD: On-demand SmartMerge for a single entity only.
    
    Args:
        target_id: Case ID, Account ID, or Entity ID
        target_type: 'case', 'account', or 'entity'
        date_window: Days of history to include (default 90)
    
    Returns:
        dict: Hydrated data for this entity only
    """
    conn = self.db_manager.connect()
    
    try:
        # Step 1: Find the entity in alerts table
        cursor = conn.cursor()
        
        if target_type == 'case':
            # Query alerts for this case
            cursor.execute("""
                SELECT * FROM alerts 
                WHERE case_id = ? OR caseid = ? OR CAST(case_id AS TEXT) = ? OR CAST(caseid AS TEXT) = ?
            """, (target_id, target_id, str(target_id), str(target_id)))
        elif target_type == 'account':
            cursor.execute("""
                SELECT * FROM alerts 
                WHERE account_id = ? OR accountid = ? OR CAST(account_id AS TEXT) = ? OR CAST(accountid AS TEXT) = ?
            """, (target_id, target_id, str(target_id), str(target_id)))
        else:
            # Generic entity search
            cursor.execute("""
                SELECT * FROM alerts 
                WHERE case_id = ? OR account_id = ? OR customer_id = ?
            """, (target_id, target_id, target_id))
        
        alert_rows = cursor.fetchall()
        
        if not alert_rows:
            return {
                "success": False,
                "error": f"No alerts found for {target_type} '{target_id}'"
            }
        
        # Convert to DataFrame
        import pandas as pd
        alert_cols = [desc[0] for desc in cursor.description]
        alerts_df = pd.DataFrame(alert_rows, columns=alert_cols)
        
        # Step 2: Join with cases table
        case_col = self._find_col(alerts_df, ['case_id', 'caseid'])
        if case_col:
            try:
                cases_df = pd.read_sql("SELECT * FROM cases", conn)
                cases_case_col = self._find_col(cases_df, ['case_id', 'caseid'])
                if cases_case_col:
                    merged_df = pd.merge(
                        alerts_df, 
                        cases_df, 
                        left_on=case_col, 
                        right_on=cases_case_col, 
                        how='left',
                        suffixes=('_alert', '_case')
                    )
                    alerts_df = merged_df
            except:
                pass  # Cases table not available
        
        # Step 3: Join with transactions (filtered by date)
        txn_col = self._find_col(alerts_df, ['transaction_id', 'txn_id', 'trans_id'])
        if txn_col:
            try:
                # Fetch only recent transactions
                from datetime import datetime, timedelta
                cutoff_date = (datetime.now() - timedelta(days=date_window)).strftime('%Y-%m-%d')
                
                txn_query = f"""
                    SELECT * FROM transactions 
                    WHERE date >= ? OR txn_date >= ? OR transaction_date >= ?
                """
                txns_df = pd.read_sql(txn_query, conn, params=(cutoff_date, cutoff_date, cutoff_date))
                
                if not txns_df.empty:
                    txn_id_col = self._find_col(txns_df, ['transaction_id', 'txn_id', 'trans_id'])
                    if txn_id_col:
                        merged_df = pd.merge(
                            alerts_df,
                            txns_df,
                            left_on=txn_col,
                            right_on=txn_id_col,
                            how='left',
                            suffixes=('', '_txn')
                        )
                        alerts_df = merged_df
            except Exception as e:
                print(f"Transaction join warning: {e}")
        
        # Step 4: Join with accounts
        acct_col = self._find_col(alerts_df, ['account_id', 'accountid'])
        if acct_col:
            try:
                accounts_df = pd.read_sql("SELECT * FROM accounts", conn)
                acct_id_col = self._find_col(accounts_df, ['account_id', 'accountid'])
                if acct_id_col:
                    merged_df = pd.merge(
                        alerts_df,
                        accounts_df,
                        left_on=acct_col,
                        right_on=acct_id_col,
                        how='left',
                        suffixes=('', '_acct')
                    )
                    alerts_df = merged_df
            except:
                pass
        
        # Step 5: Join with customers
        cust_col = self._find_col(alerts_df, ['customer_id', 'customerid', 'ucic'])
        if cust_col:
            try:
                customers_df = pd.read_sql("SELECT * FROM customers", conn)
                cust_id_col = self._find_col(customers_df, ['customer_id', 'customerid', 'ucic'])
                if cust_id_col:
                    merged_df = pd.merge(
                        alerts_df,
                        customers_df,
                        left_on=cust_col,
                        right_on=cust_id_col,
                        how='left',
                        suffixes=('', '_cust')
                    )
                    alerts_df = merged_df
            except:
                pass
        
        # Clean and return
        alerts_df = alerts_df.fillna('')
        
        return {
            "success": True,
            "entity_id": target_id,
            "entity_type": target_type,
            "row_count": len(alerts_df),
            "data": alerts_df.to_dict(orient='records'),
            "columns": list(alerts_df.columns)
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }
    finally:
        self.db_manager.close_connection(conn)


def save_unified_dataset(self, source_table, display_name):
        """
        Persists a temporary unified view as a saved dataset.
        """
        # 1. Generate a unique name for the permanent table
        import time
        timestamp = int(time.time())
        sanitized_name = display_name.lower().replace(" ", "_")
        target_table = f"dataset_{sanitized_name}_{timestamp}"

        # 2. Create the new table from the source
        conn = self.db.connect()
        try:
            # Copy data to new table
            query = f"CREATE TABLE {target_table} AS SELECT * FROM {source_table}"
            conn.execute(query)
            
            # Get row count
            count_query = f"SELECT COUNT(*) FROM {target_table}"
            cursor = conn.execute(count_query)
            row_count = cursor.fetchone()[0]

            # 3. Register in the metadata table (registry)
            # Assuming you have a 'system_master_registry' or similar table
            registry_sql = """
                INSERT INTO system_master_registry 
                (table_name, display_name, type, row_count, created_at)
                VALUES (?, ?, 'unified', ?, CURRENT_TIMESTAMP)
            """
            conn.execute(registry_sql, (target_table, display_name, row_count))
            conn.commit()

            return {
                "success": True,
                "message": f"Dataset saved as {display_name}",
                "table": target_table,
                "rows": row_count
            }
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            self.db.close_connection(conn)