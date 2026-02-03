from flask import Blueprint, request, jsonify
from api.services import services

env_bp = Blueprint('env', __name__)

@env_bp.route('/tables', methods=['GET'])
def list_tables():
    """
    Returns tables based on the active tool context.
    Query Param: ?tool=investigation OR ?tool=calibration
    """
    tool = request.args.get('tool', 'investigation') # Default to investigation
    
    try:
        if tool == 'calibration':
            if not services.calibration_db:
                return jsonify([])
            tables = services.calibration_db.get_display_tables()
        else:
            if not services.investigation_db:
                return jsonify([])
            tables = services.investigation_db.get_display_tables()
            
        return jsonify(tables)
    except Exception as e:
        return jsonify({"error": str(e)}), 500