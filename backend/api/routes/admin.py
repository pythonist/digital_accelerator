"""
Admin Routes: Tenant-Scoped Environment & User Management
File: api/routes/admin.py
"""
from flask import Blueprint, request, jsonify
from api.utils import handle_errors
from api.services import services
from api.middleware.auth_middleware import require_auth
from services.db_schema import DatabaseManager
from services.auth.identity_store import IdentityStore
import json
import os
import sys
import time
import shutil
import threading
import sqlite3
from werkzeug.utils import secure_filename

admin_bp = Blueprint('admin', __name__)
identity_store = IdentityStore()

# --- FILE PATHS ---
ENV_FILE = 'data/environments.json'
CONFIG_FILE = 'data/app_config.json'
DATA_DIR = 'data'

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_envs():
    """Load environments from JSON"""
    if not os.path.exists(ENV_FILE): 
        return {}
    with open(ENV_FILE, 'r') as f: 
        return json.load(f)

def load_json(filepath):
    """Load any JSON file safely"""
    if not os.path.exists(filepath):
        return {}
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except:
        return {}

def save_json(filepath, data):
    """Save JSON file safely"""
    try:
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Error saving {filepath}: {e}")

# ============================================================================
# ADMIN DASHBOARD ROUTES
# ============================================================================

@admin_bp.route('/admin/dashboard', methods=['GET'])
@require_auth('TENANT_ADMIN')
def admin_dashboard():
    """
    Admin dashboard overview - TENANT_ADMIN only
    Returns tenant-wide statistics and health metrics
    """
    tenant_id = request.tenant_id
    
    try:
        tenant_users = identity_store.list_users_by_tenant(tenant_id)
        tenant_emails = [u.get("email") for u in tenant_users if u.get("email")]

        active_sessions = 0
        try:
            conn = sqlite3.connect(services.audit_logger.db_path)
            cur = conn.cursor()
            if tenant_emails:
                placeholders = ",".join(["?"] * len(tenant_emails))
                cur.execute(
                    f"""
                    SELECT COUNT(DISTINCT user)
                    FROM audit_log
                    WHERE action = 'login_attempt'
                      AND details LIKE '%"success": true%'
                      AND timestamp >= datetime('now', '-1 day')
                      AND user IN ({placeholders})
                    """,
                    tuple(tenant_emails),
                )
                row = cur.fetchone()
                active_sessions = int(row[0] or 0) if row else 0
        except Exception:
            active_sessions = 0
        finally:
            try:
                conn.close()
            except Exception:
                pass
        
        # ✅ FIX: Robust Environment Counting (Legacy + Directory)
        # 1. Get from Directory
        dir_envs = services.metadata_manager.list_environments(tenant_id=tenant_id)
        
        # 2. Get from Legacy JSON
        legacy_envs = []
        try:
            all_legacy = get_envs()
            legacy_envs = [v['name'] for k, v in all_legacy.items() if v.get('tenant_id') == tenant_id]
        except: pass
        
        # 3. Merge Unique
        total_unique_envs = len(set(dir_envs + legacy_envs))
        
        return jsonify({
            'success': True,
            'stats': {
                'total_users': len(tenant_users),
                'active_sessions': active_sessions,
                'total_environments': total_unique_envs,
                'admin_count': sum(1 for u in tenant_users if u.get('role') == 'TENANT_ADMIN'),
                'mfa_enabled_count': sum(1 for u in tenant_users if int(u.get('mfa_enabled') or 0) == 1)
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============================================================================
# ENVIRONMENT MANAGEMENT (ADMIN CONSOLIDATED VIEW)
# ============================================================================

@admin_bp.route('/admin/environments/list', methods=['GET'])
@require_auth('TENANT_ADMIN')
def admin_list_environments():
    """
    List all environments with detailed metadata - TENANT_ADMIN only
    """
    tenant_id = request.tenant_id
    
    try:
        # ✅ FIX: Merge logic here too to ensure list matches count
        dir_envs = services.metadata_manager.list_environments(tenant_id=tenant_id)
        
        legacy_envs = []
        try:
            all_legacy = get_envs()
            legacy_envs = [v['name'] for k, v in all_legacy.items() if v.get('tenant_id') == tenant_id]
        except: pass
        
        unique_names = list(set(dir_envs + legacy_envs))
        
        environments = []
        for env_name in unique_names:
            # Try to find registry in standard path
            tenant_path = os.path.join(services.metadata_manager.base_dir, tenant_id)
            env_path = os.path.join(tenant_path, env_name)
            reg_path = os.path.join(env_path, 'registry.json')
            
            env_info = {
                'name': env_name,
                'created_at': None,
                'tables_count': 0,
                'is_active': services.metadata_manager.active_env == env_name
            }
            
            # Check Registry file
            if os.path.exists(reg_path):
                try:
                    with open(reg_path, 'r') as f:
                        registry = json.load(f)
                        env_info['created_at'] = registry.get('created_at')
                        env_info['tables_count'] = len(registry.get('tables', {}))
                        env_info['pipeline_stage'] = registry.get('pipeline_stage', 'INIT')
                except:
                    pass
            
            environments.append(env_info)
        
        # Sort by creation date
        environments.sort(key=lambda x: x.get('created_at') or '', reverse=True)
        
        return jsonify({
            'success': True,
            'environments': environments
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ... (Keep the rest of your routes: USER MANAGEMENT, AUDIT, LEGACY, etc. exactly as they were) ...
# I am only showing the corrected parts to save space, assume the rest of the file is unchanged below this point.
# Copy the other routes from your original admin.py file here.
@admin_bp.route('/admin/users/list', methods=['GET'])
@require_auth('TENANT_ADMIN')
def list_users():
    """
    List all users in the tenant - TENANT_ADMIN only
    """
    tenant_id = request.tenant_id
    
    try:
        tenant_users = identity_store.list_users_by_tenant(tenant_id)

        last_login_by_email = {}
        active_by_email = set()
        try:
            emails = [u.get("email") for u in tenant_users if u.get("email")]
            if emails:
                conn = sqlite3.connect(services.audit_logger.db_path)
                cur = conn.cursor()
                placeholders = ",".join(["?"] * len(emails))
                cur.execute(
                    f"""
                    SELECT user, MAX(timestamp) AS last_ts
                    FROM audit_log
                    WHERE action = 'login_attempt'
                      AND details LIKE '%"success": true%'
                      AND user IN ({placeholders})
                    GROUP BY user
                    """,
                    tuple(emails),
                )
                for row in cur.fetchall():
                    last_login_by_email[str(row[0])] = row[1]
                cur.execute(
                    f"""
                    SELECT DISTINCT user
                    FROM audit_log
                    WHERE action = 'login_attempt'
                      AND details LIKE '%"success": true%'
                      AND timestamp >= datetime('now', '-1 day')
                      AND user IN ({placeholders})
                    """,
                    tuple(emails),
                )
                for row in cur.fetchall():
                    active_by_email.add(str(row[0]))
        except Exception:
            last_login_by_email = {}
            active_by_email = set()
        finally:
            try:
                conn.close()
            except Exception:
                pass

        users_list = []
        for u in tenant_users:
            email = u.get("email")
            users_list.append(
                {
                    "user_id": u.get("user_id"),
                    "email": email,
                    "phone": "",
                    "role": u.get("role") or "TENANT_USER",
                    "status": "active" if email in active_by_email else "inactive",
                    "mfa_enabled": bool(int(u.get("mfa_enabled") or 0)),
                    "created_at": u.get("created_at") or 0,
                    "last_login": last_login_by_email.get(email),
                    "disabled": bool(int(u.get("disabled") or 0)),
                }
            )
        
        return jsonify({
            'success': True,
            'users': users_list
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/admin/users/update-role', methods=['POST'])
@require_auth('TENANT_ADMIN')
def update_user_role():
    """
    Promote or Demote a user (TENANT_ADMIN only)
    """
    tenant_id = request.tenant_id
    target_email = request.json.get('email')
    new_role = request.json.get('role') # Expect 'TENANT_ADMIN' or 'TENANT_USER'
    
    if not target_email or not new_role:
        return jsonify({'error': 'Email and Role are required'}), 400
        
    if new_role not in ['TENANT_ADMIN', 'TENANT_USER']:
        return jsonify({'error': 'Invalid role'}), 400

    # Prevent self-demotion to avoid locking yourself out
    if target_email == request.username and new_role == 'TENANT_USER':
        return jsonify({'error': 'You cannot demote yourself. Transfer ownership first.'}), 400
    
    try:
        user = identity_store.get_user_by_email(target_email)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        if user.get('tenant_id') != tenant_id:
            return jsonify({'error': 'Access denied: User belongs to another tenant'}), 403

        identity_store.set_user_role(str(user.get("user_id")), new_role)
        
        return jsonify({
            'success': True, 
            'message': f'User {target_email} promoted to {new_role}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/admin/users/disable', methods=['POST'])
@require_auth('TENANT_ADMIN')
def disable_user():
    tenant_id = request.tenant_id
    target_email = request.json.get('email')
    
    if not target_email:
        return jsonify({'error': 'Email required'}), 400
    
    if target_email == request.username:
        return jsonify({'error': 'Cannot disable your own account'}), 400
    
    try:
        user = identity_store.get_user_by_email(target_email)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        if user.get('tenant_id') != tenant_id:
            return jsonify({'error': 'Access denied'}), 403
        identity_store.set_user_disabled(str(user.get("user_id")), True)
        
        return jsonify({'success': True, 'message': f'User {target_email} has been disabled'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/admin/users/enable', methods=['POST'])
@require_auth('TENANT_ADMIN')
def enable_user():
    tenant_id = request.tenant_id
    target_email = request.json.get('email')
    
    if not target_email:
        return jsonify({'error': 'Email required'}), 400
    
    try:
        user = identity_store.get_user_by_email(target_email)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        if user.get('tenant_id') != tenant_id:
            return jsonify({'error': 'Access denied'}), 403
        identity_store.set_user_disabled(str(user.get("user_id")), False)
        
        return jsonify({'success': True, 'message': f'User {target_email} has been enabled'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/audit/get-trail', methods=['POST'])
@require_auth()
@handle_errors
def get_audit():
    logs = services.audit_logger.get_audit_trail(
        user=request.json.get('user'), 
        limit=100
    )
    return jsonify(logs)


@admin_bp.route('/audit/session/event', methods=['POST'])
@require_auth()
@handle_errors
def log_session_event():
    payload = request.json or {}
    session_id = str(payload.get("session_id") or request.headers.get("X-Session-ID") or "")
    event_type = str(payload.get("event_type") or "event")
    if not session_id:
        return jsonify({"success": False, "error": "session_id required"}), 400
    details = dict(payload)
    details.pop("session_id", None)
    details.pop("event_type", None)
    services.audit_logger.log_action(
        user=request.username,
        action=event_type,
        entity_type="session",
        entity_id=session_id,
        details=details,
        ip_address=request.remote_addr,
    )
    return jsonify({"success": True})


@admin_bp.route('/audit/session/timeline/<session_id>', methods=['GET'])
@require_auth()
@handle_errors
def get_session_timeline(session_id: str):
    logs = services.audit_logger.get_audit_trail(entity_type="session", entity_id=str(session_id), limit=2000)
    logs = list(reversed(logs))
    return jsonify({"success": True, "session_id": str(session_id), "events": logs})


@admin_bp.route('/audit/session/list', methods=['GET'])
@require_auth()
@handle_errors
def list_sessions():
    limit = request.args.get("limit", default=50, type=int)
    limit = max(1, min(int(limit or 50), 200))
    conn = sqlite3.connect(services.audit_logger.db_path)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT entity_id, user, MIN(timestamp) as start_ts, MAX(timestamp) as end_ts, COUNT(*) as event_count
            FROM audit_log
            WHERE entity_type = 'session'
            GROUP BY entity_id, user
            ORDER BY end_ts DESC
            LIMIT ?
            """,
            (limit,),
        )
        sessions = []
        for row in cur.fetchall():
            sessions.append(
                {
                    "session_id": row[0],
                    "user": row[1],
                    "started_at": row[2],
                    "ended_at": row[3],
                    "event_count": int(row[4] or 0),
                }
            )
        return jsonify({"success": True, "sessions": sessions})
    finally:
        conn.close()

@admin_bp.route('/environments/list-created', methods=['GET'])
@require_auth()
def list_envs_legacy():
    tenant_id = request.tenant_id
    envs = get_envs()
    tenant_envs = {
        key: env_data 
        for key, env_data in envs.items() 
        if env_data.get('tenant_id') == tenant_id
    }
    with open(CONFIG_FILE, 'r') as f: 
        cfg = json.load(f)
    return jsonify({
        'environments': tenant_envs,
        'active_db_path': cfg.get('active_db_path'),
        'active_bank_name': cfg.get('active_bank_name'),
        'active_bank_logo': cfg.get('active_bank_logo')
    })

@admin_bp.route('/environments/list-defaults', methods=['GET'])
@require_auth()
def list_defaults():
    defaults = [
        {"key": "hdfc", "name": "HDFC Bank", "logo_url": "/data/logos/hdfc.png"},
        {"key": "icici", "name": "ICICI Bank", "logo_url": "/data/logos/icici.png"},
        {"key": "axis", "name": "Axis Bank", "logo_url": "/data/logos/axis.png"}
    ]
    return jsonify(defaults)

@admin_bp.route('/environments/create-from-default', methods=['POST'])
@require_auth('TENANT_ADMIN')
@handle_errors
def create_default():
    data = request.json
    key = data['key']
    name = data['name']
    tenant_id = request.tenant_id
    folder_path = os.path.join('data', tenant_id, key.upper())
    os.makedirs(folder_path, exist_ok=True)
    db_path = os.path.join(folder_path, f"{key}.db")
    envs = get_envs()
    env_key = f"{tenant_id}_{key}"
    if env_key in envs: 
        return jsonify({'error': 'Environment already exists'}), 400
    envs[env_key] = {
        'name': name,
        'tenant_id': tenant_id,
        'db_path': db_path,
        'logo_url': data.get('logo_url')
    }
    with open(ENV_FILE, 'w') as f: 
        json.dump(envs, f, indent=2)
    db = DatabaseManager(db_path)
    db.init_schema()
    return jsonify({'success': True})

@admin_bp.route('/environments/create-custom', methods=['POST'])
@require_auth('TENANT_ADMIN')
@handle_errors
def create_custom():
    name = request.form.get('bank_name')
    file = request.files.get('logo')
    tenant_id = request.tenant_id
    key = "".join(x for x in name if x.isalnum()).lower()
    folder_path = os.path.join('data', tenant_id, key.upper())
    os.makedirs(folder_path, exist_ok=True)
    db_path = os.path.join(folder_path, f"{key}.db")
    logo_url = ""
    if file:
        filename = secure_filename(file.filename)
        logo_path = os.path.join(folder_path, filename)
        file.save(logo_path)
        global_logo_path = os.path.join('data', 'logos', f"{tenant_id}_{key}_{filename}")
        os.makedirs(os.path.dirname(global_logo_path), exist_ok=True)
        shutil.copy(logo_path, global_logo_path)
        logo_url = f"/data/logos/{tenant_id}_{key}_{filename}"
    envs = get_envs()
    env_key = f"{tenant_id}_{key}"
    envs[env_key] = {
        'name': name,
        'tenant_id': tenant_id,
        'db_path': db_path,
        'logo_url': logo_url
    }
    with open(ENV_FILE, 'w') as f: 
        json.dump(envs, f, indent=2)
    db = DatabaseManager(db_path)
    db.init_schema()
    return jsonify({'success': True})

@admin_bp.route('/environments/set-active', methods=['POST'])
@require_auth('TENANT_ADMIN')
def set_active():
    key = request.json.get('db_path_key')
    tenant_id = request.tenant_id
    envs = get_envs()
    if key not in envs: 
        return jsonify({'error': 'Environment not found'}), 404
    if envs[key].get('tenant_id') != tenant_id:
        return jsonify({'error': 'Access denied'}), 403
    with open(CONFIG_FILE, 'w') as f:
        json.dump({
            'active_db_path': envs[key]['db_path'],
            'active_bank_name': envs[key]['name'],
            'active_bank_logo': envs[key].get('logo_url')
        }, f, indent=2)
    def restart():
        os.execv(sys.executable, ['python'] + sys.argv)
    threading.Timer(1.0, restart).start()
    return jsonify({'success': True, 'message': 'Restarting server...'})

@admin_bp.route('/environments/delete', methods=['POST'])
@require_auth('TENANT_ADMIN')
def delete_env_legacy():
    key = request.json.get('db_path_key')
    tenant_id = request.tenant_id
    envs = get_envs()
    if key not in envs: 
        return jsonify({'error': 'Environment not found'}), 404
    if envs[key].get('tenant_id') != tenant_id:
        return jsonify({'error': 'Access denied'}), 403
    with open(CONFIG_FILE, 'r') as f: 
        cfg = json.load(f)
    if envs[key]['db_path'] == cfg.get('active_db_path'):
        return jsonify({'error': 'Cannot delete active environment'}), 400
    folder = os.path.dirname(envs[key]['db_path'])
    if os.path.exists(folder) and 'data' in folder:
        shutil.rmtree(folder)
    del envs[key]
    with open(ENV_FILE, 'w') as f: 
        json.dump(envs, f, indent=2)
    return jsonify({'success': True})
@admin_bp.route('/admin/users', methods=['GET'])
@require_auth()
def get_users():
    tenant_id = request.tenant_id
    try:
        tenant_users = identity_store.list_users_by_tenant(tenant_id)
        users_list = []
        for u in tenant_users:
            users_list.append(
                {
                    "user_id": u.get("user_id"),
                    "email": u.get("email"),
                    "phone": "",
                    "role": u.get("role") or "TENANT_USER",
                    "mfa_enabled": bool(int(u.get("mfa_enabled") or 0)),
                    "created_at": u.get("created_at") or time.time(),
                    "disabled": bool(int(u.get("disabled") or 0)),
                }
            )

        sessions_list = []
        try:
            emails = [u.get("email") for u in tenant_users if u.get("email")]
            if emails:
                conn = sqlite3.connect(services.audit_logger.db_path)
                cur = conn.cursor()
                placeholders = ",".join(["?"] * len(emails))
                cur.execute(
                    f"""
                    SELECT user, timestamp
                    FROM audit_log
                    WHERE action = 'login_attempt'
                      AND details LIKE '%"success": true%'
                      AND user IN ({placeholders})
                    ORDER BY timestamp DESC
                    LIMIT 200
                    """,
                    tuple(emails),
                )
                now = time.time()
                for row in cur.fetchall():
                    ts = row[1]
                    sessions_list.append(
                        {"username": row[0], "timestamp": ts, "is_active": True, "last_activity": ts, "server_time": now}
                    )
        except Exception:
            sessions_list = []
        finally:
            try:
                conn.close()
            except Exception:
                pass

        users_list.sort(key=lambda x: x.get("created_at", 0), reverse=True)
        return jsonify({
            'success': True,
            'users': users_list,
            'sessions': sessions_list,
            'stats': {
                'total_users': len(users_list),
                'active_sessions': len(set([s.get('username') for s in sessions_list if s.get('is_active')])),
                'mfa_enabled_count': len([u for u in users_list if u['mfa_enabled']])
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/admin/system-health', methods=['GET'])
@require_auth()
def system_health():
    tenant_id = request.tenant_id
    try:
        tenant_users = identity_store.list_users_by_tenant(tenant_id)
        tenant_emails = [u.get("email") for u in tenant_users if u.get("email")]
        active_sessions = 0
        try:
            if tenant_emails:
                conn = sqlite3.connect(services.audit_logger.db_path)
                cur = conn.cursor()
                placeholders = ",".join(["?"] * len(tenant_emails))
                cur.execute(
                    f"""
                    SELECT COUNT(DISTINCT user)
                    FROM audit_log
                    WHERE action = 'login_attempt'
                      AND details LIKE '%"success": true%'
                      AND timestamp >= datetime('now', '-1 day')
                      AND user IN ({placeholders})
                    """,
                    tuple(tenant_emails),
                )
                row = cur.fetchone()
                active_sessions = int(row[0] or 0) if row else 0
        except Exception:
            active_sessions = 0
        finally:
            try:
                conn.close()
            except Exception:
                pass
        current_time = time.time()
        return jsonify({
            'success': True,
            'health': {
                'status': 'healthy',
                'uptime': '99.9%',
                'total_users': len(tenant_users),
                'active_now': active_sessions,
                'last_updated': current_time
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    

