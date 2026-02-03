# backend/api/routes/merge.py (ENHANCED - On-Demand Hydration)
# Location: backend/api/routes/merge.py
from flask import Blueprint, request, jsonify
from api.utils import handle_errors
from api.services import services

merge_bp = Blueprint('merge', __name__)

# --- 1. BASIC TABLE INFO (UNCHANGED) ---

@merge_bp.route('/merge/tables', methods=['GET'])
def get_tables():
    """Returns tables. Tries to auto-reconnect if DB is missing."""
    if not services.investigation_db:
        print("⚠️ Investigation DB missing. Attempting to restore active environment...")
        try:
            if services.metadata_manager and services.metadata_manager.active_env:
                services.activate_case(services.metadata_manager.active_env)
            else:
                return jsonify([]) 
        except Exception as e:
            print(f"Auto-connect failed: {e}")
            return jsonify([])

    try:
        if services.smart_merge_service:
            schema = services.smart_merge_service.get_db_schema()
            tables = list(schema.keys())
        else:
            conn = services.investigation_db.connect()
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            tables = [r[0] for r in cursor.fetchall()]
            services.investigation_db.close_connection(conn)

        filtered_tables = [t for t in tables if t not in ['sqlite_sequence', 'android_metadata']]
        return jsonify(filtered_tables)

    except Exception as e:
        print(f"Error listing tables: {e}")
        return jsonify([])


@merge_bp.route('/merge/keys', methods=['POST'])
@handle_errors
def get_keys():
    """Get columns for a specific table."""
    return jsonify(services.smart_merge_service.get_table_keys(request.json.get('table')))


@merge_bp.route('/merge/cumulative-keys', methods=['POST'])
@handle_errors
def get_cumulative_keys():
    """Returns all columns available in the chain so far."""
    tables = request.json.get('tables', [])
    return jsonify(services.smart_merge_service.get_cumulative_columns(tables))


# --- 2. SMART MERGE (MANUAL - UNCHANGED) ---

@merge_bp.route('/merge/preview', methods=['POST'])
@handle_errors
def preview():
    """Previews the join result."""
    return jsonify({
        'success': True, 
        'data': services.smart_merge_service.preview_merge(request.json.get('chain', []))
    })


@merge_bp.route('/merge/ai-recommend', methods=['POST'])
@handle_errors
def ai_recommend():
    """AI Helper for joins."""
    left = request.json.get('left_table')
    return jsonify({
        'success': True,
        'suggestions': services.smart_merge_service.ai_recommend_joins(left_table=left)
    })


# --- 3. NEW: ON-DEMAND HYDRATION ---

@merge_bp.route('/merge/hydrate', methods=['POST'])
@handle_errors
def hydrate_entity():
    """
    CRITICAL: On-demand SmartMerge for a single entity.
    Called when investigator clicks on a case from Priority Inbox or Search.
    
    Accepts:
    - case_id OR entity_id OR account_id
    - Optional date_window (days)
    
    Returns:
    - Merged data for ONLY this entity (not bulk)
    """
    payload = request.json
    case_id = payload.get('case_id')
    entity_id = payload.get('entity_id')
    account_id = payload.get('account_id')
    date_window = payload.get('date_window', 90)  # Default 90 days
    
    if not any([case_id, entity_id, account_id]):
        return jsonify({
            "success": False,
            "error": "Must provide case_id, entity_id, or account_id"
        }), 400
    
    # Determine target identifier
    target_id = case_id or entity_id or account_id
    target_type = 'case' if case_id else 'account' if account_id else 'entity'
    
    try:
        # Call SmartMerge for this specific entity only
        result = services.smart_merge_service.hydrate_single_entity(
            target_id=target_id,
            target_type=target_type,
            date_window=date_window
        )
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# --- 4. UNIFIED VIEW BUILDER (UNCHANGED) ---

@merge_bp.route('/merge/build-aml-master', methods=['POST'])
@handle_errors
def build_master():
    """Executes the robust sequential merge (Alerts->Cases->Txn...)."""
    target = request.json.get('target', 'master_case_summary')
    return jsonify(services.smart_merge_service.build_aml_master_dataset(target))


# --- 5. AUTO-BUILDER (AI ARCHITECT - UNCHANGED) ---

@merge_bp.route('/auto-build/generate-strategy', methods=['POST'])
@handle_errors
def generate_strategy():
    """AI analyzes schema and proposes a join path."""
    if not services.ai_builder:
        return jsonify({"error": "AI Service not initialized"}), 500
        
    model = request.json.get('model', 'tinyllama')
    return jsonify(services.ai_builder.generate_strategy(model))


@merge_bp.route('/auto-build/execute', methods=['POST'])
@handle_errors
def execute_strategy():
    """Executes the AI-proposed strategy."""
    if not services.ai_builder:
        return jsonify({"error": "AI Service not initialized"}), 500

    chain = request.json.get('chain', [])
    return jsonify(services.ai_builder.execute_strategy(chain))


@merge_bp.route('/merge/registry', methods=['GET'])
def get_registry():
    """Returns the list of built master datasets."""
    if not services.smart_merge_service:
        return jsonify([])
    return jsonify(services.smart_merge_service.get_registry())


@merge_bp.route('/merge/commit', methods=['POST'])
@handle_errors
def commit_custom_chain():
    """Saves a custom chain as a new master table."""
    chain = request.json.get('chain', [])
    custom_name = request.json.get('name', 'Custom Build')
    
    result = services.smart_merge_service.commit_merge(chain, custom_name)
    return jsonify(result)


# --- 6. NEW: FOCUS ENGINE TRIGGER ---

@merge_bp.route('/merge/rebuild-focus-index', methods=['POST'])
@handle_errors
def rebuild_focus_index():
    """
    Manually trigger Focus Engine rebuild.
    Should be called:
    - After data ingestion
    - After alerts are updated
    - On demand by admin
    """
    if not services.focus_engine:
        return jsonify({
            "success": False,
            "error": "Focus Engine not initialized"
        }), 500
    
    result = services.focus_engine.rebuild_index()
    return jsonify(result)


# Add these two new endpoints to backend/api/routes/merge.py

@merge_bp.route('/merge/save-unified', methods=['POST'])
@handle_errors
def save_unified_view():
    """
    Saves a built unified view with a custom name.
    This creates a permanent copy of the temporary master table.
    """
    source_table = request.json.get('source_table')
    custom_name = request.json.get('name', 'Unified Dataset')
    
    if not source_table:
        return jsonify({
            "success": False,
            "error": "source_table is required"
        }), 400
    
    try:
        # Use SmartMergeService to save the unified view
        result = services.smart_merge_service.save_unified_dataset(
            source_table=source_table,
            display_name=custom_name
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@merge_bp.route('/merge/delete', methods=['POST'])
@handle_errors
def delete_dataset():
    """
    Deletes a saved dataset from the registry and drops the table.
    """
    dataset_id = request.json.get('id')
    
    if not dataset_id:
        return jsonify({
            "success": False,
            "error": "Dataset ID is required"
        }), 400
    
    try:
        # Use SmartMergeService to delete the dataset
        result = services.smart_merge_service.delete_dataset(dataset_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


