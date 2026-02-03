import json
import requests
import traceback
import sqlite3

class AIMasterBuilder:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.ollama_url = "http://localhost:11434/api/generate"

    def get_schema_summary(self):
        """
        Fetches table names and columns to send to the LLM.
        """
        conn = self.db_manager.connect()
        schema = {}
        try:
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'master_view'")
            tables = [r[0] for r in cur.fetchall()]
            
            for t in tables:
                cur.execute(f"PRAGMA table_info({t})")
                cols = [r['name'] for r in cur.fetchall()]
                schema[t] = cols
            return schema
        finally:
            self.db_manager.close_connection(conn)

    def generate_strategy(self, model="tinyllama"):
        """
        Asks the LLM to plan the join strategy.
        """
        schema = self.get_schema_summary()
        
        prompt = f"""
        You are an expert SQL Data Architect. 
        I have these database tables and columns:
        {json.dumps(schema, indent=2)}

        YOUR GOAL: 
        Create a strategy to join these tables into a single 'Master View' for AML analysis.
        
        RULES:
        1. Identify the BASE table (usually 'transactions' or 'alerts' as they are most granular).
        2. Join other tables ('accounts', 'customers', 'cases') to enrich the base table.
        3. Pick the BEST join keys (e.g., join 'accounts' on 'account_id', 'customers' on 'customer_id' or 'ucic').
        4. AVOID ROW EXPLOSION. Do not join granular tables to granular tables (e.g. don't join Alerts to Transactions on Customer_ID, use Transaction_ID if possible).
        
        OUTPUT FORMAT:
        Return ONLY a valid JSON object. No text. Format:
        {{
            "reasoning": "Explanation of why you chose this path...",
            "chain": [
                {{ "table": "BASE_TABLE_NAME" }},
                {{ "table": "TABLE_2", "join_type": "LEFT JOIN", "left_on": "col_from_prev", "right_on": "col_from_this" }}
            ]
        }}
        """

        try:
            print(f"🧠 Asking AI ({model}) for Master Data Strategy...")
            response = requests.post(self.ollama_url, json={
                "model": model,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "options": {"temperature": 0.1} # Low temp for consistent JSON
            })
            
            result = response.json()
            strategy = json.loads(result['response'])
            return strategy

        except Exception as e:
            print(f"❌ AI Strategy Generation Failed: {e}")
            return self._fallback_strategy(schema)

    def _fallback_strategy(self, schema):
        """
        A hardcoded smart strategy in case the LLM is offline or hallucinates.
        """
        chain = []
        # 1. Try to find transactions or alerts
        if 'transactions' in schema:
            base = "transactions"
        elif 'alerts' in schema:
            base = "alerts"
        else:
            base = list(schema.keys())[0]
        
        chain.append({"table": base})
            
        # 2. Join Accounts
        if 'accounts' in schema and base != 'accounts':
            chain.append({
                "table": "accounts", 
                "join_type": "LEFT JOIN", 
                "left_on": "account_id", 
                "right_on": "account_id"
            })
            
        # 3. Join Customers
        if 'customers' in schema and base != 'customers':
            prev_key = "customer_id" if 'accounts' in schema or base == 'transactions' else "ucic"
            chain.append({
                "table": "customers", 
                "join_type": "LEFT JOIN", 
                "left_on": prev_key, 
                "right_on": "customer_id"
            })
            
        return {
            "reasoning": "Fallback Logic (AI failed): Transactions -> Accounts -> Customers hierarchy.",
            "chain": chain
        }

    def execute_strategy(self, chain):
        """
        Builds the SQL, Creates the Table, and returns Preview.
        FIXED: Normalizes table names to handle AI casing errors.
        """
        conn = self.db_manager.connect()
        try:
            cur = conn.cursor()
            
            # --- STEP 0: NORMALIZE TABLE NAMES ---
            # Get actual DB table names map: {'transactions': 'transactions', 'TRANSACTIONS': 'transactions'}
            cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
            db_tables = {t.lower(): t for t in [r[0] for r in cur.fetchall()]}

            # Fix the chain with correct casing
            valid_chain = []
            for step in chain:
                ai_name = step['table'].strip()
                real_name = db_tables.get(ai_name.lower())
                
                if real_name:
                    step['table'] = real_name # Update step with correct name
                    valid_chain.append(step)
                else:
                    print(f"⚠️ Warning: AI suggested table '{ai_name}' which does not exist in DB. Skipping.")

            if not valid_chain:
                return {"success": False, "error": "No valid tables found in strategy."}

            # --- STEP 1: BUILD SELECT CLAUSE ---
            select_parts = []
            seen_cols = set()

            for step in valid_chain:
                table = step['table']
                cur.execute(f"PRAGMA table_info({table})")
                cols = [r['name'] for r in cur.fetchall()]
                
                for col in cols:
                    if col.lower() in ['id', 'created_at']: continue
                    
                    # Alias: "transactions.amount AS transactions_amount"
                    # Clean alias to be SQL safe
                    alias = f"{table}_{col}"
                    if alias not in seen_cols:
                        select_parts.append(f"{table}.{col} AS {alias}")
                        seen_cols.add(alias)
            
            if not select_parts:
                # Fallback if something went wrong with column detection
                select_sql = "*" 
            else:
                select_sql = ", ".join(select_parts)
            
            # --- STEP 2: BUILD JOIN LOGIC ---
            base_step = valid_chain[0]
            query = f"SELECT {select_sql} FROM {base_step['table']} "
            
            for i in range(1, len(valid_chain)):
                step = valid_chain[i]
                prev_step = valid_chain[i-1] # Simplified: join to immediate predecessor
                
                # Ensure join keys exist (basic safety)
                # If AI hallucinates keys, SQLite will throw error, which we catch below
                query += f"{step.get('join_type', 'LEFT JOIN')} {step['table']} "
                query += f"ON {prev_step['table']}.{step['left_on']} = {step['table']}.{step['right_on']} "
            
            print(f"🏗️ Executing SQL: {query}")

            # --- STEP 3: CREATE MASTER VIEW ---
            cur.execute("DROP TABLE IF EXISTS master_view")
            create_sql = f"CREATE TABLE master_view AS {query}"
            
            cur.execute(create_sql)
            conn.commit()
            
            # --- STEP 4: GET STATS ---
            cur.execute("SELECT COUNT(*) FROM master_view")
            count = cur.fetchone()[0]
            
            # Get preview (as dicts)
            preview_data = self.db_manager.run_query("SELECT * FROM master_view LIMIT 5")
            
            return {
                "success": True,
                "row_count": count,
                "preview": preview_data
            }
            
        except Exception as e:
            traceback.print_exc()
            return {"success": False, "error": f"SQL Error: {str(e)}"}
        finally:
            self.db_manager.close_connection(conn)