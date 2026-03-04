# backend/api/routes/environment.py (FIX for /env/create)
"""
Environment Routes: FIXED to accept both body and query params
"""
from flask import Blueprint, request, jsonify
from api.service_locator import services
from api.middleware.auth_middleware import require_auth
import shutil
import os
import json

env_bp = Blueprint('env', __name__)

ENV_FILE = 'data/environments.json'

def get_legacy_envs(tenant_id):
    """Fallback to read from environments.json for legacy compatibility"""
    if not os.path.exists(ENV_FILE):
        return []
    try:
        with open(ENV_FILE, 'r') as f:
            data = json.load(f)
            return [
                v['name'] for k, v in data.items() 
                if v.get('tenant_id') == tenant_id
            ]
    except:
        return []

@env_bp.route('/env/list', methods=['GET'])
@require_auth()
def list_envs():
    """List all environments for the authenticated user's tenant."""
    try:
        tenant_id = request.tenant_id
        
        # Get from Metadata Manager
        fs_cases = []
        try:
            fs_cases = services.metadata_manager.list_environments(tenant_id=tenant_id)
        except Exception as e:
            print(f"Warning: MetadataManager list failed: {e}")
        
        # Get from Legacy JSON
        legacy_cases = get_legacy_envs(tenant_id)
        
        # Merge unique values
        all_cases = list(set(fs_cases + legacy_cases))
        all_cases.sort()
        
        return jsonify({'cases': all_cases})
    except Exception as e:
        return jsonify({'cases': [], 'error': str(e)}), 500

@env_bp.route('/env/create', methods=['POST'])
@require_auth('TENANT_ADMIN')
def create_env():
    """
    ✅ FIX: Create environment - accepts name from body OR query param
    """
    # ✅ FIX: Try request body first, then query params
    name = request.json.get('name') if request.json else None
    if not name:
        name = request.args.get('name')
    if not name:
        name = request.args.get('env_id')  # ✅ FIX: Also accept env_id param
    
    tenant_id = request.tenant_id
    
    if not name: 
        return jsonify({'error': 'Environment name required (provide as body param or ?name=xxx)'}), 400
    
    try:
        # 1. Create using standard manager
        info = services.metadata_manager.create_environment(name, tenant_id=tenant_id)
        
        # 2. Register in legacy JSON
        try:
            envs = {}
            if os.path.exists(ENV_FILE):
                with open(ENV_FILE, 'r') as f: 
                    envs = json.load(f)
            
            key = f"{tenant_id}_{name}".replace(" ", "_").lower()
            
            if key not in envs:
                envs[key] = {
                    'name': name,
                    'tenant_id': tenant_id,
                    'db_path': os.path.join('data', tenant_id, name, 'registry.json'),
                    'logo_url': ''
                }
                with open(ENV_FILE, 'w') as f: 
                    json.dump(envs, f, indent=2)
        except Exception as ex:
            print(f"Warning: Failed to update legacy registry: {ex}")

        # 3. Activate immediately
        try:
            services.activate_case(name, tenant_id=tenant_id)
        except Exception as ex:
            print(f"Warning: Failed to activate new environment: {ex}")
        
        return jsonify({
            'success': True, 
            'name': name,
            'registry': info.get('registry', {}),
            'message': f'Environment "{name}" created successfully'
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 400

@env_bp.route('/env/select', methods=['POST'])
@require_auth()
def select_env():
    """Select/activate an environment with tenant validation."""
    # ✅ FIX: Accept from body or query param
    name = request.json.get('name') if request.json else None
    if not name:
        name = request.args.get('name')
    
    tenant_id = request.tenant_id
    
    if not name: 
        return jsonify({'error': 'Environment name required'}), 400
    
    try:
        info = services.activate_case(name, tenant_id=tenant_id)
        return jsonify({
            'success': True, 
            'name': name,
            'registry': info.get('registry', {})
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 400

@env_bp.route('/env/status', methods=['GET'])
@require_auth()
def env_status():
    """Get status of active environment."""
    if services.metadata_manager and services.metadata_manager.active_env:
        return jsonify({
            'active': True, 
            'name': services.metadata_manager.active_env,
            'tenant_id': services.metadata_manager.active_tenant,
        })
    return jsonify({'active': False})

@env_bp.route('/env/delete', methods=['POST'])
@require_auth('TENANT_ADMIN')
def delete_env():
    """Delete an environment (TENANT_ADMIN only)."""
    name = request.json.get('name') if request.json else None
    if not name:
        name = request.args.get('name')
    
    tenant_id = request.tenant_id
    
    if not name: 
        return jsonify({'error': 'Environment name required'}), 400
    
    try:
        # Check if currently active
        if services.metadata_manager.active_env == name:
            services.metadata_manager.active_env = None
            services.metadata_manager.active_tenant = None
            services.metadata_manager.registry_cache = {}

        # Delete physical folder
        base_path = services.metadata_manager.base_dir
        tenant_path = os.path.join(base_path, tenant_id)
        env_path = os.path.join(tenant_path, name)
        
        if os.path.exists(env_path):
            shutil.rmtree(env_path)

        # Cleanup Legacy JSON
        if os.path.exists(ENV_FILE):
            try:
                with open(ENV_FILE, 'r') as f: 
                    data = json.load(f)
                keys_to_del = [
                    k for k, v in data.items() 
                    if v.get('name') == name and v.get('tenant_id') == tenant_id
                ]
                for k in keys_to_del: 
                    del data[k]
                with open(ENV_FILE, 'w') as f: 
                    json.dump(data, f, indent=2)
            except: 
                pass

        return jsonify({'success': True, 'message': f'Environment "{name}" deleted'})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Failed to delete: {str(e)}'}), 500