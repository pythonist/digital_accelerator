from flask import Blueprint, request, jsonify
from api.services import services
from services.schema_inspector import SchemaInspector
import pandas as pd

discovery_bp = Blueprint('discovery', __name__)
inspector = None

# --- CONSTANTS FOR FILTERING ---
HIDDEN_TABLES = ['audit', 'sqlite', 'alembic', 'migration', 'revision']
HIDDEN_COLUMNS = ['password', 'hash', 'salt', 'meta_', 'created_at', 'updated_at', 'token']

@discovery_bp.before_request
def init_inspector():
    global inspector
    if not inspector and services.investigation_db:
        inspector = SchemaInspector(services.investigation_db)

def format_label(name):
    return name.replace('_', ' ').title()

# --- 1. TABLE LISTING (CLEANED) ---
@discovery_bp.route('/tables', methods=['GET'])
def get_tables():
    if not inspector: return jsonify({'error': 'DB not ready'}), 503
    raw_tables = inspector.get_tables()
    
    # Filter out system tables
    clean_tables = [t for t in raw_tables if not any(h in t.lower() for h in HIDDEN_TABLES)]
    
    return jsonify({
        'tables': [{'value': t, 'label': format_label(t)} for t in clean_tables]
    })

# --- 2. SCHEMA (SMART & MERGED) ---
@discovery_bp.route('/schema/multi', methods=['POST'])
def get_schema():
    """
    Returns schema for one OR multiple tables.
    """
    req = request.json
    tables = req.get('tables', [])
    if not tables: return jsonify([])

    combined_schema = []
    
    for table in tables:
        raw_schema = inspector.get_table_schema(table)
        for col in raw_schema:
            # Filter nonsense columns
            if any(x in col['name'].lower() for x in HIDDEN_COLUMNS): continue
            
            # Add UI Hints
            col['original_name'] = col['name']
            col['table'] = table
            
            # If multiple tables, prefix the name to avoid collision
            if len(tables) > 1:
                col['name'] = f"{table}.{col['name']}"
                col['label'] = f"{format_label(col['original_name'])} ({format_label(table)})"
            else:
                col['label'] = format_label(col['name'])

            combined_schema.append(col)
            
    return jsonify(combined_schema)

# --- 3. UNIVARIATE PROFILER (RESTORED) ---
@discovery_bp.route('/profile', methods=['POST'])
def profile_column():
    """
    Existing single-column analysis.
    """
    req = request.json
    try:
        # Handle cases where column might be "table.col" (strip table)
        col_name = req['column']
        if '.' in col_name and req.get('is_multi', False):
            col_name = col_name.split('.')[1]
            
        data = inspector.profile_column(req['table'], col_name)
        return jsonify({'success': True, **data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# --- 4. MULTIVARIATE QUERY ENGINE (ENHANCED) ---
@discovery_bp.route('/query/multi', methods=['POST'])
def query_multi_table():
    """
    Handles:
    1. Single Table Group By (Aggregation)
    2. Multi-Table Auto-Join
    """
    req = request.json
    tables = req.get('tables', [])
    x_axis = req.get('x_axis') 
    y_axis = req.get('y_axis') 
    group_by = req.get('group_by') # RESTORED GROUP BY
    agg = req.get('aggregation', 'count')
    
    if not tables or not x_axis:
        return jsonify({'success': False, 'error': 'Invalid config'})

    conn = services.investigation_db.connect()
    try:
        query = ""
        
        # --- PARSE COLUMNS ---
        # Helper to strip "table." prefix if present
        def parse_col(full_name, default_table):
            if '.' in full_name: return full_name.split('.', 1)
            return default_table, full_name

        x_tbl, x_col = parse_col(x_axis, tables[0])
        
        # --- BUILD QUERY ---
        
        # SCENARIO A: SINGLE TABLE (Advanced Aggregation)
        if len(tables) == 1:
            tbl = tables[0]
            
            # Select Clause
            selects = [f'"{x_col}" as name']
            
            # Y-Axis (Metric)
            if y_axis:
                _, y_col = parse_col(y_axis, tbl)
                agg_func = "AVG" if agg == 'avg' else "SUM" if agg == 'sum' else "MAX"
                selects.append(f'{agg_func}("{y_col}") as value')
            else:
                selects.append('COUNT(*) as value')
                
            # Group By Clause (e.g. Stacked Bar Chart logic)
            group_clause = "GROUP BY 1"
            if group_by:
                _, g_col = parse_col(group_by, tbl)
                selects.append(f'"{g_col}" as group_key')
                group_clause += ", 3" # Group by X (1) and GroupKey (3)

            query = f'SELECT {", ".join(selects)} FROM "{tbl}" {group_clause} ORDER BY 1 LIMIT 500'

        # SCENARIO B: MULTI TABLE (Join Strategy)
        else:
            main_tbl = tables[0]
            joins = ""
            
            # Simple heuristic join: T1.customer_id = T2.customer_id
            for i in range(1, len(tables)):
                target_tbl = tables[i]
                # In production, use real Foreign Keys. Here we guess based on 'id'.
                join_col = 'customer_id' # Default guess
                # (You would add logic here to find the actual intersection column)
                joins += f' INNER JOIN "{target_tbl}" ON "{main_tbl}"."{join_col}" = "{target_tbl}"."{join_col}"'

            # Build Select for Multi-Table
            selects = [f'"{x_tbl}"."{x_col}" as name']
            
            if y_axis:
                y_tbl, y_col = parse_col(y_axis, main_tbl)
                agg_func = "AVG" if agg == 'avg' else "SUM" if agg == 'sum' else "MAX"
                selects.append(f'{agg_func}("{y_tbl}"."{y_col}") as value')
            else:
                selects.append('COUNT(*) as value')

            # Multi-table Group By (if requested)
            group_clause = "GROUP BY 1"
            if group_by:
                g_tbl, g_col = parse_col(group_by, main_tbl)
                selects.append(f'"{g_tbl}"."{g_col}" as group_key')
                group_clause += ", 3"

            query = f'SELECT {", ".join(selects)} FROM "{main_tbl}" {joins} {group_clause} LIMIT 500'

        # EXECUTE
        df = pd.read_sql_query(query, conn)
        return jsonify({'success': True, 'data': df.to_dict(orient='records')})

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        services.investigation_db.close_connection(conn)