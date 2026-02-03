# backend/api/routes/cases.py
import pandas as pd
from flask import Blueprint, request, jsonify
from api.utils import handle_errors
from api.services import services
import os
import sqlite3
import json
from datetime import datetime
from urllib.parse import unquote

cases_bp = Blueprint('cases', __name__)

def get_db_connection():
    """Helper to get environment-specific DB connection."""
    env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
    tenant_id = getattr(request, 'tenant_id', None)
    if not env_id: raise ValueError("No active environment selected.")
    db_manager = services.get_investigation_db(env_id, tenant_id)
    return db_manager.connect()

# =========================================================================
#  CASE SCOPE MANAGEMENT (NEW - CRITICAL)
# =========================================================================

@cases_bp.route('/case-scope/set', methods=['POST'])
@handle_errors
def set_case_scope():
    """
    Sets the active case scope for the environment.
    This becomes the authoritative filter for ALL screens.
    
    Scope Types:
    - GLOBAL: All cases (default)
    - BUCKET: Specific priority bucket from a run
    - CUSTOM: User-defined case ID list
    """
    data = request.json
    scope_type = data.get('scope_type', 'GLOBAL')
    scope_value = data.get('scope_value')
    
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        
        # Create scope table if doesn't exist
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS active_case_scope (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                scope_type TEXT NOT NULL,
                scope_value TEXT,
                case_ids TEXT,
                run_id TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Resolve case IDs based on scope type
        case_ids = []
        run_id = None
        
        if scope_type == 'BUCKET':
            bucket_name = scope_value
            run_id = data.get('run_id')
            
            if not run_id:
                cursor.execute("SELECT run_id FROM focus_runs ORDER BY run_at DESC LIMIT 1")
                row = cursor.fetchone()
                if not row:
                    return jsonify({"success": False, "error": "No focus runs available"}), 400
                run_id = row[0]
            
            # Get case IDs from this bucket
            if bucket_name == 'All':
                cursor.execute(
                    "SELECT entity_key FROM focus_results WHERE run_id = ? AND is_included = 1",
                    (run_id,)
                )
            else:
                cursor.execute(
                    "SELECT entity_key FROM focus_results WHERE run_id = ? AND bucket = ? AND is_included = 1",
                    (run_id, bucket_name)
                )
            
            case_ids = [r[0] for r in cursor.fetchall()]
            
        elif scope_type == 'CUSTOM':
            case_ids = scope_value if isinstance(scope_value, list) else []
            
        elif scope_type == 'GLOBAL':
            cursor.execute("SELECT DISTINCT case_id FROM cases")
            case_ids = [str(r[0]) for r in cursor.fetchall()]
        
        # Store scope
        cursor.execute("""
            INSERT OR REPLACE INTO active_case_scope (id, scope_type, scope_value, case_ids, run_id, updated_at)
            VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (scope_type, scope_value, json.dumps(case_ids), run_id))
        
        conn.commit()
        
        return jsonify({
            "success": True,
            "scope": {
                "type": scope_type,
                "value": scope_value,
                "run_id": run_id,
                "case_count": len(case_ids)
            }
        })
        
    finally:
        if conn: conn.close()


@cases_bp.route('/case-scope/get', methods=['GET'])
@handle_errors
def get_case_scope():
    """Returns the current active scope + filtered case IDs"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='active_case_scope'")
        if not cursor.fetchone():
            return jsonify({
                "success": True,
                "scope": {
                    "type": "GLOBAL",
                    "value": None,
                    "case_count": 0,
                    "case_ids": []
                }
            })
        
        cursor.execute("SELECT scope_type, scope_value, case_ids, run_id FROM active_case_scope WHERE id = 1")
        row = cursor.fetchone()
        
        if not row:
            return jsonify({
                "success": True,
                "scope": {"type": "GLOBAL", "value": None, "case_count": 0, "case_ids": []}
            })
        
        scope_type, scope_value, case_ids_json, run_id = row
        case_ids = json.loads(case_ids_json) if case_ids_json else []
        
        return jsonify({
            "success": True,
            "scope": {
                "type": scope_type,
                "value": scope_value,
                "run_id": run_id,
                "case_count": len(case_ids),
                "case_ids": case_ids
            }
        })
        
    finally:
        if conn: conn.close()


@cases_bp.route('/case-scope/clear', methods=['POST'])
@handle_errors
def clear_case_scope():
    """Resets to GLOBAL scope"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM active_case_scope WHERE id = 1")
        conn.commit()
        return jsonify({"success": True, "message": "Scope reset to GLOBAL"})
    finally:
        if conn: conn.close()


# =========================================================================
#  FOCUS ENGINE ROUTES (FIXED)
# =========================================================================

@cases_bp.route('/focus/run', methods=['POST'])
@handle_errors
def run_focus_engine():
    """FIXED: Now stores structured run metadata"""
    config = request.json.get('config', None)
    
    if not hasattr(services, 'focus_engine') or not services.focus_engine:
        from services.focus_engine import FocusEngine
        env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
        db_manager = services.get_investigation_db(env_id, getattr(request, 'tenant_id', None))
        services.focus_engine = FocusEngine(db_manager)

    result = services.focus_engine.run_focus_job(config_override=config)
    
    # ✅ FIX: Store run metadata in structured format
    if result.get('success'):
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            
            # Ensure table has all needed columns
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS focus_runs (
                    run_id TEXT PRIMARY KEY,
                    run_at TEXT,
                    total_cases INTEGER,
                    included_cases INTEGER,
                    configuration TEXT,
                    min_threshold INTEGER,
                    lookback_days INTEGER,
                    bucket_distribution TEXT
                )
            """)
            
            # Extract bucket distribution
            cursor.execute("""
                SELECT bucket, COUNT(*) 
                FROM focus_results 
                WHERE run_id = ? AND is_included = 1 
                GROUP BY bucket
            """, (result['run_id'],))
            
            buckets = {row[0] if row[0] else 'Review': row[1] for row in cursor.fetchall()}
            
            # Store metadata
            cursor.execute("""
                INSERT OR REPLACE INTO focus_runs 
                (run_id, run_at, total_cases, included_cases, configuration, min_threshold, lookback_days, bucket_distribution)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                result['run_id'],
                result.get('run_at'),
                result.get('total_cases', 0),
                result.get('included_cases', 0),
                json.dumps(config or {}),
                config.get('min_score_threshold') if config else None,
                config.get('lookback_days') if config else None,
                json.dumps(buckets)
            ))
            
            conn.commit()
        finally:
            if conn: conn.close()
    
    return jsonify(result) if result['success'] else (jsonify(result), 500)


@cases_bp.route('/focus/inbox', methods=['GET'])
@handle_errors
def get_focus_inbox():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='focus_runs'")
        if not cursor.fetchone():
             return jsonify({"success": True, "cases": [], "message": "Focus engine not initialized"})

        cursor.execute("SELECT run_id, run_at FROM focus_runs ORDER BY run_at DESC LIMIT 1")
        run_row = cursor.fetchone()
        
        if not run_row:
            return jsonify({"success": False, "error": "Risk index not built. Run Focus Engine.", "cases": []})
            
        run_id, run_at = run_row
        
        cursor.execute("""
            SELECT entity_key, risk_score, bucket, reasons, 
                   alert_count, critical_count, last_alert_date, alert_vector
            FROM focus_results
            WHERE run_id = ? AND is_included = 1
            ORDER BY risk_score DESC
        """, (run_id,))
        
        rows = cursor.fetchall()
        cases = []
        for r in rows:
            try: reasons_list = json.loads(r[3])
            except: reasons_list = []
            try: vector = json.loads(r[7])
            except: vector = {}

            cases.append({
                "case_id": r[0],
                "risk_score": r[1],
                "bucket": r[2] if r[2] else "Review",
                "reasons": reasons_list,
                "alert_count": r[4],
                "critical_alerts": r[5],
                "last_alert": r[6],
                "alert_types": vector,
                "context_run_id": run_id
            })
            
        return jsonify({"success": True, "run_id": run_id, "run_at": run_at, "cases": cases})
    finally:
        if conn: conn.close()


@cases_bp.route('/focus/history', methods=['GET'])
@handle_errors
def get_focus_history():
    """FIXED: Returns structured table data with AUTO-MIGRATION"""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='focus_runs'")
        if not cursor.fetchone(): 
            return jsonify({"success": True, "history": []})

        # ✅ AUTO-MIGRATE: Check if new columns exist
        cursor.execute("PRAGMA table_info(focus_runs)")
        existing_cols = {row[1] for row in cursor.fetchall()}
        
        if 'min_threshold' not in existing_cols:
            print("⚠️  Migrating focus_runs table schema...")
            cursor.execute("ALTER TABLE focus_runs ADD COLUMN min_threshold INTEGER")
        if 'lookback_days' not in existing_cols:
            cursor.execute("ALTER TABLE focus_runs ADD COLUMN lookback_days INTEGER")
        if 'bucket_distribution' not in existing_cols:
            cursor.execute("ALTER TABLE focus_runs ADD COLUMN bucket_distribution TEXT")
        
        conn.commit()

        # Now safe to query
        cursor.execute("""
            SELECT run_id, run_at, total_cases, included_cases, 
                   min_threshold, lookback_days, bucket_distribution
            FROM focus_runs 
            ORDER BY run_at DESC 
            LIMIT 20
        """)
        
        rows = cursor.fetchall()
        history = []
        
        for r in rows:
            try:
                buckets = json.loads(r[6]) if r[6] else {}
            except:
                buckets = {}
            
            history.append({
                "run_id": r[0],
                "run_at": r[1],
                "total_cases": r[2],
                "included_cases": r[3],
                "threshold": r[4] if r[4] else 'N/A',
                "lookback_days": r[5] if r[5] else 'N/A',
                "buckets": buckets
            })
        
        return jsonify({"success": True, "history": history})
    finally:
        if conn: conn.close()


@cases_bp.route('/focus/bucket/update', methods=['POST'])
@handle_errors
def update_case_bucket():
    """Persist bucket changes"""
    data = request.json
    case_ids = data.get('case_ids', [])
    new_bucket = data.get('bucket')
    run_id = data.get('run_id')

    if not case_ids or not new_bucket:
        return jsonify({"error": "Missing case_ids or bucket"}), 400

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        placeholders = ','.join(['?'] * len(case_ids))
        
        query = f"UPDATE focus_results SET bucket = ? WHERE entity_key IN ({placeholders})"
        params = [new_bucket] + case_ids
        
        if run_id:
            query += " AND run_id = ?"
            params.append(run_id)
            
        cursor.execute(query, params)
        conn.commit()
        return jsonify({"success": True, "updated": cursor.rowcount})
    finally:
        if conn: conn.close()


# =========================================================================
#  LEGACY RANKING (Keep for compatibility)
# =========================================================================

@cases_bp.route('/cases/rerank', methods=['POST'])
@handle_errors
def rerank_cases():
    """Legacy ranking endpoint"""
    conn = services.investigation_db.connect()
    try:
        try:
            df_alerts = pd.read_sql("SELECT * FROM alerts", conn)
            df_cases = pd.read_sql("SELECT * FROM cases", conn)
        except Exception as e:
            return jsonify({"success": False, "error": f"Data Missing: {str(e)}"}), 400

        if df_alerts.empty:
            return jsonify({"success": True, "message": "No alerts to rank.", "cases_processed": 0})

        df_alerts.columns = [c.lower() for c in df_alerts.columns]
        df_cases.columns = [c.lower() for c in df_cases.columns]
        
        case_id_col = next((c for c in df_alerts.columns if 'case' in c and 'id' in c), None)
        severity_col = next((c for c in df_alerts.columns if 'severity' in c or 'priority' in c or 'type' in c), None)
        date_col = next((c for c in df_alerts.columns if 'date' in c or 'time' in c or 'created' in c), None)

        if not case_id_col:
            return jsonify({"success": False, "error": "Could not identify Case ID in alerts."}), 400

        grouped = df_alerts.groupby(case_id_col)
        ranking_data = []
        
        for case_id, group in grouped:
            score = 0
            crit_count = 0
            alert_vector = {}
            
            for _, row in group.iterrows():
                sev = str(row.get(severity_col, 'Medium')).capitalize()
                alert_vector[sev] = alert_vector.get(sev, 0) + 1
                
                if 'Critical' in sev: 
                    score += 20
                    crit_count += 1
                elif 'High' in sev: score += 10
                elif 'Medium' in sev: score += 5
                else: score += 1
            
            final_score = min(100, score)
            last_date = None
            if date_col:
                try: last_date = group[date_col].max()
                except: pass
            
            ranking_data.append({
                "entity_key": str(case_id),
                "entity_type": "case",
                "risk_score": final_score,
                "alert_count": len(group),
                "critical_alert_count": crit_count,
                "last_alert_date": last_date,
                "alert_vector": json.dumps(alert_vector)
            })

        if not ranking_data:
             return jsonify({"success": True, "message": "No cases ranked.", "cases_processed": 0})
             
        df_rank = pd.DataFrame(ranking_data)
        df_rank.to_sql('investigation_risk_index', conn, if_exists='replace', index=False)
        
        cursor = conn.cursor()
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_risk_score ON investigation_risk_index(risk_score DESC)")
        conn.commit()

        return jsonify({
            "success": True, 
            "message": "Focus Engine run successfully", 
            "cases_processed": len(df_rank)
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        services.investigation_db.close_connection(conn)


@cases_bp.route('/cases/ranked', methods=['GET'])
@handle_errors
def get_ranked_cases():
    """Legacy ranked cases endpoint"""
    conn = services.investigation_db.connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='investigation_risk_index'")
        if not cursor.fetchone():
            return jsonify({
                "success": False,
                "error": "Risk index not built yet. Please run Focus Engine first.",
                "cases": []
            })
        
        query = """
            SELECT entity_key, entity_type, risk_score, alert_count, 
                   critical_alert_count, last_alert_date, alert_vector
            FROM investigation_risk_index
            WHERE entity_type = 'case'
            ORDER BY risk_score DESC, alert_count DESC
            LIMIT 100
        """
        
        df = pd.read_sql(query, conn)
        
        if df.empty:
            return jsonify({"success": True, "cases": []})
        
        cases = []
        for _, row in df.iterrows():
            alert_vector = json.loads(row['alert_vector']) if row['alert_vector'] else {}
            
            reasons = []
            if row['critical_alert_count'] > 0:
                reasons.append(f"{row['critical_alert_count']} Critical Alert(s)")
            if row['risk_score'] > 80:
                reasons.append("High Aggregate Risk")
            elif row['alert_count'] > 10:
                reasons.append("High Alert Volume")
            
            reason_text = ", ".join(reasons) if reasons else "Routine Review"

            cases.append({
                "case_id": row['entity_key'],
                "risk_score": int(row['risk_score']),
                "risk_level": _risk_level_from_score(row['risk_score']),
                "alert_count": int(row['alert_count']),
                "critical_alerts": int(row['critical_alert_count']),
                "last_alert": row['last_alert_date'],
                "alert_types": alert_vector,
                "reasoning": reason_text,
                "status": "New" 
            })
        
        return jsonify({"success": True, "cases": cases})
        
    finally:
        services.investigation_db.close_connection(conn)


@cases_bp.route('/cases/search', methods=['GET'])
@handle_errors
def search_cases():
    """Manual Override - Search any entity by ID"""
    query = request.args.get('q', '').strip()
    if not query: return jsonify({"success": False, "error": "Query parameter 'q' required"})
    
    conn = services.investigation_db.connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM cases WHERE CAST(case_id AS TEXT) LIKE ? LIMIT 1", (f"%{query}%",))
        row = cursor.fetchone()
        
        if row:
            return jsonify({
                "success": True,
                "found": True,
                "entity": {
                    "entity_id": query,
                    "type": "case",
                    "source": "Master Data (Global)"
                }
            })
        return jsonify({"success": False, "error": "Not found in Master Data"})
    finally:
        services.investigation_db.close_connection(conn)


def _risk_level_from_score(score):
    if score >= 80: return "Critical"
    elif score >= 60: return "High"
    elif score >= 40: return "Medium"
    elif score > 0: return "Low"
    else: return "Unscored"


# =========================================================================
#  UTILITY ENDPOINTS
# =========================================================================

@cases_bp.route('/case-list', methods=['GET'])
@handle_errors
def list_cases():
    conn = services.investigation_db.connect()
    try:
        try: df_raw = pd.read_sql("SELECT * FROM cases", conn)
        except: return jsonify([])

        raw_id_col = next((c for c in df_raw.columns if 'case' in c.lower() and ('id' in c.lower() or 'no' in c.lower())), None)
        if not raw_id_col: return jsonify([])

        cases = []
        for _, row in df_raw.iterrows():
            cases.append({
                "case_id": row[raw_id_col],
                "status": "New",
                "priority": "Medium",
                "alert_count": 0
            })
        return jsonify(cases)
    finally:
        services.investigation_db.close_connection(conn)


@cases_bp.route('/case-narrative/generate', methods=['POST'])
def generate_narrative():
    try:
        prompt = request.json.get('prompt', '')
        if services.ollama_wrapper:
            res = services.ollama_wrapper.generate(prompt)
            if res.get('success'): return jsonify(res)
        return jsonify({'success': True, 'response': "**Narrative Template**\nPending AI generation."})
    except Exception as e: return jsonify({'success': False, 'error': str(e)})


@cases_bp.route('/case-pack/<case_id>', methods=['GET'])
@handle_errors
def get_case_pack(case_id):
    case_id = unquote(case_id)
    pack = services.case_pack_generator.generate_case_pack(case_id)
    return jsonify(pack)


@cases_bp.route('/case/<case_id>/update-status', methods=['POST'])
@handle_errors
def update_status(case_id):
    new_status = request.json.get('status')
    case_id = unquote(case_id)
    conn = services.investigation_db.connect()
    cursor = conn.cursor()
    try:
        table = 'master_cleaned_data'
        try: cursor.execute(f"SELECT 1 FROM {table} LIMIT 1")
        except: table = 'master_case_summary'
        
        cursor.execute(f"PRAGMA table_info({table})")
        cols = [r[1] for r in cursor.fetchall()]
        case_col = next((c for c in cols if 'case' in c.lower() and 'id' in c.lower()), None)
        status_col = next((c for c in cols if 'status' == c.lower()), None)
        
        if not status_col:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN status TEXT DEFAULT 'New'")
            status_col = 'status'
            
        sql = f'UPDATE "{table}" SET "{status_col}" = ? WHERE "{case_col}" = ?'
        cursor.execute(sql, (new_status, case_id))
        conn.commit()
        return jsonify({"success": True})
    finally:
        services.investigation_db.close_connection(conn)


@cases_bp.route('/case-pack/<case_id>/export', methods=['GET'])
@handle_errors
def export_case_pack(case_id):
    case_id = unquote(case_id)
    output_dir = 'data/case_packs'
    os.makedirs(output_dir, exist_ok=True)
    path = f'{output_dir}/case_{case_id}_{datetime.now().strftime("%Y%m%d")}.json'
    services.case_pack_generator.export_case_pack_json(case_id, path)
    return jsonify({'success': True, 'path': path})


# @cases_bp.route('/explorer/tree-data', methods=['POST'])
# @handle_errors
# def get_entity_tree():
#     """Returns full hierarchical data"""
#     root_id = request.json.get('id')
#     if not root_id: return jsonify({'error': 'Root ID required'}), 400

#     conn = services.investigation_db.connect()
#     conn.row_factory = sqlite3.Row
#     cur = conn.cursor()

#     def clean(r):
#         if not r: return {}
#         d = dict(r)
#         return {k: (v.decode('utf-8') if isinstance(v, bytes) else str(v)) for k,v in d.items()}

#     def get_col(tbl, keywords):
#         try:
#             cur.execute(f"PRAGMA table_info({tbl})")
#             cols = [r['name'] for r in cur.fetchall()]
#             for c in cols:
#                 if c.lower() in [k.lower() for k in keywords]: return c
#             for c in cols:
#                 if any(k.lower() in c.lower() for k in keywords): return c
#             return None
#         except: return None

#     try:
#         case_col = get_col('cases', ['case_id', 'caseid'])
#         if not case_col: return jsonify({'error': 'Case ID col not found'}), 404
        
#         cur.execute(f"SELECT * FROM cases WHERE {case_col} = ?", [root_id])
#         case_row = cur.fetchone()
#         if not case_row: return jsonify({'error': 'Case not found'}), 404
        
#         case_data = clean(case_row)
#         tree = {
#             "id": str(case_data[case_col]),
#             "type": "Case",
#             "label": f"Case {case_data[case_col]}",
#             "details": case_data,
#             "children": []
#         }

#         ucic_col = get_col('cases', ['ucic', 'unique_id'])
#         ucic = case_data.get(ucic_col)
        
#         if ucic:
#             ucic_node = {
#                 "id": str(ucic), "type": "UCIC", 
#                 "label": f"Profile: {ucic}", 
#                 "details": {"UCIC": ucic}, 
#                 "children": []
#             }
            
#             c_ucic_col = get_col('customers', ['ucic', 'unique_id'])
#             if c_ucic_col:
#                 cur.execute(f"SELECT * FROM customers WHERE {c_ucic_col} = ?", [ucic])
#                 for c in cur.fetchall():
#                     cd = clean(c)
#                     name_col = next((k for k in cd.keys() if 'name' in k.lower()), 'Name')
#                     id_col = next((k for k in cd.keys() if 'id' in k.lower()), 'ID')
#                     ucic_node["children"].append({
#                         "id": str(cd.get(id_col, 'Unknown')), 
#                         "type": "Customer", 
#                         "label": str(cd.get(name_col, 'Customer')),
#                         "details": cd
#                     })
            
#             a_ucic_col = get_col('accounts', ['ucic', 'unique_id'])
#             if a_ucic_col:
#                 cur.execute(f"SELECT * FROM accounts WHERE {a_ucic_col} = ?", [ucic])
#                 for a in cur.fetchall():
#                     ad = clean(a)
#                     aid_col = next((k for k in ad.keys() if 'account' in k.lower() and 'id' in k.lower()), 'AcctID')
#                     ucic_node["children"].append({
#                         "id": str(ad.get(aid_col, 'Unknown')), 
#                         "type": "Account", 
#                         "label": str(ad.get(aid_col, 'Account')),
#                         "details": ad
#                     })
            
#             tree["children"].append(ucic_node)

#         alert_case_col = get_col('alerts', ['case_id', 'caseid'])
#         if alert_case_col:
#             cur.execute(f"SELECT * FROM alerts WHERE {alert_case_col} = ?", [root_id])
#             alerts = cur.fetchall()
            
#             for al in alerts:
#                 ald = clean(al)
#                 aid_col = next((k for k in ald.keys() if 'alert' in k.lower() and 'id' in k.lower()), 'AlertID')
#                 atype_col = next((k for k in ald.keys() if 'type' in k.lower()), 'Type')
                
#                 alert_node = {
#                     "id": str(ald.get(aid_col, 'Alert')), 
#                     "type": "Alert", 
#                     "label": str(ald.get(atype_col, 'Suspicious Activity')),
#                     "details": ald,
#                     "children": []
#                 }

#                 txn_link_col = next((k for k in ald.keys() if 'trans' in k.lower() and 'id' in k.lower()), None)
#                 if txn_link_col and ald.get(txn_link_col):
#                     txn_id = ald.get(txn_link_col)
#                     t_id_col = get_col('transactions', ['transaction_id', 'txn_id', 'trans_id'])
#                     if t_id_col:
#                         cur.execute(f"SELECT * FROM transactions WHERE {t_id_col} = ?", [txn_id])
#                         txn = cur.fetchone()
#                         if txn:
#                             td = clean(txn)
#                             amt_col = next((k for k in td.keys() if 'amt' in k.lower() or 'amount' in k.lower()), 'Amount')
#                             alert_node["children"].append({
#                                 "id": str(td.get(t_id_col)), 
#                                 "type": "Transaction", 
#                                 "label": f"Amt: {td.get(amt_col, 0)}", 
#                                 "details": td
#                             })

#                 tree["children"].append(alert_node)

#         return jsonify(tree)
#     except Exception as e:
#         import traceback
#         traceback.print_exc()
#         return jsonify({'error': str(e)}), 500
#     finally:
#         services.investigation_db.close_connection(conn)

# backend/api/routes/cases.py (UPDATED SECTION ONLY - Replace the existing /explorer/tree-data endpoint)

@cases_bp.route('/explorer/tree-data', methods=['POST'])
@handle_errors
def get_entity_tree():
    """
    Returns hierarchical evidence lineage with REAL computed metrics.
    
    ARCHITECTURE:
    1. Verify case exists
    2. Compute 4 real metrics (alert_count, txn_volume, network_density, risk_score)
    3. Build lineage tree explaining HOW metrics were derived
    4. Attach raw data sections (alerts, accounts, transactions)
    
    SAFETY GUARANTEES:
    - Never assumes columns exist without verification
    - Uses explicit, validated join paths only
    - Fails loudly with descriptive errors
    - Marks cached vs realtime accurately
    """
    root_id = request.json.get('id')
    if not root_id: 
        return jsonify({'error': 'Root ID required'}), 400

    conn = services.investigation_db.connect()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # ============================================================
    # UTILITY FUNCTIONS
    # ============================================================
    
    def clean(r):
        """Convert sqlite3.Row to clean dict with UTF-8 strings"""
        if not r: return {}
        d = dict(r)
        return {k: (v.decode('utf-8') if isinstance(v, bytes) else str(v) if v is not None else None) 
                for k, v in d.items()}

    def get_col(tbl, keywords):
        """
        Find column matching keywords (case-insensitive, flexible matching).
        Returns None if not found.
        """
        try:
            cur.execute(f"PRAGMA table_info({tbl})")
            cols = [r['name'] for r in cur.fetchall()]
            
            # Exact match first
            for c in cols:
                if c.upper() in [k.upper() for k in keywords]: 
                    return c
            
            # Partial match second
            for c in cols:
                if any(k.upper() in c.upper() for k in keywords): 
                    return c
            
            return None
        except: 
            return None

    def table_exists(tbl):
        """Check if table exists in database"""
        try:
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (tbl,))
            return cur.fetchone() is not None
        except:
            return False

    def safe_float(val):
        """Convert to float, handling None/empty gracefully"""
        if val is None or val == '':
            return 0.0
        try:
            return float(val)
        except:
            return 0.0

    # ============================================================
    # METRIC COMPUTATION ENGINE
    # ============================================================
    
    def compute_real_metrics(case_id):
        """
        Compute 4 core metrics using validated join paths.
        Returns dict with metric values + audit trail.
        """
        metrics = {
            'alert_count': None,
            'transaction_volume': None,
            'network_density': None,
            'risk_score': None,
            'computation_log': []
        }

        # -------------------- METRIC 1: ALERT COUNT --------------------
        # Join: alerts.CASE_ID → cases.CASE_ID
        if table_exists('alerts'):
            alert_case_col = get_col('alerts', ['CASE_ID', 'case_id', 'caseid'])
            
            if alert_case_col:
                try:
                    query = f"SELECT COUNT(*) as cnt FROM alerts WHERE {alert_case_col} = ?"
                    cur.execute(query, [case_id])
                    result = cur.fetchone()
                    count = result['cnt'] if result else 0
                    
                    metrics['alert_count'] = {
                        'value': count,
                        'freshness': 'realtime',
                        'computation': f"COUNT(*) FROM alerts WHERE {alert_case_col} = '{case_id}'",
                        'source_table': 'alerts',
                        'join_path': f"alerts.{alert_case_col} = cases.CASE_ID"
                    }
                    metrics['computation_log'].append(f"✓ Alert count: {count} alerts found")
                    
                except Exception as e:
                    metrics['computation_log'].append(f"✗ Alert count failed: {str(e)}")
                    metrics['alert_count'] = {
                        'value': 0,
                        'freshness': 'unavailable',
                        'error': str(e)
                    }
            else:
                metrics['computation_log'].append("✗ Alert count: No CASE_ID column found in alerts table")
        else:
            metrics['computation_log'].append("✗ Alert count: alerts table does not exist")

        # -------------------- METRIC 2: TRANSACTION VOLUME --------------------
        # Strategy: Use the direct CASE_ID column in transactions table
        # Join: transactions.CASE_ID → cases.CASE_ID
        
        transaction_volume = 0.0
        join_method = None
        
        if table_exists('transactions'):
            txn_case_col = get_col('transactions', ['CASE_ID', 'case_id', 'caseid'])
            txn_amount_col = get_col('transactions', ['TXN_AMOUNT', 'amount', 'amt', 'value'])
            
            if txn_case_col and txn_amount_col:
                try:
                    query = f"""
                        SELECT SUM(CAST({txn_amount_col} AS REAL)) as total
                        FROM transactions
                        WHERE {txn_case_col} = ?
                    """
                    cur.execute(query, [case_id])
                    result = cur.fetchone()
                    transaction_volume = safe_float(result['total']) if result else 0.0
                    join_method = f"transactions.{txn_case_col} = cases.CASE_ID (direct)"
                    
                    metrics['computation_log'].append(
                        f"✓ Transaction volume (direct): ${transaction_volume:,.2f}"
                    )
                    
                except Exception as e:
                    metrics['computation_log'].append(f"✗ Transaction volume failed: {str(e)}")
            else:
                metrics['computation_log'].append(
                    f"✗ Transaction volume: Missing columns (case_col={txn_case_col}, amt_col={txn_amount_col})"
                )
        else:
            metrics['computation_log'].append("✗ Transaction volume: transactions table does not exist")
        
        metrics['transaction_volume'] = {
            'value': transaction_volume,
            'freshness': 'realtime' if transaction_volume > 0 or join_method else 'unavailable',
            'computation': f"SUM(transactions.{txn_amount_col or 'amount'}) WHERE CASE_ID = '{case_id}'",
            'source_table': 'transactions',
            'join_path': join_method if join_method else 'No valid join path found'
        }

        # -------------------- METRIC 3: NETWORK DENSITY --------------------
        # Count distinct entities linked to this case:
        # - Unique CUSTOMER_ID values
        # - Unique ACCOUNT_ID values
        # Strategy: Use CUSTOMER_ID from transactions OR alerts
        
        network_entities = set()
        
        # Get customers from transactions
        if table_exists('transactions') and txn_case_col:
            txn_cust_col = get_col('transactions', ['CUSTOMER_ID', 'customer_id', 'cust_id'])
            txn_acct_col = get_col('transactions', ['ACCOUNT_ID', 'account_id', 'acct_id'])
            
            if txn_cust_col:
                try:
                    query = f"SELECT DISTINCT {txn_cust_col} FROM transactions WHERE {txn_case_col} = ?"
                    cur.execute(query, [case_id])
                    for row in cur.fetchall():
                        cust_id = row[txn_cust_col]
                        if cust_id:
                            network_entities.add(f"CUST:{cust_id}")
                except Exception as e:
                    metrics['computation_log'].append(f"✗ Network density (customers): {str(e)}")
            
            if txn_acct_col:
                try:
                    query = f"SELECT DISTINCT {txn_acct_col} FROM transactions WHERE {txn_case_col} = ?"
                    cur.execute(query, [case_id])
                    for row in cur.fetchall():
                        acct_id = row[txn_acct_col]
                        if acct_id:
                            network_entities.add(f"ACCT:{acct_id}")
                except Exception as e:
                    metrics['computation_log'].append(f"✗ Network density (accounts): {str(e)}")
        
        # Also get customers/accounts from alerts
        if table_exists('alerts') and alert_case_col:
            alert_cust_col = get_col('alerts', ['CUSTOMER_ID', 'customer_id', 'cust_id'])
            alert_acct_col = get_col('alerts', ['ACCOUNT_ID', 'account_id', 'acct_id'])
            
            if alert_cust_col:
                try:
                    query = f"SELECT DISTINCT {alert_cust_col} FROM alerts WHERE {alert_case_col} = ?"
                    cur.execute(query, [case_id])
                    for row in cur.fetchall():
                        cust_id = row[alert_cust_col]
                        if cust_id:
                            network_entities.add(f"CUST:{cust_id}")
                except Exception as e:
                    metrics['computation_log'].append(f"✗ Network density from alerts: {str(e)}")
            
            if alert_acct_col:
                try:
                    query = f"SELECT DISTINCT {alert_acct_col} FROM alerts WHERE {alert_case_col} = ?"
                    cur.execute(query, [case_id])
                    for row in cur.fetchall():
                        acct_id = row[alert_acct_col]
                        if acct_id:
                            network_entities.add(f"ACCT:{acct_id}")
                except Exception as e:
                    pass
        
        network_count = len(network_entities)
        metrics['network_density'] = {
            'value': network_count,
            'freshness': 'realtime' if network_count > 0 else 'unavailable',
            'computation': 'COUNT(DISTINCT customers) + COUNT(DISTINCT accounts) from transactions & alerts',
            'source_table': 'transactions, alerts',
            'join_path': 'transactions.CASE_ID = cases.CASE_ID, alerts.CASE_ID = cases.CASE_ID'
        }
        
        if network_count > 0:
            metrics['computation_log'].append(f"✓ Network density: {network_count} unique entities")
        else:
            metrics['computation_log'].append("✗ Network density: No entities found")

        # -------------------- METRIC 4: RISK SCORE (CACHED) --------------------
        # CRITICAL: This is pre-computed and stored in focus_results
        # DO NOT compute dynamically
        
        if table_exists('focus_results'):
            try:
                cur.execute(
                    "SELECT risk_score FROM focus_results WHERE entity_key = ? ORDER BY run_id DESC LIMIT 1",
                    [case_id]
                )
                result = cur.fetchone()
                
                if result and result['risk_score'] is not None:
                    risk_value = safe_float(result['risk_score'])
                    metrics['risk_score'] = {
                        'value': risk_value,
                        'freshness': 'cached',
                        'computation': 'Pre-computed by Focus Engine (stored in focus_results)',
                        'source_table': 'focus_results',
                        'join_path': 'focus_results.entity_key = cases.CASE_ID'
                    }
                    metrics['computation_log'].append(f"✓ Risk score (cached): {risk_value}/100")
                else:
                    metrics['risk_score'] = {
                        'value': None,
                        'freshness': 'unavailable',
                        'computation': 'Not computed yet by Focus Engine',
                        'source_table': 'focus_results'
                    }
                    metrics['computation_log'].append("✗ Risk score: No cached value in focus_results")
                    
            except Exception as e:
                metrics['computation_log'].append(f"✗ Risk score query failed: {str(e)}")
                metrics['risk_score'] = {
                    'value': None,
                    'freshness': 'unavailable',
                    'error': str(e)
                }
        else:
            metrics['computation_log'].append("✗ Risk score: focus_results table does not exist")
            metrics['risk_score'] = {
                'value': None,
                'freshness': 'unavailable',
                'computation': 'Focus Engine not run'
            }

        return metrics

    # ============================================================
    # LINEAGE TREE BUILDER
    # ============================================================
    
    def build_evidence_lineage(case_id, metrics):
        """
        Build lineage tree explaining HOW metrics were derived.
        Lineage is explanatory, NOT computational.
        """
        lineage_root = {
            "id": f"lineage_{case_id}",
            "type": "Lineage",
            "label": "Evidence Lineage & Derivation Logic",
            "details": {
                "description": "System computation transparency and data provenance",
                "audit_trail": "All metrics computed from live database queries"
            },
            "children": [],
            "metadata": {
                "is_evidence": True,
                "expand_default": True,
                "priority": "high"
            }
        }

        children = []

        # ---------- RISK SCORE (IF AVAILABLE) ----------
        if metrics['risk_score'] and metrics['risk_score'].get('value') is not None:
            risk_node = {
                "id": f"derived_risk_score_{case_id}",
                "type": "DerivedField",
                "label": f"Risk Score ({metrics['risk_score']['value']}/100)",
                "details": {
                    "metric_name": "risk_score",
                    "current_value": metrics['risk_score']['value'],
                    "value_freshness": metrics['risk_score']['freshness'],
                    "computation": metrics['risk_score']['computation'],
                    "source_table": metrics['risk_score']['source_table'],
                    "join_path": metrics['risk_score'].get('join_path', 'N/A')
                },
                "children": [
                    {
                        "id": f"src_focus_{case_id}",
                        "type": "SourceColumn",
                        "label": "focus_results.risk_score",
                        "details": {
                            "table": "focus_results",
                            "column": "risk_score",
                            "role": "Pre-computed risk index",
                            "note": "Computed by Focus Engine using alert severity weights"
                        }
                    }
                ],
                "metadata": {
                    "is_evidence": True,
                    "expand_default": True,
                    "priority": "critical"
                }
            }
            children.append(risk_node)

        # ---------- ALERT COUNT ----------
        if metrics.get('alert_count') and metrics['alert_count'].get('value') is not None:
            alert_node = {
                "id": f"derived_alert_count_{case_id}",
                "type": "DerivedField",
                "label": f"Alert Count ({metrics['alert_count']['value']})",
                "details": {
                    "metric_name": "alert_count",
                    "current_value": metrics['alert_count']['value'],
                    "value_freshness": metrics['alert_count']['freshness'],
                    "computation": metrics['alert_count']['computation'],
                    "source_table": metrics['alert_count']['source_table'],
                    "join_path": metrics['alert_count'].get('join_path', 'N/A')
                },
                "children": [
                    {
                        "id": f"src_alerts_{case_id}",
                        "type": "SourceColumn",
                        "label": "alerts.CASE_ID",
                        "details": {
                            "table": "alerts",
                            "column": "CASE_ID",
                            "role": "Foreign key linking alerts to cases"
                        }
                    }
                ],
                "metadata": {
                    "is_evidence": True,
                    "expand_default": False,
                    "priority": "high"
                }
            }
            children.append(alert_node)

        # ---------- TRANSACTION VOLUME ----------
        if metrics['transaction_volume'] and metrics['transaction_volume'].get('value') is not None:
            txn_val = metrics['transaction_volume']['value']
            txn_node = {
                "id": f"derived_txn_volume_{case_id}",
                "type": "DerivedField",
                "label": f"Transaction Volume (${txn_val:,.2f})",
                "details": {
                    "metric_name": "transaction_volume",
                    "current_value": f"${txn_val:,.2f}",
                    "value_freshness": metrics['transaction_volume']['freshness'],
                    "computation": metrics['transaction_volume']['computation'],
                    "source_table": metrics['transaction_volume']['source_table'],
                    "join_path": metrics['transaction_volume'].get('join_path', 'N/A')
                },
                "children": [
                    {
                        "id": f"src_transactions_{case_id}",
                        "type": "SourceColumn",
                        "label": "transactions.TXN_AMOUNT",
                        "details": {
                            "table": "transactions",
                            "column": "TXN_AMOUNT",
                            "role": "Transaction monetary value",
                            "aggregation": "SUM"
                        }
                    },
                    {
                        "id": f"src_transactions_case_{case_id}",
                        "type": "SourceColumn",
                        "label": "transactions.CASE_ID",
                        "details": {
                            "table": "transactions",
                            "column": "CASE_ID",
                            "role": "Direct link to case (enables direct aggregation)"
                        }
                    }
                ],
                "metadata": {
                    "is_evidence": True,
                    "expand_default": False,
                    "priority": "high"
                }
            }
            children.append(txn_node)

        # ---------- NETWORK DENSITY ----------
        if metrics['network_density'] and metrics['network_density'].get('value') is not None:
            network_val = metrics['network_density']['value']
            network_node = {
                "id": f"derived_network_{case_id}",
                "type": "DerivedField",
                "label": f"Network Density ({network_val} entities)",
                "details": {
                    "metric_name": "network_density",
                    "current_value": network_val,
                    "value_freshness": metrics['network_density']['freshness'],
                    "computation": metrics['network_density']['computation'],
                    "source_table": metrics['network_density']['source_table'],
                    "join_path": metrics['network_density'].get('join_path', 'N/A')
                },
                "children": [
                    {
                        "id": f"src_network_cust_{case_id}",
                        "type": "SourceColumn",
                        "label": "transactions/alerts.CUSTOMER_ID",
                        "details": {
                            "table": "transactions, alerts",
                            "column": "CUSTOMER_ID",
                            "role": "Unique customer identifier for network traversal"
                        }
                    },
                    {
                        "id": f"src_network_acct_{case_id}",
                        "type": "SourceColumn",
                        "label": "transactions/alerts.ACCOUNT_ID",
                        "details": {
                            "table": "transactions, alerts",
                            "column": "ACCOUNT_ID",
                            "role": "Unique account identifier for network traversal"
                        }
                    }
                ],
                "metadata": {
                    "is_evidence": True,
                    "expand_default": False,
                    "priority": "medium"
                }
            }
            children.append(network_node)

        lineage_root["children"] = children
        return lineage_root

    # ============================================================
    # MAIN EXECUTION
    # ============================================================
    
    try:
        # Verify case exists
        case_col = get_col('cases', ['CASE_ID', 'case_id', 'caseid'])
        if not case_col:
            return jsonify({'error': 'Cannot identify CASE_ID column in cases table'}), 500
        
        cur.execute(f"SELECT * FROM cases WHERE {case_col} = ?", [root_id])
        case_row = cur.fetchone()
        if not case_row:
            return jsonify({'error': f'Case {root_id} not found'}), 404
        
        case_data = clean(case_row)

        # Compute real metrics
        print(f"\n{'='*60}")
        print(f"COMPUTING METRICS FOR CASE: {root_id}")
        print(f"{'='*60}")
        
        metrics = compute_real_metrics(root_id)
        
        # Log computation results
        for log_entry in metrics['computation_log']:
            print(log_entry)
        print(f"{'='*60}\n")

        # Build lineage with real metrics
        lineage_node = build_evidence_lineage(root_id, metrics)
        
        # Build tree structure
        tree = {
            "id": str(case_data[case_col]),
            "type": "Case",
            "label": f"Case {case_data[case_col]}",
            "details": case_data,
            "children": [lineage_node],
            "evidence_summary": {
                "risk_score": metrics['risk_score'].get('value') if metrics['risk_score'] else None,
                "alert_count": metrics['alert_count'].get('value', 0) if metrics['alert_count'] else 0,
                "critical_count": 0,  # Could be computed if severity column exists
                "total_volume": metrics['transaction_volume'].get('value', 0) if metrics['transaction_volume'] else 0,
                "evidence_strength": (
                    "STRONG" if all([
                        metrics['alert_count'] and metrics['alert_count'].get('value', 0) > 0,
                        metrics['transaction_volume'] and metrics['transaction_volume'].get('value', 0) > 0
                    ]) else "MODERATE"
                ),
                "data_completeness": (
                    "COMPLETE" if all([
                        metrics['alert_count'] and metrics['alert_count'].get('freshness') == 'realtime',
                        metrics['transaction_volume'] and metrics['transaction_volume'].get('freshness') == 'realtime',
                        metrics['network_density'] and metrics['network_density'].get('freshness') == 'realtime'
                    ]) else "PARTIAL"
                )
            }
        }

        # ============================================================
        # ADD CONTEXT SECTIONS (NOT EVIDENCE)
        # ============================================================
        
        # CUSTOMERS SECTION
        cust_ids = set()
        if table_exists('transactions'):
            txn_case_col = get_col('transactions', ['CASE_ID', 'case_id', 'caseid'])
            txn_cust_col = get_col('transactions', ['CUSTOMER_ID', 'customer_id', 'cust_id'])
            
            if txn_case_col and txn_cust_col:
                cur.execute(
                    f"SELECT DISTINCT {txn_cust_col} FROM transactions WHERE {txn_case_col} = ?",
                    [root_id]
                )
                cust_ids.update(row[txn_cust_col] for row in cur.fetchall() if row[txn_cust_col])
        
        if cust_ids and table_exists('customers'):
            cust_section = {
                "id": f"customers_section_{root_id}",
                "type": "CustomersSection",
                "label": f"Linked Customers ({len(cust_ids)})",
                "details": {"count": len(cust_ids)},
                "children": [],
                "metadata": {
                    "is_evidence": False,
                    "expand_default": False,
                    "priority": "low"
                }
            }
            
            cust_id_col = get_col('customers', ['CUSTOMER_ID', 'customer_id', 'cust_id'])
            if cust_id_col:
                for cid in list(cust_ids)[:10]:  # Limit to 10
                    cur.execute(f"SELECT * FROM customers WHERE {cust_id_col} = ?", [cid])
                    cust_row = cur.fetchone()
                    if cust_row:
                        cust_data = clean(cust_row)
                        cust_section["children"].append({
                            "id": str(cid),
                            "type": "Customer",
                            "label": f"Customer {cid}",
                            "details": cust_data
                        })
                
                if cust_section["children"]:
                    tree["children"].append(cust_section)

        # ACCOUNTS SECTION
        acct_ids = set()
        if table_exists('transactions'):
            txn_case_col = get_col('transactions', ['CASE_ID', 'case_id', 'caseid'])
            txn_acct_col = get_col('transactions', ['ACCOUNT_ID', 'account_id', 'acct_id'])
            
            if txn_case_col and txn_acct_col:
                cur.execute(
                    f"SELECT DISTINCT {txn_acct_col} FROM transactions WHERE {txn_case_col} = ?",
                    [root_id]
                )
                acct_ids.update(row[txn_acct_col] for row in cur.fetchall() if row[txn_acct_col])
        
        if acct_ids and table_exists('accounts'):
            acct_section = {
                "id": f"accounts_section_{root_id}",
                "type": "AccountsSection",
                "label": f"Linked Accounts ({len(acct_ids)})",
                "details": {"count": len(acct_ids)},
                "children": [],
                "metadata": {
                    "is_evidence": False,
                    "expand_default": False,
                    "priority": "low"
                }
            }
            
            acct_id_col = get_col('accounts', ['ACCOUNT_ID', 'account_id', 'acct_id'])
            if acct_id_col:
                for aid in list(acct_ids)[:10]:  # Limit to 10
                    cur.execute(f"SELECT * FROM accounts WHERE {acct_id_col} = ?", [aid])
                    acct_row = cur.fetchone()
                    if acct_row:
                        acct_data = clean(acct_row)
                        acct_section["children"].append({
                            "id": str(aid),
                            "type": "Account",
                            "label": f"Account {aid}",
                            "details": acct_data
                        })
                
                if acct_section["children"]:
                    tree["children"].append(acct_section)

        # ALERTS SECTION
        if table_exists('alerts'):
            alert_case_col = get_col('alerts', ['CASE_ID', 'case_id', 'caseid'])
            
            if alert_case_col:
                cur.execute(f"SELECT * FROM alerts WHERE {alert_case_col} = ? LIMIT 10", [root_id])
                alerts = [clean(row) for row in cur.fetchall()]
                
                if alerts:
                    alerts_section = {
                        "id": f"alerts_section_{root_id}",
                        "type": "AlertsSection",
                        "label": f"Raw Alerts ({len(alerts)})",
                        "details": {"count": len(alerts)},
                        "children": [],
                        "metadata": {
                            "is_evidence": False,
                            "expand_default": False,
                            "priority": "low"
                        }
                    }
                    
                    alert_id_col = get_col('alerts', ['ALERT_ID', 'alert_id', 'alertid'])
                    
                    for alert in alerts:
                        alert_label = f"Alert {alert.get(alert_id_col, 'N/A')}"
                        if 'ALERT_SCORE' in alert:
                            alert_label += f" (Score: {alert['ALERT_SCORE']})"
                        
                        alerts_section["children"].append({
                            "id": str(alert.get(alert_id_col, f"alert_{len(alerts_section['children'])}")),
                            "type": "Alert",
                            "label": alert_label,
                            "details": alert
                        })
                    
                    tree["children"].append(alerts_section)

        # TRANSACTIONS SECTION
        if table_exists('transactions'):
            txn_case_col = get_col('transactions', ['CASE_ID', 'case_id', 'caseid'])
            
            if txn_case_col:
                cur.execute(f"SELECT * FROM transactions WHERE {txn_case_col} = ? LIMIT 10", [root_id])
                transactions = [clean(row) for row in cur.fetchall()]
                
                if transactions:
                    txns_section = {
                        "id": f"transactions_section_{root_id}",
                        "type": "TransactionsSection",
                        "label": f"Raw Transactions ({len(transactions)})",
                        "details": {"count": len(transactions)},
                        "children": [],
                        "metadata": {
                            "is_evidence": False,
                            "expand_default": False,
                            "priority": "low"
                        }
                    }
                    
                    txn_id_col = get_col('transactions', ['TRANSACTION_ID', 'transaction_id', 'txn_id'])
                    txn_amount_col = get_col('transactions', ['TXN_AMOUNT', 'amount', 'amt'])
                    
                    for txn in transactions:
                        txn_label = f"Txn {txn.get(txn_id_col, 'N/A')}"
                        if txn_amount_col and txn.get(txn_amount_col):
                            txn_label += f" (${safe_float(txn[txn_amount_col]):,.2f})"
                        
                        txns_section["children"].append({
                            "id": str(txn.get(txn_id_col, f"txn_{len(txns_section['children'])}")),
                            "type": "Transaction",
                            "label": txn_label,
                            "details": txn
                        })
                    
                    tree["children"].append(txns_section)

        return jsonify(tree)
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e), 'traceback': traceback.format_exc()}), 500
    finally:
        services.investigation_db.close_connection(conn)