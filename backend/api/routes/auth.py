"""
Authentication: Tenant-Aware File-Based Sessions with Auto-Tenant Creation
File: api/routes/auth.py
"""
from flask import Blueprint, request, jsonify
import uuid
import time
import json
import os
import pyotp
from werkzeug.security import generate_password_hash, check_password_hash

auth_bp = Blueprint('auth', __name__)

# --- FILE PATHS ---
DATA_DIR = 'data'
USERS_FILE = os.path.join(DATA_DIR, 'users.json')
SESSIONS_FILE = os.path.join(DATA_DIR, 'sessions.json')
TENANTS_FILE = os.path.join(DATA_DIR, 'tenants.json')

# --- HELPERS ---
def ensure_data_dir():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)

def load_json(filepath):
    ensure_data_dir()
    if not os.path.exists(filepath): 
        return {}
    try:
        with open(filepath, 'r') as f: 
            return json.load(f)
    except: 
        return {}

def save_json(filepath, data):
    ensure_data_dir()
    with open(filepath, 'w') as f: 
        json.dump(data, f, indent=2)

def extract_tenant_from_email(email):
    """
    Extract tenant_id and role from email domain.
    Auto-creates tenant if it doesn't exist.
    
    Returns:
        tuple: (tenant_id, role)
    """
    if not email or '@' not in email:
        return None, None
    
    domain = email.split('@')[1].lower()
    tenants = load_json(TENANTS_FILE)
    
    # Check if tenant exists
    if domain in tenants:
        tenant_info = tenants[domain]
        
        # Check if this is the first user for this tenant
        users = load_json(USERS_FILE)
        existing_tenant_users = [
            u for u in users.values() 
            if u.get('tenant_id') == tenant_info['tenant_id']
        ]
        
        # First user becomes TENANT_ADMIN
        if len(existing_tenant_users) == 0:
            role = 'TENANT_ADMIN'
        else:
            role = 'TENANT_USER'
        
        return tenant_info['tenant_id'], role
    
    # Auto-create tenant for new domain
    else:
        # Generate tenant_id from domain (remove .com, .org, etc.)
        tenant_id = domain.split('.')[0].lower()
        
        # Create readable tenant name
        tenant_name = domain.split('.')[0].upper()
        
        # Register new tenant
        tenants[domain] = {
            'tenant_id': tenant_id,
            'tenant_name': tenant_name,
            'default_role': 'TENANT_USER',
            'created_at': time.time()
        }
        save_json(TENANTS_FILE, tenants)
        
        print(f"✅ Auto-created tenant: {tenant_id} ({domain})")
        
        # First user of new tenant is TENANT_ADMIN
        return tenant_id, 'TENANT_ADMIN'

# --- ROUTES ---

@auth_bp.route('/check-auth', methods=['GET'])
def check_auth():
    """
    Validates token against the persistent sessions.json file.
    Returns user info including tenant_id and role.
    """
    auth_header = request.headers.get('Authorization')
    
    if not auth_header or not auth_header.startswith("Bearer "):
        return jsonify({'authenticated': False}), 401

    token = auth_header.split(" ")[1]
    
    # Load valid sessions from disk
    sessions = load_json(SESSIONS_FILE)
    
    if token in sessions:
        session_data = sessions[token]
        
        # Check expiry (24 hours)
        if time.time() - session_data.get('timestamp', 0) > 86400:
            del sessions[token]
            save_json(SESSIONS_FILE, sessions)
            return jsonify({'authenticated': False}), 401

        return jsonify({
            'authenticated': True, 
            'user': {
                'username': session_data['username'],
                'role': session_data.get('role', 'TENANT_USER'),
                'tenant_id': session_data.get('tenant_id')
            }
        })
        
    return jsonify({'authenticated': False}), 401

@auth_bp.route('/register/init', methods=['POST'])
def register_init():
    """
    Initialize registration - validates email domain and generates 2FA QR code.
    Auto-creates tenant if domain doesn't exist.
    """
    users = load_json(USERS_FILE)
    data = request.json
    email = data.get('email')
    
    if not email:
        return jsonify({'error': 'Email is required'}), 400
    
    if email in users:
        return jsonify({'error': 'User already registered'}), 400

    # Extract or create tenant
    tenant_id, role = extract_tenant_from_email(email)
    
    if not tenant_id:
        return jsonify({
            'error': 'Invalid email format. Please use a valid email address.'
        }), 400

    # Generate 2FA secret
    secret = pyotp.random_base32()
    uri = pyotp.totp.TOTP(secret).provisioning_uri(
        name=email, 
        issuer_name="Sentinel AML"
    )
    
    # Store in temporary cache
    global PENDING_REG_CACHE
    if 'PENDING_REG_CACHE' not in globals(): 
        PENDING_REG_CACHE = {}
    
    temp_token = str(uuid.uuid4())
    PENDING_REG_CACHE[temp_token] = {
        "email": email,
        "password_hash": generate_password_hash(data.get('password')),
        "phone": data.get('phone'),
        "secret": secret,
        "tenant_id": tenant_id,
        "role": role
    }
    
    # Get tenant name
    tenants = load_json(TENANTS_FILE)
    domain = email.split('@')[1].lower()
    tenant_name = tenants.get(domain, {}).get('tenant_name', tenant_id.upper())
    
    return jsonify({
        'success': True,
        'temp_token': temp_token,
        'qr_uri': uri,
        'tenant_name': tenant_name,
        'is_first_user': role == 'TENANT_ADMIN',
        'message': 'Scan QR code with your authenticator app'
    })

@auth_bp.route('/register/verify', methods=['POST'])
def register_verify():
    """
    Verify 2FA code and complete registration with tenant assignment.
    """
    data = request.json
    temp_token = data.get('temp_token')
    code = data.get('code')
    
    global PENDING_REG_CACHE
    if 'PENDING_REG_CACHE' not in globals(): 
        PENDING_REG_CACHE = {}

    reg_data = PENDING_REG_CACHE.get(temp_token)
    if not reg_data:
        return jsonify({'error': 'Registration session expired'}), 400
        
    if not pyotp.TOTP(reg_data['secret']).verify(code):
        return jsonify({'error': 'Invalid 2FA code'}), 400
        
    # Save user with tenant information
    users = load_json(USERS_FILE)
    users[reg_data['email']] = {
        "password_hash": reg_data['password_hash'],
        "phone": reg_data['phone'],
        "tenant_id": reg_data['tenant_id'],
        "role": reg_data['role'],
        "mfa_secret": reg_data['secret'],
        "mfa_enabled": True,
        "created_at": time.time()
    }
    save_json(USERS_FILE, users)
    
    del PENDING_REG_CACHE[temp_token]
    
    return jsonify({
        'success': True,
        'message': f"Account created successfully as {reg_data['role']}"
    })

# @auth_bp.route('/login', methods=['POST'])
# def login():
#     """
#     Two-phase login: 
#     1. Validate credentials
#     2. Validate 2FA code and create session with tenant context
#     """
#     users = load_json(USERS_FILE)
#     data = request.json
    
#     # PHASE 1: Credential Check
#     if 'code' not in data:
#         username = data.get('username')
#         password = data.get('password')
#         user = users.get(username)
        
#         if user and check_password_hash(user['password_hash'], password):
#             # Check if user is disabled
#             if user.get('disabled', False):
#                 return jsonify({'error': 'Account has been disabled'}), 403
            
#             return jsonify({
#                 'success': True,
#                 'require_mfa': True,
#                 'temp_token': username
#             })
#         return jsonify({'error': 'Invalid email or password'}), 401

#     # PHASE 2: MFA Verification
#     else:
#         username = data.get('username')
#         code = data.get('code')
#         user = users.get(username)
        
#         if not user: 
#             return jsonify({'error': 'User not found'}), 401
        
#         # Check if user is disabled
#         if user.get('disabled', False):
#             return jsonify({'error': 'Account has been disabled'}), 403
        
#         if pyotp.TOTP(user['mfa_secret']).verify(code):
#             # Generate session token
#             new_token = str(uuid.uuid4())
            
#             sessions = load_json(SESSIONS_FILE)
#             sessions[new_token] = {
#                 "username": username,
#                 "tenant_id": user.get('tenant_id'),
#                 "role": user.get('role', 'TENANT_USER'),
#                 "timestamp": time.time()
#             }
#             save_json(SESSIONS_FILE, sessions)
            
#             return jsonify({
#                 'success': True,
#                 'user': {
#                     'username': username,
#                     'role': user['role'],
#                     'tenant_id': user.get('tenant_id')
#                 },
#                 'token': new_token
#             })
            
#         return jsonify({'error': 'Invalid 2FA code'}), 400
@auth_bp.route('/login', methods=['POST'])
def login():
    users = load_json(USERS_FILE)
    data = request.json or {}

    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400

    user = users.get(username)

    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Invalid email or password'}), 401

    if user.get('disabled', False):
        return jsonify({'error': 'Account has been disabled'}), 403

    # ============================================================
    # ✅ DEMO MODE: BYPASS MFA COMPLETELY
    # ============================================================
    DEMO_MODE = True   # 🔴 SET TO FALSE AFTER DEMO

    if DEMO_MODE:
        new_token = str(uuid.uuid4())

        sessions = load_json(SESSIONS_FILE)
        sessions[new_token] = {
            "username": username,
            "tenant_id": user.get('tenant_id'),
            "role": user.get('role', 'TENANT_USER'),
            "timestamp": time.time()
        }
        save_json(SESSIONS_FILE, sessions)

        return jsonify({
            'success': True,
            'user': {
                'username': username,
                'role': user.get('role'),
                'tenant_id': user.get('tenant_id')
            },
            'token': new_token
        })

    # ============================================================
    # 🔐 NORMAL MODE (MFA REQUIRED)
    # ============================================================
    return jsonify({
        'success': True,
        'require_mfa': True,
        'temp_token': username
    })

@auth_bp.route('/logout', methods=['POST'])
def logout():
    """
    Logout and invalidate session token.
    """
    auth_header = request.headers.get('Authorization')
    
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        sessions = load_json(SESSIONS_FILE)
        
        if token in sessions:
            del sessions[token]
            save_json(SESSIONS_FILE, sessions)
    
    return jsonify({'success': True, 'message': 'Logged out successfully'})