# api/utils.py
from functools import wraps
from flask import jsonify
import traceback
from api.services import services

def handle_errors(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        # FIX: Check investigation_db instead of db_manager
        if not services.investigation_db:
             # Try to recover if a case is active in metadata but DB not loaded
             if services.metadata_manager and services.metadata_manager.active_env:
                 print("⚠️ DB missing but Env active. Attempting restore...")
                 try:
                     services.activate_case(services.metadata_manager.active_env)
                 except:
                     pass
             
             # Double check
             if not services.investigation_db:
                return jsonify({"error": "No active environment selected. Please select a case."}), 400

        try:
            return f(*args, **kwargs)
        except Exception as e:
            print(f"❌ API Error: {str(e)}")
            return jsonify({"error": str(e), "success": False}), 500
    return wrapper