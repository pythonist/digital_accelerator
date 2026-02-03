# ============================================================================
# backend/api/routes/calibration/calibration_data_routes.py - COMPLETE VERSION
# ============================================================================
"""
Step 0 Data Foundation Routes - COMPLETE IMPLEMENTATION
All endpoints with full debugging and error handling
"""
from datetime import datetime
import json
import tempfile
import os

import pandas as pd
from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename

from api.services import services
from calibration.services import Step0Step1BridgeService

calibration_data_bp = Blueprint('calibration_data', __name__, url_prefix='/api/v2/calibration/data')

# ============================================================================
# SERVICE GETTERS
# ============================================================================
def get_dataset_manager():
    return services.get_dataset_manager()

def get_schema_service():
    return services.get_schema_service()

def get_logical_merge_service():
    return services.get_logical_merge_service()

def get_sql_execution_service():
    return services.get_sql_execution_service()

def get_step0_readiness_service():
    return services.get_step0_readiness_service()

def get_bridge_service():
    if not hasattr(get_bridge_service, '_instance'):
        db = services.get_calibration_db()
        get_bridge_service._instance = Step0Step1BridgeService(db)
    return get_bridge_service._instance

# ============================================================================
# 1. DATASET MANAGEMENT
# ============================================================================
@calibration_data_bp.route('/upload', methods=['POST'])
def upload_dataset():
    """Upload CSV dataset"""
    print("\n📤 [UPLOAD] Received upload request")
    
    if 'file' not in request.files:
        print("❌ [UPLOAD] No file in request")
        return jsonify({'success': False, 'error': 'No file provided'}), 400
    
    file = request.files['file']
    env_id = request.form.get('env_id')
    dataset_name = request.form.get('dataset_name')
    
    print(f"📊 [UPLOAD] env_id: {env_id}, dataset_name: {dataset_name}")
    
    if not file or not env_id:
        return jsonify({'success': False, 'error': 'File and env_id required'}), 400
    
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400
    
    filename = secure_filename(file.filename)
    print(f"📁 [UPLOAD] Filename: {filename}")
    
    with tempfile.NamedTemporaryFile(delete=False, suffix='.csv') as temp:
        file.save(temp.name)
        temp_path = temp.name
    
    try:
        result = get_dataset_manager().upload_dataset(
            env_id=env_id,
            file_path=temp_path,
            dataset_name=dataset_name,
            original_filename=filename
        )
        
        if result.get('success'):
            print(f"✅ [UPLOAD] Success: {result['dataset_id']}")
        else:
            print(f"❌ [UPLOAD] Failed: {result.get('error')}")
        
        return jsonify(result)
    except Exception as e:
        print(f"❌ [UPLOAD] Exception: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except:
            pass

@calibration_data_bp.route('/datasets', methods=['GET'])
def list_datasets():
    """List all datasets"""
    env_id = request.args.get('env_id')
    print(f"\n📋 [DATASETS] Listing for env: {env_id}")
    
    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400
    
    datasets = get_dataset_manager().list_datasets(env_id)
    print(f"✅ [DATASETS] Found {len(datasets)} dataset(s)")
    return jsonify({'success': True, 'datasets': datasets})

@calibration_data_bp.route('/dataset/<dataset_id>', methods=['GET'])
def get_dataset_info(dataset_id):
    """Get dataset info"""
    print(f"\n📊 [DATASET INFO] Getting info for: {dataset_id}")
    info = get_dataset_manager().get_dataset_info(dataset_id)
    
    if not info:
        print(f"❌ [DATASET INFO] Not found: {dataset_id}")
        return jsonify({'success': False, 'error': 'Dataset not found'}), 404
    
    print(f"✅ [DATASET INFO] Found: {info['dataset_name']}")
    return jsonify({'success': True, 'dataset': info})

@calibration_data_bp.route('/dataset/<dataset_id>/preview', methods=['GET'])
def get_dataset_preview(dataset_id):
    """Get dataset preview"""
    limit = int(request.args.get('limit', 100))
    print(f"\n👁️ [PREVIEW] Getting preview for: {dataset_id} (limit: {limit})")
    
    result = get_dataset_manager().get_preview(dataset_id, limit)
    
    if result.get('success'):
        print(f"✅ [PREVIEW] Returned {result.get('row_count')} rows")
    
    return jsonify(result)

@calibration_data_bp.route('/dataset/<dataset_id>/rename', methods=['POST'])
def rename_dataset(dataset_id):
    """Rename dataset"""
    data = request.get_json()
    new_name = data.get('new_name')
    
    print(f"\n✏️ [RENAME] Renaming {dataset_id} to '{new_name}'")
    
    if not new_name:
        return jsonify({'success': False, 'error': 'new_name required'}), 400
    
    result = get_dataset_manager().rename_dataset(dataset_id, new_name)
    
    if result.get('success'):
        print(f"✅ [RENAME] Success")
    
    return jsonify(result)

@calibration_data_bp.route('/dataset/<dataset_id>', methods=['DELETE'])
def delete_dataset(dataset_id):
    """Delete dataset"""
    print(f"\n🗑️ [DELETE] Deleting dataset: {dataset_id}")
    
    result = get_dataset_manager().delete_dataset(dataset_id)
    
    if result.get('success'):
        print(f"✅ [DELETE] Dataset deleted")
    
    return jsonify(result)

# ============================================================================
# 2. SCHEMA MANAGEMENT
# ============================================================================
@calibration_data_bp.route('/schema/<dataset_id>', methods=['GET'])
def get_schema(dataset_id):
    """Get schema"""
    env_id = request.args.get('env_id')
    print(f"\n📋 [SCHEMA] Getting schema for: {dataset_id}")
    
    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400
    
    result = get_schema_service().get_effective_schema(env_id, dataset_id)
    
    if result.get('success'):
        print(f"✅ [SCHEMA] Found {len(result.get('columns', []))} columns")
    
    return jsonify(result)

@calibration_data_bp.route('/schema/<dataset_id>/infer', methods=['POST'])
def infer_schema(dataset_id):
    """Infer schema"""
    data = request.get_json()
    env_id = data.get('env_id')
    
    print(f"\n🔍 [SCHEMA INFER] Inferring for: {dataset_id}")
    
    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400
    
    result = get_schema_service().infer_schema(env_id, dataset_id)
    return jsonify(result)

@calibration_data_bp.route('/schema/<dataset_id>/override', methods=['POST'])
def save_type_override(dataset_id):
    """Save type override"""
    data = request.get_json()
    env_id = data.get('env_id')
    column_name = data.get('column_name')
    new_type = data.get('new_type')
    
    print(f"\n✏️ [SCHEMA OVERRIDE] {dataset_id}.{column_name} → {new_type}")
    
    if not all([env_id, column_name, new_type]):
        return jsonify({'success': False, 'error': 'env_id, column_name, and new_type required'}), 400
    
    result = get_schema_service().save_type_override(env_id, dataset_id, column_name, new_type)
    return jsonify(result)

@calibration_data_bp.route('/schema/<dataset_id>/reset', methods=['POST'])
def reset_overrides(dataset_id):
    """Reset overrides"""
    print(f"\n🔄 [SCHEMA RESET] Resetting overrides for: {dataset_id}")
    
    result = get_schema_service().reset_overrides(dataset_id)
    return jsonify(result)

@calibration_data_bp.route('/schema/join-suggestions', methods=['POST'])
def get_join_suggestions():
    """Get join suggestions"""
    data = request.get_json()
    env_id = data.get('env_id')
    left_dataset_id = data.get('left_dataset_id')
    right_dataset_id = data.get('right_dataset_id')
    
    print(f"\n🤖 [JOIN SUGGEST] Finding joins between {left_dataset_id} and {right_dataset_id}")
    
    if not all([env_id, left_dataset_id, right_dataset_id]):
        return jsonify({'success': False, 'error': 'Missing required parameters'}), 400
    
    result = get_schema_service().get_join_compatible_columns(env_id, left_dataset_id, right_dataset_id)
    
    if result.get('success'):
        print(f"✅ [JOIN SUGGEST] Found {len(result.get('suggestions', []))} suggestion(s)")
    
    return jsonify(result)

# ============================================================================
# 3. MERGE OPERATIONS
# ============================================================================
@calibration_data_bp.route('/merge/preview', methods=['POST'])
def preview_merge():
    """Generate merge preview"""
    print("\n🔍 [ROUTE] Merge preview request")
    data = request.json
    
    try:
        result = get_logical_merge_service().generate_preview(
            data.get('env_id'), 
            data.get('chain')
        )
        return jsonify(result)
    except Exception as e:
        print(f"❌ [ROUTE] Preview failed: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@calibration_data_bp.route('/merge/suggest', methods=['POST'])
def suggest_join_chain():
    """AI-powered join suggestion"""
    data = request.get_json()
    env_id = data.get('env_id')
    dataset_ids = data.get('dataset_ids', [])
    
    print(f"\n🤖 [ROUTE] Suggesting chain for {len(dataset_ids)} datasets")
    
    if not all([env_id, dataset_ids]):
        return jsonify({'success': False, 'error': 'env_id and dataset_ids required'}), 400
    
    result = get_logical_merge_service().suggest_join_chain(env_id, dataset_ids)
    return jsonify(result)

@calibration_data_bp.route('/merge/plan', methods=['POST'])
def create_join_plan():
    """Save join plan"""
    print("\n💾 [ROUTE] Save join plan request")
    data = request.get_json()
    env_id = data.get('env_id')
    plan_name = data.get('plan_name')
    chain = data.get('chain', [])
    
    print(f"📊 [ROUTE] Plan: '{plan_name}', Chain: {len(chain)} steps")
    
    if not all([env_id, plan_name, chain]):
        return jsonify({'success': False, 'error': 'env_id, plan_name, and chain required'}), 400
    
    result = get_logical_merge_service().create_join_plan(env_id, plan_name, chain)
    return jsonify(result)

@calibration_data_bp.route('/merge/plans', methods=['GET'])
def list_join_plans():
    """List saved plans"""
    env_id = request.args.get('env_id')
    print(f"\n📋 [ROUTE] List plans for env: {env_id}")
    
    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400
    
    plans = get_logical_merge_service().list_join_plans(env_id)
    return jsonify({'success': True, 'plans': plans})

@calibration_data_bp.route('/merge/plan/<plan_id>', methods=['GET'])
def get_join_plan(plan_id):
    """Get specific plan"""
    print(f"\n📥 [ROUTE] Get plan: {plan_id}")
    result = get_logical_merge_service().get_join_plan(plan_id)
    return jsonify(result)

@calibration_data_bp.route('/merge/plan/<plan_id>/load', methods=['GET'])
def load_join_plan(plan_id):
    """Load plan"""
    print(f"\n📥 [ROUTE] Load plan: {plan_id}")
    result = get_logical_merge_service().get_join_plan(plan_id)
    
    if result['success']:
        return jsonify({
            'success': True,
            'plan': result['plan']
        })
    return jsonify(result), 404

@calibration_data_bp.route('/merge/plan/<plan_id>', methods=['DELETE'])
def delete_join_plan(plan_id):
    """Delete plan"""
    print(f"\n🗑️ [ROUTE] Delete plan: {plan_id}")
    result = get_logical_merge_service().delete_join_plan(plan_id)
    return jsonify(result)

@calibration_data_bp.route('/merge/save', methods=['POST'])
def save_merge_plan():
    """Save merge plan (alias)"""
    data = request.json
    print("\n💾 [ROUTE] Save merge plan (alias)")
    
    try:
        result = get_logical_merge_service().save_plan(
            data.get('env_id'),
            data.get('chain'),
            data.get('name')
        )
        return jsonify(result)
    except Exception as e:
        print(f"❌ [ROUTE] Save failed: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================================
# 4. SQL EXECUTION
# ============================================================================
@calibration_data_bp.route('/sql/execute', methods=['POST'])
def execute_sql():
    """Execute SQL"""
    data = request.get_json()
    env_id = data.get('env_id')
    sql = data.get('sql')
    limit = data.get('limit', 100)
    
    print(f"\n💻 [SQL] Executing query (limit: {limit})")
    
    if not all([env_id, sql]):
        return jsonify({'success': False, 'error': 'env_id and sql required'}), 400
    
    result = get_sql_execution_service().execute_sql_preview(env_id, sql, limit)
    return jsonify(result)

@calibration_data_bp.route('/sql/validate', methods=['POST'])
def validate_sql():
    """Validate SQL"""
    data = request.get_json()
    env_id = data.get('env_id')
    sql = data.get('sql')
    
    print("\n✅ [SQL] Validating query")
    
    if not all([env_id, sql]):
        return jsonify({'success': False, 'error': 'env_id and sql required'}), 400
    
    result = get_sql_execution_service().validate_sql(env_id, sql)
    return jsonify(result)

@calibration_data_bp.route('/sql/table-info/<table_name>', methods=['GET'])
def get_table_info(table_name):
    """Get table info"""
    env_id = request.args.get('env_id')
    
    print(f"\n📊 [SQL] Getting table info: {table_name}")
    
    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400
    
    result = get_sql_execution_service().get_table_info(env_id, table_name)
    return jsonify(result)

# ============================================================================
# 5. READINESS & VALIDATION
# ============================================================================
@calibration_data_bp.route('/readiness', methods=['GET'])
def check_readiness():
    """Check readiness"""
    env_id = request.args.get('env_id')
    print(f"\n🔒 [ROUTE] Check readiness for env: {env_id}")
    
    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400
    
    result = get_step0_readiness_service().check_readiness(env_id)
    print(f"✅ [ROUTE] Readiness: {result.get('ready')}")
    return jsonify(result)

@calibration_data_bp.route('/readiness/validate-plan', methods=['POST'])
def validate_plan():
    """Validate join plan"""
    data = request.get_json()
    env_id = data.get('env_id')
    chain = data.get('chain', [])
    
    print(f"\n✅ [ROUTE] Validating join plan")
    
    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400
    
    result = get_step0_readiness_service().validate_join_plan(env_id, chain)
    return jsonify(result)

@calibration_data_bp.route('/readiness/mark-complete', methods=['POST'])
def mark_step_complete():
    """Mark step complete"""
    data = request.get_json()
    env_id = data.get('env_id')
    step_name = data.get('step_name')
    
    print(f"\n✅ [ROUTE] Marking step complete: {step_name}")
    
    if not all([env_id, step_name]):
        return jsonify({'success': False, 'error': 'env_id and step_name required'}), 400
    
    result = get_step0_readiness_service().mark_step_complete(env_id, step_name)
    return jsonify(result)

@calibration_data_bp.route('/validation/preview', methods=['GET'])
def get_validation_preview():
    """Get validation preview data"""
    env_id = request.args.get('env_id')
    print(f"\n🎯 [ROUTE] Validation preview for env: {env_id}")
    
    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400
    
    try:
        # Get readiness
        readiness_service = get_step0_readiness_service()
        readiness = readiness_service.check_readiness(env_id)
        
        # Get active plan
        merge_service = get_logical_merge_service()
        plans = merge_service.list_join_plans(env_id)
        
        active_plan = None
        if plans:
            latest_plan = plans[0]
            plan_detail = merge_service.get_join_plan(latest_plan['plan_id'])
            if plan_detail['success']:
                active_plan = plan_detail['plan']
                
                # Generate preview
                preview = merge_service.generate_preview(env_id, active_plan['chain'])
                if preview['success']:
                    active_plan['preview'] = preview['preview']
        
        # Get datasets
        dataset_manager = get_dataset_manager()
        datasets = dataset_manager.list_datasets(env_id)
        
        # Summary stats
        total_rows = sum(d.get('row_count', 0) for d in datasets)
        total_cols = 0
        for dataset in datasets:
            info = dataset_manager.get_dataset_info(dataset['id'])
            if info:
                total_cols += info.get('column_count', 0)
        
        result = {
            'success': True,
            'readiness': readiness,
            'active_plan': active_plan,
            'summary': {
                'datasets': len(datasets),
                'total_rows': total_rows,
                'total_columns': total_cols,
                'join_plans': len(plans)
            },
            'datasets': datasets
        }
        
        print(f"✅ [ROUTE] Validation data prepared")
        return jsonify(result)
        
    except Exception as e:
        print(f"❌ [ROUTE] Validation preview failed: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================================
# 6. STEP 0 COMPLETION
# ============================================================================
@calibration_data_bp.route('/complete-step0', methods=['POST'])
def complete_step0():
    """
    Complete Step 0 and create logical view for Step 1
    **FIXED: Properly pass join_plan_id and dataset_mapping to bridge service**
    """
    print("\n🎯 [ROUTE] Step 0 completion request")
    
    # ✅ FIX: Get env_id from query params (as used in the request)
    env_id = request.args.get('env_id')
    data = request.get_json() or {}
    
    # ✅ FIX: Extract both parameters correctly
    dataset_mapping = data.get('dataset_mapping')
    join_plan_id = data.get('join_plan_id')
    
    print(f"📊 [ROUTE] env_id: {env_id}")
    print(f"📊 [ROUTE] dataset_mapping: {dataset_mapping}")
    print(f"📊 [ROUTE] join_plan_id: {join_plan_id}")
    
    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400
    
    try:
        # Auto-detect mapping if using join plan
        if join_plan_id and not dataset_mapping:
            print(f"🔍 [ROUTE] Auto-detecting mapping from plan: {join_plan_id}")
            merge_service = get_logical_merge_service()
            plan_result = merge_service.get_join_plan(join_plan_id)
            
            if not plan_result['success']:
                return jsonify({'success': False, 'error': 'Invalid join plan'}), 400
            
            # Extract dataset IDs from chain
            chain = plan_result['plan']['chain']
            dataset_ids = [step.get('dataset_id') or step.get('datasetId') for step in chain]
            dataset_mapping = _auto_detect_mapping(env_id, dataset_ids)
            print(f"✅ [ROUTE] Auto-detected mapping: {dataset_mapping}")
        
        if not dataset_mapping:
            return jsonify({'success': False, 'error': 'dataset_mapping or join_plan_id required'}), 400
        
        # Validate - only transactions is truly required
        if 'transactions' not in dataset_mapping:
            return jsonify({
                'success': False,
                'error': 'transactions dataset is required'
            }), 400
        
        # ✅ FIX: Call bridge service with BOTH parameters properly
        print(f"🔗 [ROUTE] Materializing canonical view...")
        bridge = get_bridge_service()
        result = bridge.materialize_for_step1(
            env_id=env_id,
            join_plan_id=join_plan_id,      # ✅ UUID string or None
            dataset_mapping=dataset_mapping  # ✅ Dict or None
        )
        
        if not result['success']:
            print(f"❌ [ROUTE] Materialization failed: {result.get('error')}")
            return jsonify(result), 400
        
        # Mark Step 0 complete
        print(f"✅ [ROUTE] Marking Step 0 complete...")
        readiness_service = get_step0_readiness_service()
        readiness_service.mark_step_complete(env_id, 'step0')
        
        # Check Step 1 readiness
        step1_readiness = bridge.check_step1_readiness(env_id)
        
        print(f"✅ [ROUTE] Step 0 COMPLETE! View: {result['view_created']}")
        
        return jsonify({
            'success': True,
            'step0_complete': True,
            'step1_ready': step1_readiness['ready'],
            'view_created': result['view_created'],
            'row_count': result['row_count'],
            'message': result.get('message', 'Step 0 complete. Ready for Population Extraction.')
        }), 200
        
    except Exception as e:
        print(f"❌ [ROUTE] Step 0 completion failed: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
@calibration_data_bp.route('/step0-status', methods=['GET'])
def get_step0_status():
    """Get Step 0 status"""
    env_id = request.args.get('env_id')
    print(f"\n📊 [ROUTE] Getting Step 0 status for: {env_id}")
    
    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400
    
    try:
        readiness_service = get_step0_readiness_service()
        readiness = readiness_service.check_readiness(env_id)
        
        bridge = get_bridge_service()
        step1_readiness = bridge.check_step1_readiness(env_id)
        
        dataset_options = bridge.get_dataset_selector_options(env_id)
        
        return jsonify({
            'success': True,
            'step0_complete': readiness['ready'],
            'step1_ready': step1_readiness['ready'],
            'checks': readiness['checks'],
            'blockers': readiness['blockers'],
            'warnings': readiness['warnings'],
            'dataset_options': dataset_options.get('suggestions', {}),
            'table_info': step1_readiness.get('table_info', {})
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================================
# 7. HELPER ROUTES
# ============================================================================
@calibration_data_bp.route('/stats', methods=['GET'])
def get_data_stats():
    """Get data stats"""
    env_id = request.args.get('env_id')
    
    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400

    try:
        readiness_service = get_step0_readiness_service()
        summary = readiness_service._get_summary(env_id)
        
        return jsonify({'success': True, 'stats': summary})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@calibration_data_bp.route('/mapping/options', methods=['GET'])
def get_mapping_options():
    """Get mapping options"""
    env_id = request.args.get('env_id')
    
    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400

    try:
        datasets = get_dataset_manager().list_datasets(env_id)
        
        return jsonify({
            'success': True,
            'dataset_options': {
                'transactions': datasets,
                'customers': datasets,
                'accounts': datasets
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@calibration_data_bp.route('/mapping', methods=['GET'])
def get_dataset_mapping():
    """Get dataset mapping"""
    env_id = request.args.get('env_id')
    
    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400

    try:
        return jsonify({
            'success': True,
            'mapping': {
                'transactions': None,
                'customers': None,
                'accounts': None
            },
            'is_complete': False
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@calibration_data_bp.route('/upload-str', methods=['POST'])
def upload_str_data():
    """Upload STR"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400
    
    file = request.files['file']
    env_id = request.form.get('env_id') or request.args.get('env_id')
    
    if not file or not env_id:
        return jsonify({'success': False, 'error': 'File and env_id required'}), 400
    
    filename = secure_filename(file.filename)
    
    with tempfile.NamedTemporaryFile(delete=False, suffix='.csv') as temp:
        file.save(temp.name)
        temp_path = temp.name
    
    try:
        result = get_dataset_manager().upload_dataset(
            env_id=env_id,
            file_path=temp_path,
            dataset_name="STR_Data", 
            original_filename=filename
        )
        
        return jsonify({
            'success': True,
            'message': 'STR data uploaded',
            'dataset_id': result['dataset_id'],
            'row_count': result['row_count']
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except:
                pass

@calibration_data_bp.route('/str-stats', methods=['GET'])
def get_str_stats():
    """Get STR stats"""
    env_id = request.args.get('env_id')

    if not env_id:
        return jsonify({'success': False, 'error': 'env_id required'}), 400

    try:
        manager = get_dataset_manager()
        datasets = manager.list_datasets(env_id)
        
        # Find first dataset with 'STR' in its name
        str_dataset = next((d for d in datasets if 'STR' in d['name'].upper()), None)
        
        if str_dataset:
            return jsonify({
                'success': True,
                'str_count': str_dataset['row_count'],
                'uploaded': True,
                'last_upload': str_dataset['uploaded_at']
            })
        else:
            return jsonify({
                'success': True,
                'str_count': 0,
                'uploaded': False
            })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _auto_detect_mapping(env_id, dataset_ids):
    """Auto-detect dataset roles based on filename keywords"""
    manager = get_dataset_manager()
    datasets = manager.list_datasets(env_id)

    mapping = {}
    for ds_id in dataset_ids:
        ds = next((d for d in datasets if d['id'] == ds_id), None)
        if not ds:
            continue
            
        name_lower = ds['name'].lower()
        
        if any(kw in name_lower for kw in ['transaction', 'txn', 'trans']):
            mapping['transactions'] = ds_id
        elif any(kw in name_lower for kw in ['customer', 'client', 'cust']):
            mapping['customers'] = ds_id
        elif any(kw in name_lower for kw in ['account', 'acc']):
            mapping['accounts'] = ds_id
            
    return mapping
@calibration_data_bp.route('/debug/step1-data', methods=['GET'])
def debug_step1_data():
    """Debug endpoint to check Step 1 readiness"""
    env_id = request.args.get('env_id')
    
    if not env_id:
        return jsonify({'error': 'env_id required'}), 400
    
    db = services.get_calibration_db()
    conn = db.connect()
    cursor = conn.cursor()
    
    try:
        view_name = f"{env_id}_calibration_data"
        
        # 1. Check if view exists
        cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='view' AND name=?
        """, (view_name,))
        view_exists = cursor.fetchone() is not None
        
        # 2. Get view columns
        view_columns = []
        if view_exists:
            cursor.execute(f'SELECT * FROM "{view_name}" LIMIT 1')
            view_columns = [desc[0] for desc in cursor.description]
        
        # 3. Get schema mapping
        cursor.execute("""
            SELECT mapping_config FROM schema_mappings
            WHERE env_id = ? AND mapping_type = 'golden_source'
        """, (env_id,))
        
        mapping_row = cursor.fetchone()
        schema_mapping = json.loads(mapping_row[0]) if mapping_row else None
        
        # 4. Get sample data
        sample_data = None
        if view_exists:
            df = pd.read_sql(f'SELECT * FROM "{view_name}" LIMIT 5', conn)
            sample_data = df.to_dict('records')
        
        return jsonify({
            'success': True,
            'view_exists': view_exists,
            'view_name': view_name,
            'view_columns': view_columns,
            'schema_mapping': schema_mapping,
            'sample_data': sample_data
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()