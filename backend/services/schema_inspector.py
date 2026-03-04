import pandas as pd
import sqlite3
import re
import traceback
import numpy as np
from services.db_schema import DatabaseManager

class SchemaInspector:
    def __init__(self, db_manager):
        self.db_manager = db_manager

    def get_tables(self):
        conn = self.db_manager.connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            tables = [r[0] for r in cursor.fetchall()]
            print(f"DEBUG: Found tables: {tables}")
            return tables
        finally:
            self.db_manager.close_connection(conn)

    def get_table_schema(self, table_name):
        print(f"DEBUG: Fetching schema for '{table_name}'")
        conn = self.db_manager.connect()
        try:
            cursor = conn.cursor()
            cursor.execute(f'PRAGMA table_info("{table_name}")')
            columns_info = cursor.fetchall()
            
            if not columns_info:
                print(f"DEBUG: WARNING - No columns found for '{table_name}'. Check table name quoting.")

            # Sample for inference
            try:
                sample_df = pd.read_sql(f'SELECT * FROM "{table_name}" LIMIT 50', conn)
            except Exception as e:
                print(f"DEBUG: Could not fetch sample for inference: {e}")
                sample_df = pd.DataFrame()

            schema = []
            for col in columns_info:
                name = col[1]
                u_name = name.upper()
                dtype = col[2].upper()
                
                # Default
                ui_hint = 'text'
                if dtype in ['INTEGER', 'REAL', 'NUMERIC', 'FLOAT', 'DOUBLE']: ui_hint = 'numeric'
                
                # Heuristics
                if name.lower() == 'id' or name.lower().endswith('_id') or u_name.endswith('ID'): ui_hint = 'id'
                elif any(x in u_name for x in ['DATE', 'TIME', 'CREATED', 'UPDATED']): ui_hint = 'date'
                elif any(x in u_name for x in ['AMT', 'AMOUNT', 'PRICE', 'COST', 'SALES']): ui_hint = 'currency'
                elif any(x in u_name for x in ['STATUS', 'TYPE', 'CATEGORY', 'REGION']): ui_hint = 'category'
                
                # Data-driven inference
                if not sample_df.empty and name in sample_df.columns:
                    s = sample_df[name]
                    if ui_hint == 'text' and s.nunique() < 15: ui_hint = 'category'
                    if ui_hint == 'text':
                        try:
                            pd.to_datetime(s.dropna().iloc[:5])
                            ui_hint = 'date'
                        except: pass

                schema.append({"name": name, "ui_hint": ui_hint})
            
            # print(f"DEBUG: Schema determined: {schema}") # Uncomment for verbose schema logs
            return schema
        finally:
            self.db_manager.close_connection(conn)

    # --- MODE 1: SINGLE COLUMN PROFILER ---
    def profile_column(self, table, col):
        print(f"\n--- DEBUG: Profiling '{table}'.'{col}' ---")
        conn = self.db_manager.connect()
        try:
            # 1. Get Hint
            schema = self.get_table_schema(table)
            col_def = next((c for c in schema if c['name'] == col), None)
            ui_hint = col_def['ui_hint'] if col_def else 'text'
            print(f"DEBUG: UI Hint -> {ui_hint}")

            # 2. Fetch Data
            query = f'SELECT "{col}" as val FROM "{table}" LIMIT 10000'
            print(f"DEBUG: SQL Query -> {query}")
            
            df = pd.read_sql(query, conn)
            print(f"DEBUG: Rows Fetched -> {len(df)}")
            
            if df.empty:
                print("DEBUG: Dataframe is empty.")
                return {"stats": {"total": 0}, "chart_data": []}

            # 3. Calculate Stats
            total = len(df)
            nulls = df['val'].isnull().sum()
            unique = df['val'].nunique()
            print(f"DEBUG: Stats -> Total: {total}, Nulls: {nulls}, Unique: {unique}")
            
            stats = {
                "total": int(total),
                "nulls": int(nulls),
                "unique": int(unique),
                "density": round((unique/total)*100, 1) if total > 0 else 0,
                "ui_hint": ui_hint
            }
            
            chart_data = []

            # 4. Generate Chart Data
            
            # Case A: Numeric
            if ui_hint in ['numeric', 'currency']:
                print("DEBUG: Processing as Numeric...")
                s = pd.to_numeric(df['val'], errors='coerce').dropna()
                print(f"DEBUG: Valid Numeric Rows: {len(s)}")
                
                if not s.empty:
                    stats.update({"min": float(s.min()), "max": float(s.max()), "avg": float(s.mean()), "sum": float(s.sum())})
                    
                    if s.nunique() <= 1:
                        print("DEBUG: Single unique value found.")
                        chart_data = [{"name": str(s.iloc[0]), "value": len(s)}]
                    else:
                        try:
                            counts, bin_edges = np.histogram(s, bins=10)
                            for i in range(len(counts)):
                                start, end = bin_edges[i], bin_edges[i+1]
                                label = f"{int(start)}-{int(end)}" if start > 10 else f"{start:.1f}-{end:.1f}"
                                chart_data.append({"name": label, "value": int(counts[i])})
                            print(f"DEBUG: Generated {len(chart_data)} histogram bins.")
                        except Exception as e:
                            print(f"DEBUG: Histogram Error: {e}")

            # Case B: Date
            elif ui_hint == 'date':
                print("DEBUG: Processing as Date...")
                s = pd.to_datetime(df['val'], errors='coerce').dropna()
                print(f"DEBUG: Valid Date Rows: {len(s)}")
                
                if not s.empty:
                    stats['min'] = s.min().isoformat()
                    stats['max'] = s.max().isoformat()
                    s.index = s
                    try:
                        trend = s.resample('M').count()
                        if len(trend) < 2: trend = s.resample('D').count()
                        chart_data = [{"name": str(d.date()), "value": int(v)} for d, v in trend.items()]
                        print(f"DEBUG: Generated {len(chart_data)} time points.")
                    except Exception as e:
                         print(f"DEBUG: Date Resample Error: {e}")

            # Case C: Fallback / Category
            if not chart_data:
                 print("DEBUG: Fallback to Top 10 Categories...")
                 s = df['val'].fillna('NULL').astype(str)
                 counts = s.value_counts().head(10).to_dict()
                 chart_data = [{"name": str(k), "value": int(v)} for k,v in counts.items()]
                 print(f"DEBUG: Generated {len(chart_data)} categories.")

            return {"stats": stats, "chart_data": chart_data}

        except Exception as e:
            print(f"DEBUG: CRITICAL ERROR IN PROFILE: {e}")
            traceback.print_exc()
            return {"error": str(e)}
        finally:
            self.db_manager.close_connection(conn)

    def run_dynamic_query(self, table, x_col, y_col, aggregation='count', group_col=None):
        """
        The Engine for Bivariate/Trivariate Analysis.
        
        Args:
            x_col: The dimension (Date, Category, etc.)
            y_col: The metric (Amount, Score)
            aggregation: sum, avg, count, min, max
            group_col: Optional 3rd dimension for stacking/coloring
        """
        conn = self.db_manager.connect()
        try:
            # 1. Sanitize Inputs (Prevent Injection)
            valid_cols = [c['name'] for c in self.get_table_schema(table)]
            if x_col not in valid_cols: raise ValueError(f"Invalid X Column: {x_col}")
            if y_col and y_col not in valid_cols and y_col != 'row_count': raise ValueError(f"Invalid Y Column: {y_col}")
            if group_col and group_col not in valid_cols: raise ValueError("Invalid Group Column")

            # 2. Build Query Parts
            select_clause = f'"{x_col}"'
            group_by_clause = f'"{x_col}"'
            
            # Handling Date Truncation (SQLite syntax)
            # If X is a date, we default to grouping by Month for cleaner charts
            schema = self.get_table_schema(table)
            x_type = next((c['ui_hint'] for c in schema if c['name'] == x_col), 'text')
            
            if x_type == 'date':
                # SQLite specific: strftime('%Y-%m', date_col)
                select_clause = f"strftime('%Y-%m', \"{x_col}\") as time_bucket"
                group_by_clause = "time_bucket"

            # Y-Axis Logic
            agg_func = aggregation.upper() # SUM, AVG, COUNT
            if y_col == 'row_count' or not y_col:
                metric_exp = "COUNT(*)"
            else:
                metric_exp = f"{agg_func}(\"{y_col}\")"

            # 3. Construct Query
            query = f"""
                SELECT {select_clause} as x_val, {metric_exp} as y_val
                FROM {table}
                WHERE "{x_col}" IS NOT NULL
                GROUP BY {group_by_clause}
                ORDER BY {group_by_clause} ASC
                LIMIT 500
            """

            # 3b. Trivariate (Grouping) Logic
            if group_col:
                query = f"""
                    SELECT {select_clause} as x_val, "{group_col}" as group_val, {metric_exp} as y_val
                    FROM {table}
                    WHERE "{x_col}" IS NOT NULL AND "{group_col}" IS NOT NULL
                    GROUP BY {group_by_clause}, "{group_col}"
                    ORDER BY {group_by_clause} ASC
                    LIMIT 1000
                """

            # 4. Execute
            df = pd.read_sql(query, conn)
            
            # 5. Format for Frontend
            # If Trivariate, pivot the data: Rows=X, Cols=Group, Vals=Y
            if group_col and not df.empty:
                pivot = df.pivot(index='x_val', columns='group_val', values='y_val').fillna(0)
                # Flatten for Recharts: [{name: 'Jan', 'Category A': 10, 'Category B': 20}, ...]
                data = []
                for index, row in pivot.iterrows():
                    item = {"name": str(index)}
                    item.update(row.to_dict())
                    data.append(item)
                
                return {
                    "data": data,
                    "keys": list(pivot.columns), # Series names for Legend
                    "type": "stacked"
                }

            # Bivariate Format
            return {
                "data": df.rename(columns={"x_val": "name", "y_val": "value"}).to_dict(orient='records'),
                "keys": ["value"],
                "type": "simple"
            }

        except Exception as e:
            print(f"Query Error: {e}")
            return {"error": str(e), "data": []}
        finally:
            self.db_manager.close_connection(conn)


    def get_columns(self, table_name):
        """Get column names for a table."""
        if not table_name: return []
        
        conn = self.db_manager.connect()
        try:
            cursor = conn.cursor()
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = [r[1] for r in cursor.fetchall()]
            return columns
        except Exception as e:
            print(f"Schema Error: {e}")
            return []
        finally:
            self.db_manager.close_connection(conn)

    def profile_column(self, table_name, column_name):
        conn = self.db_manager.connect()
        try:
            # 1. Get Hint
            schema = self.get_table_schema(table_name)
            col_def = next((c for c in schema if c['name'] == column_name), None)
            # Default to text if not found
            ui_hint = col_def['ui_hint'] if col_def else 'text'

            # 2. Fetch Data (Limit 10k)
            # We force conversion to string first to avoid SQL errors on mixed types
            df = pd.read_sql(f"SELECT \"{column_name}\" as val FROM {table_name} LIMIT 10000", conn)
            
            total = len(df)
            nulls = df['val'].isnull().sum()
            unique = df['val'].nunique()
            
            stats = {
                "total": int(total),
                "nulls": int(nulls),
                "unique": int(unique),
                "density": round((unique/total)*100, 1) if total > 0 else 0,
                "ui_hint": ui_hint
            }
            
            chart_data = []

            # --- 3. TRY SMART ANALYSIS ---
            try:
                if ui_hint in ['numeric', 'currency']:
                    # Force numeric, turn errors (strings) into NaN
                    s = pd.to_numeric(df['val'], errors='coerce').dropna()
                    if not s.empty:
                        stats['min'] = float(s.min())
                        stats['max'] = float(s.max())
                        stats['avg'] = float(s.mean())
                        stats['sum'] = float(s.sum())
                        
                        # Histogram (10 bins)
                        counts, bin_edges = np.histogram(s, bins=10)
                        for i in range(len(counts)):
                            # Clean label: "10-20"
                            label = f"{float(bin_edges[i]):.2f} - {float(bin_edges[i+1]):.2f}"
                            chart_data.append({"name": label, "value": int(counts[i])})

                elif ui_hint == 'date':
                    # Force datetime
                    s = pd.to_datetime(df['val'], errors='coerce').dropna()
                    if not s.empty:
                        stats['min'] = s.min().isoformat()
                        stats['max'] = s.max().isoformat()
                        s.index = s
                        # Group by Month ('ME' or 'M' depending on pandas version)
                        try:
                            trend = s.resample('ME').count() 
                        except:
                            trend = s.resample('M').count() # Old pandas fallback

                        # Fallback to Day if only 1 month of data
                        if len(trend) < 2: 
                            trend = s.resample('D').count()
                        
                        chart_data = [{"name": str(d.date()), "value": int(v)} for d, v in trend.items() if v > 0]
            except Exception as e:
                print(f"Smart Analysis Failed: {e}")
                # If smart analysis crashes, chart_data remains []
                pass

            # --- 4. THE SAFETY NET (Fallback) ---
            # If chart_data is empty (because parsing failed OR it's just text), 
            # fall back to simple "Top 10 Values" count.
            if not chart_data:
                # Force category type so frontend renders a Bar Chart
                stats['ui_hint'] = 'category' 
                
                # Count top 10 values
                s = df['val'].astype(str) # Treat everything as string
                counts = s.value_counts().head(10).to_dict()
                chart_data = [{"name": str(k), "value": int(v)} for k, v in counts.items()]

            return {
                "success": True,
                "stats": stats,
                "chart_data": chart_data 
            }

        except Exception as e:
            print(f"Profile Critical Error: {e}")
            return {"success": False, "error": str(e)}
        finally:
            self.db_manager.close_connection(conn)


    def get_table_schema(self, table_name):
        """Returns schema with AI-Enhanced Heuristics."""
        conn = self.db_manager.connect()
        try:
            cursor = conn.cursor()
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns_info = cursor.fetchall()
            
            schema = []
            for col in columns_info:
                name = col[1]
                dtype = col[2].upper()
                u_name = name.upper()
                
                # --- DEFAULT ---
                ui_hint = 'text' 

                # --- RULE BASED DETECTION ---
                if 'ID' in u_name or col[5] == 1: 
                    ui_hint = 'id'
                elif any(x in u_name for x in ['DATE', 'TIME', 'CREATED', 'UPDATED', 'DOB', 'TIMESTAMP']): 
                    ui_hint = 'date'
                elif any(x in u_name for x in ['AMOUNT', 'AMT', 'BAL', 'DEBIT', 'CREDIT', 'PRICE', 'VAL', 'COST', 'LIMIT']): 
                    ui_hint = 'currency'
                elif dtype in ['INTEGER', 'REAL', 'NUMERIC', 'FLOAT']: 
                    ui_hint = 'numeric'
                elif any(x in u_name for x in ['TYPE', 'STATUS', 'RISK', 'CODE', 'CATEGORY', 'STATE', 'OCCUPATION', 'GENDER', 'FLAG', 'SEGMENT']): 
                    ui_hint = 'category'
                elif any(x in u_name for x in ['NAME', 'PARTY', 'BENEFICIARY', 'REMITTER', 'DESC', 'DETAILS', 'NARRATION']):
                    ui_hint = 'text_list'

                schema.append({"name": name, "sql_type": dtype, "ui_hint": ui_hint})
            return schema
        finally:
            self.db_manager.close_connection(conn)

    def get_column_stats(self, table_name, column, ui_hint):
        """Calculates deep stats including PII detection."""
        conn = self.db_manager.connect()
        try:
            # Sample 5000 rows for speed
            query = f"SELECT {column} FROM {table_name} WHERE {column} IS NOT NULL LIMIT 5000"
            df = pd.read_sql_query(query, conn)
            
            if df.empty: return {"total_rows": 0}

            total = len(df)
            unique = df[column].nunique()
            cardinality = (unique / total) * 100

            stats = {
                "total_rows": total,
                "unique_count": unique,
                "cardinality_pct": round(cardinality, 2)
            }

            # --- PII / PATTERN DETECTION (Regex) ---
            if ui_hint in ['text', 'text_list']:
                sample_str = df[column].astype(str).str
                if sample_str.contains(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$', regex=True).mean() > 0.1:
                    stats['inferred_type'] = 'Email'
                elif sample_str.contains(r'^\+?1?\d{9,15}$', regex=True).mean() > 0.1:
                    stats['inferred_type'] = 'Phone'

            # --- TYPE SPECIFIC STATS ---
            if ui_hint in ['numeric', 'currency']:
                try:
                    numeric_series = pd.to_numeric(df[column], errors='coerce')
                    desc = numeric_series.describe()
                    stats.update({
                        "min": float(desc['min']), "max": float(desc['max']), 
                        "mean": float(desc['mean']), "sum": float(numeric_series.sum())
                    })
                    # Histogram
                    stats['histogram'] = {str(k): v for k, v in numeric_series.value_counts(bins=10, sort=False).to_dict().items()}
                except: pass

            elif ui_hint in ['category', 'text_list']:
                # Distribution (Top 10)
                stats['distribution'] = df[column].value_counts().head(10).to_dict()

            elif ui_hint == 'date':
                try:
                    dates = pd.to_datetime(df[column], errors='coerce').dropna()
                    if not dates.empty:
                        stats['min_date'] = dates.min().isoformat()
                        stats['max_date'] = dates.max().isoformat()
                except: pass

            return stats
        except Exception as e:
            print(f"Stat Error ({column}): {e}")
            return {}
        finally:
            self.db_manager.close_connection(conn)

    def get_ai_context(self, table_name):
        """Gather aggregation for LLM Context."""
        conn = self.db_manager.connect()
        try:
            df = pd.read_sql_query(f"SELECT * FROM {table_name} LIMIT 1000", conn)
            context = {
                "total_rows": len(df),
                "columns": list(df.columns),
                "sample_values": {}
            }
            # Grab sample values for first 5 columns
            for col in df.columns[:5]:
                context['sample_values'][col] = df[col].dropna().unique()[:3].tolist()
            return context
        except: return {}
        finally: self.db_manager.close_connection(conn)
