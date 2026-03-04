from flask import Blueprint, request, jsonify
from api.services import services
from services.schema_inspector import SchemaInspector
import pandas as pd

discovery_bp = Blueprint('discovery', __name__)

# --- CONSTANTS FOR FILTERING ---
HIDDEN_TABLES = ['audit', 'sqlite', 'alembic', 'migration', 'revision']
HIDDEN_COLUMNS = ['password', 'hash', 'salt', 'meta_', 'created_at', 'updated_at', 'token']

def _get_env_db():
    env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
    tenant_id = getattr(request, 'tenant_id', None)
    if not env_id:
        return None, None
    try:
        db = services.get_investigation_db(env_id, tenant_id)
        return env_id, db
    except Exception:
        return env_id, None


def _get_inspector():
    _env_id, db = _get_env_db()
    if not db:
        return None
    return SchemaInspector(db)


def _visible_tables(db_manager, raw_tables):
    raw_tables = [t for t in (raw_tables or []) if t and isinstance(t, str)]
    base_uploaded = {"alerts", "transactions", "accounts", "customers", "cases", "sanctions"}
    system_prefixes = ("sqlite_",)
    system_exact = {
        "audit_log",
        "upload_history",
        "system_master_registry",
        "baseline_profiles",
        "deviation_history",
        "focus_runs",
        "focus_results",
        "investigation_risk_index",
        "active_case_scope",
    }

    keep = set()

    conn = db_manager.connect()
    try:
        cur = conn.cursor()
        if "upload_history" in raw_tables:
            try:
                cur.execute("SELECT DISTINCT table_name FROM upload_history WHERE table_name IS NOT NULL")
                for (t,) in cur.fetchall():
                    if t:
                        keep.add(str(t))
            except Exception:
                pass
    finally:
        db_manager.close_connection(conn)

    if not keep:
        keep |= (base_uploaded & set(raw_tables))

    for t in raw_tables:
        tl = t.lower()
        if t in system_exact:
            continue
        if any(tl.startswith(p) for p in system_prefixes):
            continue
        if tl == "master_cleaned_data" or tl.startswith("master_"):
            keep.add(t)

    unified_candidates = [t for t in raw_tables if "unified" in t.lower() and t not in system_exact]
    if unified_candidates:
        keep.add(sorted(unified_candidates)[-1])

    keep |= (base_uploaded & set(raw_tables))
    filtered = [t for t in raw_tables if t in keep and t not in system_exact and not any(t.lower().startswith(p) for p in system_prefixes)]
    return sorted(set(filtered))

def format_label(name):
    return name.replace('_', ' ').title()

# --- 1. TABLE LISTING (CLEANED) ---
@discovery_bp.route('/tables', methods=['GET'])
def get_tables():
    env_id, db = _get_env_db()
    if not db:
        return jsonify({'error': 'DB not ready', 'env_id': env_id}), 503
    inspector = SchemaInspector(db)
    raw_tables = inspector.get_tables()
    clean_tables = _visible_tables(db, raw_tables)
    
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

    inspector = _get_inspector()
    if not inspector:
        return jsonify([]), 503

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
            
        inspector = _get_inspector()
        if not inspector:
            return jsonify({'success': False, 'error': 'DB not ready'}), 503
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
    req = request.json or {}
    tables = [str(t).strip() for t in (req.get('tables') or []) if str(t).strip()]
    x_axis = req.get('x_axis')
    y_axis = req.get('y_axis')
    group_by = req.get('group_by')
    agg = str(req.get('aggregation') or 'count').lower()

    if not tables or not x_axis:
        return jsonify({'success': False, 'error': 'Invalid config'}), 400

    env_id, db = _get_env_db()
    if not db:
        return jsonify({'success': False, 'error': 'DB not ready', 'env_id': env_id}), 503

    conn = db.connect()
    try:
        agg_map = {
            'count': 'COUNT',
            'sum': 'SUM',
            'avg': 'AVG',
            'min': 'MIN',
            'max': 'MAX',
        }
        agg_sql = agg_map.get(agg, 'COUNT')

        def qid(identifier: str) -> str:
            return '"' + str(identifier).replace('"', '""') + '"'

        def parse_col(full_name, default_table):
            raw = str(full_name or '').strip()
            if '.' in raw:
                t, c = raw.split('.', 1)
                return t.strip(), c.strip()
            return default_table, raw

        # Load column metadata for join/validation.
        table_cols = {}
        for tbl in tables:
            rows = conn.execute(f'PRAGMA table_info({qid(tbl)})').fetchall()
            cols = [r[1] for r in rows]
            if not cols:
                return jsonify({'success': False, 'error': f"Table '{tbl}' not found or has no columns"}), 400
            table_cols[tbl] = cols

        def resolve_ref(full_name, default_table):
            tbl, col = parse_col(full_name, default_table)
            if tbl not in table_cols:
                raise ValueError(f"Table '{tbl}' is not in selected tables")
            if col not in table_cols[tbl]:
                raise ValueError(f"Column '{tbl}.{col}' does not exist")
            return tbl, col

        x_tbl, x_col = resolve_ref(x_axis, tables[0])

        alias_by_table = {tables[0]: 't0'}
        join_clauses = []
        join_plan = []

        preferred_keys = [
            'transaction_id',
            'account_id',
            'customer_id',
            'alert_id',
            'case_id',
            'id',
        ]

        # Build resilient joins for multi-table queries.
        for i, target_tbl in enumerate(tables[1:], start=1):
            target_alias = f't{i}'
            target_cols = set(table_cols[target_tbl])
            found = None

            for pref in preferred_keys:
                if pref not in target_cols:
                    continue
                for left_tbl, left_alias in alias_by_table.items():
                    if pref in table_cols[left_tbl]:
                        found = (left_tbl, left_alias, pref, pref)
                        break
                if found:
                    break

            if not found:
                for left_tbl, left_alias in alias_by_table.items():
                    commons = [c for c in table_cols[left_tbl] if c in target_cols]
                    if not commons:
                        continue
                    id_like = [c for c in commons if c.lower().endswith('_id') or c.lower() == 'id']
                    picked = id_like[0] if id_like else commons[0]
                    found = (left_tbl, left_alias, picked, picked)
                    break

            if not found:
                return jsonify({
                    'success': False,
                    'error': f"No safe join key found for table '{target_tbl}'",
                }), 400

            left_tbl, left_alias, left_key, right_key = found
            join_clauses.append(
                f'LEFT JOIN {qid(target_tbl)} {target_alias} ON {left_alias}.{qid(left_key)} = {target_alias}.{qid(right_key)}'
            )
            alias_by_table[target_tbl] = target_alias
            join_plan.append({
                'left_table': left_tbl,
                'left_key': left_key,
                'right_table': target_tbl,
                'right_key': right_key,
                'type': 'LEFT',
            })

        x_expr = f'{alias_by_table[x_tbl]}.{qid(x_col)}'

        select_parts = [f'{x_expr} AS name']
        group_parts = [x_expr]

        if y_axis:
            y_tbl, y_col = resolve_ref(y_axis, tables[0])
            y_expr = f'{alias_by_table[y_tbl]}.{qid(y_col)}'
            if agg_sql == 'COUNT':
                metric_expr = f'COUNT({y_expr})'
            elif agg_sql in {'SUM', 'AVG'}:
                metric_expr = f'{agg_sql}(TRY_CAST({y_expr} AS DOUBLE))'
            else:
                metric_expr = f'{agg_sql}({y_expr})'
            select_parts.append(f'{metric_expr} AS value')
        else:
            select_parts.append('COUNT(*) AS value')

        if group_by:
            g_tbl, g_col = resolve_ref(group_by, tables[0])
            g_expr = f'{alias_by_table[g_tbl]}.{qid(g_col)}'
            select_parts.append(f'{g_expr} AS group_key')
            group_parts.append(g_expr)

        main_from = f'FROM {qid(tables[0])} {alias_by_table[tables[0]]}'
        joins_sql = ' '.join(join_clauses)
        group_sql = ', '.join(group_parts)

        query = f"""
            SELECT {", ".join(select_parts)}
            {main_from}
            {joins_sql}
            WHERE {x_expr} IS NOT NULL
            GROUP BY {group_sql}
            ORDER BY {x_expr}
            LIMIT 500
        """

        df = pd.read_sql_query(query, conn)
        return jsonify({
            'success': True,
            'data': df.to_dict(orient='records'),
            'join_plan': join_plan,
        })
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        db.close_connection(conn)
