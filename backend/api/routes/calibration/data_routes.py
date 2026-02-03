# backend/api/routes/calibration/data_routes.py
"""
Data Management Routes - STEP 0
Handles CSV uploads, Schema Mapping, Join Validation, and Data Readiness
"""
from flask import Blueprint, request, jsonify
from api.services import services
import traceback
import json

data_bp = Blueprint('calibration_data', __name__)

print("📦 data_routes.py loaded - Blueprint name: calibration_data")

# =========================================================
# UPLOAD & STATS (EXISTING - KEEP AS IS)
# =========================================================

@data_bp.route('/upload', methods=['POST'])
def upload_data():
    """Upload CSV file"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        table_name = request.form.get('table_name')
        env_id = request.args.get('env_id') or request.form.get('env_id')
        
        if not table_name or not env_id:
            return jsonify({'error': 'table_name and env_id required'}), 400
        
        import os
        import uuid
        temp_dir = f"data/calibration/{env_id}/uploads"
        os.makedirs(temp_dir, exist_ok=True)
        
        file_path = os.path.join(temp_dir, f"{table_name}_{uuid.uuid4().hex[:8]}.csv")
        file.save(file_path)
        
        ingestion_service = services.get_calibration_ingestion(env_id)
        if not ingestion_service:
            return jsonify({'error': 'Calibration ingestion service not available'}), 500
        
        stats = ingestion_service.load_csv_to_db(file_path, table_name, env_id)
        
        # Update readiness status
        readiness_service = services.get_data_readiness_service()
        readiness_service.update_upload_status(env_id, table_name)
        
        return jsonify({'success': True, 'stats': stats})
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@data_bp.route('/stats', methods=['GET'])
def get_data_stats():
    """Get row counts and readiness status"""
    try:
        env_id = request.args.get('env_id')
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        ingestion_service = services.get_calibration_ingestion(env_id)
        stats = ingestion_service.get_table_stats(env_id)
        
        # Get validation results if available
        validation_service = services.get_join_validation_service()
        join_report = validation_service.get_validation_results(env_id)
        
        # Get readiness status
        readiness_service = services.get_data_readiness_service()
        readiness = readiness_service.check_readiness(env_id)
        
        return jsonify({
            'success': True,
            'stats': stats,
            'join_report': join_report,
            'readiness': readiness
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@data_bp.route('/preview', methods=['GET'])
def preview_data():
    """Preview uploaded table"""
    try:
        env_id = request.args.get('env_id')
        table = request.args.get('table')
        limit = int(request.args.get('limit', 100))
        
        from calibration.services import DataPreviewService
        db_manager = services.get_calibration_db()
        preview_service = DataPreviewService(db_manager)
        
        preview = preview_service.get_table_preview(env_id, table, limit)
        if not preview:
            return jsonify({'error': 'Table not found'}), 404
        
        return jsonify({
            'success': True,
            'columns': preview['columns'],
            'data': preview['rows'],
            'total_count': preview['total_count']
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# =========================================================
# SCHEMA MAPPING
# =========================================================

@data_bp.route('/mapping/options', methods=['GET'])
def get_mapping_options():
    """Get available source columns for mapping dropdowns"""
    try:
        env_id = request.args.get('env_id')
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        ingestion_service = services.get_calibration_ingestion(env_id)
        schema_info = ingestion_service.get_environment_schema(env_id)
        
        canonical_fields = {
            'transactions': [
                {'key': 'transaction_id', 'label': 'Transaction ID (PK)', 'required': True},
                {'key': 'account_id', 'label': 'Account ID (FK)', 'required': True},
                {'key': 'transaction_date', 'label': 'Date', 'required': True},
                {'key': 'transaction_amount', 'label': 'Amount', 'required': True},
                {'key': 'transaction_type', 'label': 'Type', 'required': False},
                {'key': 'transaction_category', 'label': 'Category', 'required': False},
                {'key': 'transaction_direction', 'label': 'Direction (Credit/Debit)', 'required': False},
            ],
            'accounts': [
                {'key': 'account_id', 'label': 'Account ID (PK)', 'required': True},
                {'key': 'customer_id', 'label': 'Customer ID (FK)', 'required': True},
                {'key': 'account_type', 'label': 'Account Type', 'required': False},
                {'key': 'account_open_date', 'label': 'Open Date', 'required': False},
                {'key': 'account_status', 'label': 'Status', 'required': False},
            ],
            'customers': [
                {'key': 'customer_id', 'label': 'Customer ID (PK)', 'required': True},
                {'key': 'customer_type', 'label': 'Type (Ind/Corp)', 'required': False},
                {'key': 'risk_rating', 'label': 'Risk Rating', 'required': False},
                {'key': 'kyc_status', 'label': 'KYC Status', 'required': False},
                {'key': 'pep_flag', 'label': 'PEP Flag', 'required': False},
            ]
        }
        
        return jsonify({
            'success': True,
            'source_columns': schema_info,
            'canonical_fields': canonical_fields
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@data_bp.route('/mapping', methods=['GET', 'POST'])
def handle_mapping():
    """Get or Save Schema Mapping"""
    try:
        db = services.get_calibration_db()
        conn = db.connect()
        cursor = conn.cursor()
        
        if request.method == 'GET':
            env_id = request.args.get('env_id')
            if not env_id:
                return jsonify({'error': 'env_id required'}), 400
                
            cursor.execute("""
                SELECT mapping_config FROM schema_mappings 
                WHERE env_id = ? AND mapping_type = 'golden_source'
            """, (env_id,))
            row = cursor.fetchone()
            conn.close()
            
            return jsonify({
                'success': True,
                'mapping': json.loads(row[0]) if row else None
            })
            
        elif request.method == 'POST':
            data = request.get_json()
            env_id = data.get('env_id')
            mapping = data.get('mapping')
            
            if not env_id or not mapping:
                return jsonify({'error': 'env_id and mapping required'}), 400
            
            cursor.execute("""
                INSERT OR REPLACE INTO schema_mappings 
                (env_id, mapping_type, mapping_config, updated_at)
                VALUES (?, 'golden_source', ?, CURRENT_TIMESTAMP)
            """, (env_id, json.dumps(mapping)))
            
            conn.commit()
            conn.close()
            
            # Update readiness
            readiness_service = services.get_data_readiness_service()
            readiness_service.update_mapping_status(env_id, completed=True)
            
            return jsonify({'success': True, 'message': 'Mapping saved successfully'})
            
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# =========================================================
# JOIN VALIDATION (NEW - STEP 0)
# =========================================================

@data_bp.route('/validate-joins', methods=['POST'])
def validate_joins():
    """Execute dry-run join validation"""
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        validation_service = services.get_join_validation_service()
        result = validation_service.validate_joins(env_id)
        
        # Update readiness
        readiness_service = services.get_data_readiness_service()
        readiness_service.update_validation_status(env_id, validated=True)
        
        return jsonify({
            'success': True,
            **result
        })
        
    except ValueError as ve:
        return jsonify({'error': str(ve), 'code': 'VALIDATION_ERROR'}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@data_bp.route('/validation-results', methods=['GET'])
def get_validation_results():
    """Get cached join validation results"""
    try:
        env_id = request.args.get('env_id')
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        validation_service = services.get_join_validation_service()
        results = validation_service.get_validation_results(env_id)
        
        return jsonify({
            'success': True,
            'validation_results': results
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# =========================================================
# DATA READINESS (NEW - STEP 0)
# =========================================================

@data_bp.route('/readiness', methods=['GET'])
def get_readiness():
    """Check data readiness status"""
    try:
        env_id = request.args.get('env_id')
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        readiness_service = services.get_data_readiness_service()
        readiness = readiness_service.check_readiness(env_id)
        
        return jsonify({
            'success': True,
            **readiness
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# =========================================================
# GOLDEN DATASET (DISABLED FOR STEP 0 - DEFERRED TO STEP 1)
# =========================================================

@data_bp.route('/build-golden', methods=['POST'])
def build_golden_dataset():
    """DISABLED: Golden dataset building moved to STEP 1"""
    return jsonify({
        'error': 'Golden dataset building is not part of STEP 0. Complete data validation first, then proceed to Scenario Definition.',
        'code': 'FEATURE_DEFERRED'
    }), 400

@data_bp.route('/golden-preview', methods=['GET'])
def preview_golden():
    """DISABLED: No golden dataset exists in STEP 0"""
    return jsonify({
        'error': 'Golden dataset does not exist in STEP 0. Validation results are available via /validate-joins.',
        'code': 'FEATURE_DEFERRED'
    }), 400

@data_bp.route('/upload-str', methods=['POST'])
def upload_str_data():
    """
    Upload STR CSV file
    
    POST /api/v2/calibration/data/upload-str
    Form Data:
        - file: CSV file with columns: str_id, account_id, str_filed_date
        - env_id: environment identifier
    
    CRITICAL: STR data is stored but NOT used until Step 3 evaluation
    """
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        env_id = request.args.get('env_id') or request.form.get('env_id')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        import os
        import uuid
        temp_dir = f"data/calibration/{env_id}/uploads"
        os.makedirs(temp_dir, exist_ok=True)
        
        file_path = os.path.join(temp_dir, f"str_{uuid.uuid4().hex[:8]}.csv")
        file.save(file_path)
        
        # Ingest STR data
        ingestion_service = services.get_calibration_ingestion(env_id)
        result = ingestion_service.ingest_str_data(file_path, env_id)
        
        return jsonify({
            'success': True,
            'message': 'STR data uploaded successfully',
            **result
        })
        
    except ValueError as ve:
        return jsonify({'error': str(ve), 'code': 'VALIDATION_ERROR'}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@data_bp.route('/str-stats', methods=['GET'])
def get_str_stats():
    """
    Get STR data statistics
    
    GET /api/v2/calibration/data/str-stats?env_id=xxx
    """
    try:
        env_id = request.args.get('env_id')
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        db = services.get_calibration_db()
        conn = db.connect()
        cursor = conn.cursor()
        
        # Total STRs
        cursor.execute("SELECT COUNT(*) FROM strs")
        total = cursor.fetchone()[0]
        
        # Unique accounts
        cursor.execute("SELECT COUNT(DISTINCT account_id) FROM strs")
        unique_accounts = cursor.fetchone()[0]
        
        # Date range
        cursor.execute("SELECT MIN(str_filed_date), MAX(str_filed_date) FROM strs")
        date_range = cursor.fetchone()
        
        conn.close()
        
        return jsonify({
            'success': True,
            'str_count': total,
            'unique_accounts': unique_accounts,
            'date_range': {
                'start': date_range[0] if date_range[0] else None,
                'end': date_range[1] if date_range[1] else None
            },
            'uploaded': total > 0
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500