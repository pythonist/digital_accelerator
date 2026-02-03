"""
API Routes for Data Connector Management
File: api/routes/connectors.py
"""
from flask import Blueprint, request, jsonify
from api.middleware.auth_middleware import require_auth
from api.services import services
from api.utils import handle_errors
from connectors import ConnectorManager, EXAMPLE_CONNECTORS
import traceback

connectors_bp = Blueprint('connectors', __name__)

def get_connector_manager():
    """Get ConnectorManager for current environment"""
    if not services.metadata_manager or not services.metadata_manager.active_env:
        raise Exception("No active environment. Please select an environment first.")
    
    env_path = services.metadata_manager.get_env_path()
    return ConnectorManager(env_path)

# ==================== CONNECTOR CRUD ====================

@connectors_bp.route('/connectors', methods=['GET'])
@require_auth()
@handle_errors
def list_connectors():
    """
    List all connectors for current environment.
    Query params:
        - entity_type: Optional filter
    """
    entity_type = request.args.get('entity_type')
    
    manager = get_connector_manager()
    connectors = manager.list_connectors(entity_type=entity_type)
    
    return jsonify({
        'success': True,
        'connectors': connectors,
        'count': len(connectors)
    })

@connectors_bp.route('/connectors', methods=['POST'])
@require_auth('TENANT_ADMIN')  # Only admins can create connectors
@handle_errors
def create_connector():
    """
    Create a new connector.
    Requires TENANT_ADMIN role.
    """
    config = request.json
    
    if not config:
        return jsonify({'error': 'Connector configuration required'}), 400
    
    manager = get_connector_manager()
    
    try:
        connector = manager.create_connector(config)
        return jsonify({
            'success': True,
            'connector': connector,
            'message': 'Connector created successfully'
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

@connectors_bp.route('/connectors/<connector_id>', methods=['GET'])
@require_auth()
@handle_errors
def get_connector(connector_id):
    """Get connector by ID"""
    manager = get_connector_manager()
    
    try:
        connector = manager.get_connector(connector_id)
        return jsonify({
            'success': True,
            'connector': connector
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 404

@connectors_bp.route('/connectors/<connector_id>', methods=['PUT'])
@require_auth('TENANT_ADMIN')
@handle_errors
def update_connector(connector_id):
    """Update connector configuration"""
    updates = request.json
    
    if not updates:
        return jsonify({'error': 'Updates required'}), 400
    
    manager = get_connector_manager()
    
    try:
        connector = manager.update_connector(connector_id, updates)
        return jsonify({
            'success': True,
            'connector': connector,
            'message': 'Connector updated successfully'
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

@connectors_bp.route('/connectors/<connector_id>', methods=['DELETE'])
@require_auth('TENANT_ADMIN')
@handle_errors
def delete_connector(connector_id):
    """Delete a connector"""
    manager = get_connector_manager()
    
    try:
        manager.delete_connector(connector_id)
        return jsonify({
            'success': True,
            'message': 'Connector deleted successfully'
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 404

# ==================== CONNECTOR OPERATIONS ====================

@connectors_bp.route('/connectors/<connector_id>/test', methods=['POST'])
@require_auth()
@handle_errors
def test_connector(connector_id):
    """
    Test connector connection.
    Returns connection status and details.
    """
    manager = get_connector_manager()
    
    try:
        result = manager.test_connector(connector_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Test failed: {str(e)}'
        }), 500

@connectors_bp.route('/connectors/<connector_id>/preview', methods=['GET'])
@require_auth()
@handle_errors
def preview_connector_schema(connector_id):
    """
    Get schema preview from connector.
    Returns columns and sample rows without full data fetch.
    """
    manager = get_connector_manager()
    
    try:
        preview = manager.get_connector_preview(connector_id)
        return jsonify({
            'success': True,
            'preview': preview
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@connectors_bp.route('/connectors/<connector_id>/execute', methods=['POST'])
@require_auth('TENANT_ADMIN')  # Only admins can execute
@handle_errors
def execute_connector(connector_id):
    """
    Execute connector and ingest data.
    This fetches data from source and loads it into the investigation database.
    """
    params = request.json or {}
    
    manager = get_connector_manager()
    
    try:
        # 1. Fetch data using connector
        print(f"🔄 Executing connector: {connector_id}")
        df = manager.execute_connector(connector_id, params)
        
        if df.empty:
            return jsonify({
                'success': False,
                'error': 'No data returned from connector'
            }), 400
        
        # 2. Get connector config to determine entity type
        config = manager.get_connector(connector_id)
        entity_type = config.get('entity_type', 'unknown')
        table_name = entity_type  # Use entity type as table name
        
        # 3. Load into database using existing ingestion service
        if not services.data_ingestion:
            return jsonify({
                'error': 'Data ingestion service not initialized'
            }), 500
        
        # Use the same dynamic schema handling as CSV uploads
        services.investigation_db.bulk_insert_table(table_name, df)
        
        # 4. Update registry
        services.metadata_manager.save_schema(
            table_name=table_name,
            columns=list(df.columns),
            row_count=len(df)
        )
        
        return jsonify({
            'success': True,
            'message': f'Ingested {len(df)} rows into {table_name}',
            'details': {
                'connector_id': connector_id,
                'connector_name': config.get('name'),
                'entity_type': entity_type,
                'rows_ingested': len(df),
                'columns': df.columns.tolist()
            }
        })
        
    except Exception as e:
        print(f"❌ Connector execution failed: {e}")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': f'Execution failed: {str(e)}'
        }), 500

# ==================== CONNECTOR STATISTICS ====================

@connectors_bp.route('/connectors/stats', methods=['GET'])
@require_auth()
@handle_errors
def get_connector_stats():
    """Get connector statistics for current environment"""
    manager = get_connector_manager()
    stats = manager.get_connector_stats()
    
    return jsonify({
        'success': True,
        'stats': stats
    })

# ==================== CONNECTOR TEMPLATES ====================

@connectors_bp.route('/connectors/templates', methods=['GET'])
@require_auth()
def get_connector_templates():
    """
    Get example connector templates for reference.
    Helps users configure Oracle/DB2/SQL Server connectors.
    """
    return jsonify({
        'success': True,
        'templates': EXAMPLE_CONNECTORS,
        'supported_databases': ['oracle', 'db2', 'sqlserver', 'postgres']
    })