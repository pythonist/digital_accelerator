import os
from flask import Blueprint, request, jsonify
from api.utils import handle_errors
from api.services import services
import sqlite3

data_bp = Blueprint('data', __name__)

def resolve_env_path(env_id, tenant_id):
    """Helper to resolve environment data path safely."""
    possible_roots = [
        f"data/environments/{env_id}",
        f"data/{tenant_id}/{env_id}",
        f"backend/data/environments/{env_id}"
    ]
    
    for path in possible_roots:
        if os.path.exists(path):
            return path
            
    # Fallback creation
    path = f"data/environments/{env_id}"
    os.makedirs(path, exist_ok=True)
    return path

# -------------------------------------------------------------------------
#  NEW: Explicit Route to List Tables (Fixes Empty Dropdown)
# -------------------------------------------------------------------------
@data_bp.route("/db/tables", methods=["GET"])
@handle_errors
def list_database_tables():
    """Returns a list of all tables in the active environment's DB."""
    env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
    if not env_id:
        return jsonify({"error": "No active environment"}), 400

    try:
        db = services.get_investigation_db(env_id, request.tenant_id)
        conn = db.connect()
        cursor = conn.cursor()
        
        # Get all non-sqlite tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        tables = [r[0] for r in cursor.fetchall()]

        base_uploaded = {"alerts", "transactions", "accounts", "customers", "cases", "sanctions"}
        system_tables = {
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

        # 1) Uploaded datasets: prefer upload_history if present
        if "upload_history" in tables:
            try:
                cursor.execute("SELECT DISTINCT table_name FROM upload_history WHERE table_name IS NOT NULL")
                for (t,) in cursor.fetchall():
                    if t:
                        keep.add(str(t))
            except Exception:
                pass

        # Fallback to default uploaded names
        if not keep:
            keep |= (base_uploaded & set(tables))

        # 2) Master tables: show cleaned master + any user-saved master_* tables
        for t in tables:
            tl = str(t).lower()
            if tl == "master_cleaned_data":
                keep.add(t)
            elif tl.startswith("master_") and t not in system_tables:
                keep.add(t)

        unified_candidates = [t for t in tables if "unified" in t.lower() and t not in system_tables]
        if unified_candidates:
            latest_unified = sorted(unified_candidates)[-1]
            keep.add(latest_unified)

        # 3) Always ensure core base tables are visible if present
        keep |= (base_uploaded & set(tables))

        filtered = [t for t in tables if t in keep and t not in system_tables]
        filtered = sorted(set(filtered))

        db.close_connection(conn)
        return jsonify(filtered)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# -------------------------------------------------------------------------
#  NEW: Ingestion History Endpoint (For Audit Log Screen)
# -------------------------------------------------------------------------
@data_bp.route('/ingestion/history', methods=['GET'])
@handle_errors
def get_ingestion_history():
    """
    Returns merged history of file uploads from the database log.
    Used by IngestionHistoryScreen.jsx
    """
    env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
    if not env_id:
        return jsonify({"error": "No environment selected"}), 400

    try:
        db = services.get_investigation_db(env_id, request.tenant_id)
        conn = db.connect()
        cursor = conn.cursor()
        
        # 1. Check if history table exists first
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='upload_history'")
        if not cursor.fetchone():
            db.close_connection(conn)
            return jsonify({'success': True, 'history': []})

        # 2. Fetch history
        cursor.execute("""
            SELECT id, filename, entity_type, table_name, rows_loaded, status, upload_timestamp 
            FROM upload_history 
            ORDER BY upload_timestamp DESC LIMIT 100
        """)
        
        uploads = []
        for row in cursor.fetchall():
            uploads.append({
                "id": f"csv-{row[0]}",
                "type": "csv",
                "name": row[1],
                "entity_type": row[2],
                "source": "File Upload",
                "rows": row[4],
                "status": row[5],
                "timestamp": row[6]
            })
            
        db.close_connection(conn)

        # 3. (Optional) You can merge SQL connector history here if you have a separate table for it
        # For now, we return the CSV uploads which populated the history table
        
        return jsonify({'success': True, 'history': uploads})

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@data_bp.route("/ingest-single-csv", methods=["POST"])
@handle_errors
def ingest_single_csv():
    """
    Ingest a single CSV file into a specific table.
    """
    if 'file' not in request.files or 'type' not in request.form:
        return jsonify({"error": "Missing file or type parameter"}), 400

    file = request.files['file']
    dataset_type = request.form['type']
    
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    # 1. Resolve Environment
    try:
        tenant_id = request.tenant_id
        env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
        
        if not env_id:
            return jsonify({"error": "No active environment selected."}), 400
            
        case_path = resolve_env_path(env_id, tenant_id)
        data_dir = os.path.join(case_path, 'data')
        os.makedirs(data_dir, exist_ok=True)

    except Exception as e:
        return jsonify({"error": f"Environment Path Error: {str(e)}"}), 500

    # 2. Get Service
    try:
        ingestion_service = services.get_data_ingestion_service(env_id, tenant_id)
    except Exception as e:
        return jsonify({"error": f"Service Init Failed: {str(e)}"}), 500

    # 3. Process File
    try:
        save_path = os.path.join(data_dir, f"{dataset_type}.csv")
        file.save(save_path)
        
        df, stats = ingestion_service.load_csv(
            save_path, table_name=dataset_type, persist_to_db=True
        )
        
        try:
            services.metadata_manager.save_schema(
                table_name=dataset_type, 
                columns=list(df.columns), 
                row_count=stats.get("total_rows", 0),
                env_id=env_id
            )
        except:
            pass
            
        return jsonify({
            "success": True,
            "message": f"Successfully ingested {dataset_type}",
            "rows": stats.get("total_rows", 0),
            "env_id": env_id
        })

    except Exception as e:
        print(f"❌ Ingestion Error [{dataset_type}]: {e}")
        return jsonify({"error": str(e)}), 500

@data_bp.route("/ingest-multi-csv", methods=["POST"])
@handle_errors
def ingest_multi_csv():
    """
    Ingest multiple CSVs in batch mode.
    """
    if not request.files:
        return jsonify({"error": "No files uploaded"}), 400

    try:
        tenant_id = request.tenant_id
        env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
        
        if not env_id:
            return jsonify({"error": "No active environment selected."}), 400
            
        case_path = resolve_env_path(env_id, tenant_id)
        data_dir = os.path.join(case_path, 'data')
        os.makedirs(data_dir, exist_ok=True)

    except Exception as e:
        return jsonify({"error": f"Environment Path Error: {str(e)}"}), 500

    table_mapping = {
        "customers": "customers", "accounts": "accounts",
        "transactions": "transactions", "alerts": "alerts", "cases": "cases"
    }

    ingestion_results = {}
    
    try:
        ingestion_service = services.get_data_ingestion_service(env_id, tenant_id)
    except Exception as e:
        return jsonify({"error": f"Service Init Failed: {str(e)}"}), 500

    try:
        for key, table_name in table_mapping.items():
            if key in request.files:
                file = request.files[key]
                if file.filename == '': continue

                save_path = os.path.join(data_dir, f"{key}.csv")
                file.save(save_path)
                
                df, stats = ingestion_service.load_csv(
                    save_path, table_name=table_name, persist_to_db=True
                )
                
                try:
                    services.metadata_manager.save_schema(
                        table_name=table_name, 
                        columns=list(df.columns), 
                        row_count=stats.get("total_rows", 0),
                        env_id=env_id
                    )
                except:
                    pass
                
                ingestion_results[key] = {"success": True, "rows": stats.get("total_rows", 0)}

    except Exception as e:
        print(f"❌ Critical Ingestion Error: {e}")
        return jsonify({"error": str(e), "details": ingestion_results}), 500

    return jsonify({
        "success": True,
        "message": "Batch ingestion complete.",
        "details": ingestion_results,
        "env_id": env_id
    })

@data_bp.route('/metadata/system-status', methods=['GET'])
def system_status():
    status = {'ingestion_complete': False, 'merge_complete': False, 'clean_complete': False, 'active_env': None}
    env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
    status['active_env'] = env_id

    if env_id:
        try:
            db = services.get_investigation_db(env_id, request.tenant_id)
            conn = db.connect()
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            db_tables = {r[0] for r in cursor.fetchall()}
            db.close_connection(conn)
            status['ingestion_complete'] = 'alerts' in db_tables
            status['merge_complete'] = any(t.startswith('master_') for t in db_tables)
            status['clean_complete'] = 'master_cleaned_data' in db_tables
        except: pass
    return jsonify(status)

@data_bp.route("/db/query-table", methods=["POST"])
@handle_errors
def query_database_table():
    data = request.json
    table_name = data.get("table")
    env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
    
    if not env_id: return jsonify({"error": "No environment selected"}), 400

    try:
        db = services.get_investigation_db(env_id, request.tenant_id)
        conn = db.connect()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Security check: verify table exists to prevent injection (though parameterized queries are used for values)
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
        if not cursor.fetchone():
            return jsonify({"error": f"Table '{table_name}' not found"}), 404

        # Get Schema
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns = [r['name'] for r in cursor.fetchall()]

        page = int(data.get("page", 1))
        rows = int(data.get("rowsPerPage", 50))
        offset = (page - 1) * rows
        
        # Sort
        sort_col = data.get("sortColumn")
        sort_dir = data.get("sortDirection", "asc").upper()
        if sort_dir not in ['ASC', 'DESC']: sort_dir = 'ASC'
        
        order_clause = ""
        if sort_col and sort_col in columns:
            order_clause = f"ORDER BY {sort_col} {sort_dir}"

        # Count
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        total = cursor.fetchone()[0]

        # Fetch Data
        query = f"SELECT * FROM {table_name} {order_clause} LIMIT ? OFFSET ?"
        cursor.execute(query, (rows, offset))
        results = [dict(r) for r in cursor.fetchall()]

        return jsonify({
            "success": True, 
            "data": results, 
            "columns": columns,
            "totalRows": total
        })
    finally:
        if 'db' in locals(): db.close_connection(conn)

@data_bp.route('/db/stats', methods=['GET'])
def db_stats():
    env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID')
    try:
        db = services.get_investigation_db(env_id, request.tenant_id)
        conn = db.connect()
        cursor = conn.cursor()
        
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        tables = [r[0] for r in cursor.fetchall()]
        
        stats = {}
        for table in tables:
            try:
                cursor.execute(f'SELECT COUNT(*) FROM "{table}"')
                stats[table] = cursor.fetchone()[0]
            except:
                stats[table] = 0
                
        db.close_connection(conn)
        return jsonify({"success": True, "stats": stats})
    except Exception as e:
        return jsonify({"success": False, "stats": {}, "error": str(e)})
    


"""
Master dashbaord statistics
"""

@data_bp.route('/master/summary', methods=['GET'])
@handle_errors
def master_summary():
    """
    Returns comprehensive summary statistics for the master dataset.
    Non-blocking aggregation queries only.
    """
    table_name = request.args.get('table', 'master_cleaned_data')
    env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
    
    if not env_id:
        return jsonify({"error": "No environment selected"}), 400

    try:
        db = services.get_investigation_db(env_id, request.tenant_id)
        conn = db.connect()
        cursor = conn.cursor()

        # Verify table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
        if not cursor.fetchone():
            return jsonify({"error": f"Table '{table_name}' not found"}), 404

        # Get all columns
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns = {row[1]: row[2] for row in cursor.fetchall()}  # {column_name: type}

        summary = {
            "counts": {},
            "risk": {},
            "transactions": {},
            "freshness": {}
        }

        # === COUNTS ===
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            summary["counts"]["total_records"] = cursor.fetchone()[0]
        except:
            summary["counts"]["total_records"] = 0

        # Unique cases
        if 'case_id' in columns:
            try:
                cursor.execute(f"SELECT COUNT(DISTINCT case_id) FROM {table_name}")
                summary["counts"]["unique_cases"] = cursor.fetchone()[0]
            except:
                pass

        # Unique customers
        if 'customer_id' in columns:
            try:
                cursor.execute(f"SELECT COUNT(DISTINCT customer_id) FROM {table_name}")
                summary["counts"]["unique_customers"] = cursor.fetchone()[0]
            except:
                pass

        # === RISK DISTRIBUTION ===
        if 'case_risk' in columns or 'risk_level' in columns or 'severity' in columns:
            risk_col = 'case_risk' if 'case_risk' in columns else ('risk_level' if 'risk_level' in columns else 'severity')
            try:
                cursor.execute(f"SELECT {risk_col}, COUNT(*) FROM {table_name} WHERE {risk_col} IS NOT NULL GROUP BY {risk_col}")
                summary["risk"]["case_risk"] = {row[0]: row[1] for row in cursor.fetchall()}
            except:
                pass

        # === TRANSACTIONS ===
        if 'amount' in columns or 'transaction_amount' in columns:
            amt_col = 'amount' if 'amount' in columns else 'transaction_amount'
            try:
                cursor.execute(f"SELECT SUM({amt_col}), MAX({amt_col}) FROM {table_name} WHERE {amt_col} IS NOT NULL")
                result = cursor.fetchone()
                if result:
                    summary["transactions"]["total_value"] = result[0] or 0
                    summary["transactions"]["max_amount"] = result[1] or 0
            except:
                pass

            # P95
            try:
                cursor.execute(f"""
                    SELECT {amt_col} FROM {table_name} 
                    WHERE {amt_col} IS NOT NULL 
                    ORDER BY {amt_col} 
                    LIMIT 1 OFFSET (SELECT COUNT(*) * 0.95 FROM {table_name} WHERE {amt_col} IS NOT NULL)
                """)
                result = cursor.fetchone()
                if result:
                    summary["transactions"]["p95_amount"] = result[0]
            except:
                pass

        # === FRESHNESS ===
        date_columns = [col for col in columns.keys() if 'date' in col.lower() or 'time' in col.lower() or col in ['created_at', 'updated_at', 'alert_date']]
        
        if date_columns:
            try:
                date_col = date_columns[0]  # Use first date column found
                cursor.execute(f"SELECT MAX({date_col}) FROM {table_name} WHERE {date_col} IS NOT NULL")
                result = cursor.fetchone()
                if result and result[0]:
                    summary["freshness"]["latest_alert_date"] = result[0]
                
                # Records in last 90 days
                cursor.execute(f"""
                    SELECT COUNT(*) FROM {table_name} 
                    WHERE {date_col} IS NOT NULL 
                    AND {date_col} >= date('now', '-90 days')
                """)
                result = cursor.fetchone()
                if result:
                    summary["freshness"]["records_last_90_days"] = result[0]
            except:
                pass

        db.close_connection(conn)
        return jsonify(summary)

    except Exception as e:
        return jsonify({"error": str(e)}), 500
