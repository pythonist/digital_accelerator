# backend/api/routes/calibration/run_routes.py
"""
Run Management Routes
Create, load, update, delete calibration runs
"""
from flask import Blueprint, request, jsonify
from api.services import services
from calibration.services.run_manager import CalibrationRunManager
import traceback

run_bp = Blueprint('calibration_run', __name__)

@run_bp.route('/create', methods=['POST'])
def create_run():
    """
    Create new calibration run
    
    POST /api/v2/calibration/run/create
    Body: {
        "env_id": "xxx",
        "scenario_name": "High Risk Cash Transactions"
    }
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        scenario_name = data.get('scenario_name')
        created_by = data.get('created_by', 'system')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        # Get run manager
        db = services.get_calibration_db()
        conn = db.connect()
        run_manager = CalibrationRunManager(conn)
        
        # Create run
        run = run_manager.create_run(env_id, created_by, scenario_name)
        
        conn.close()
        
        return jsonify({
            'success': True,
            'run': run
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@run_bp.route('/<run_id>', methods=['GET'])
def get_run(run_id):
    """
    Load existing run
    
    GET /api/v2/calibration/run/{run_id}?env_id=xxx
    """
    try:
        env_id = request.args.get('env_id')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        db = services.get_calibration_db()
        conn = db.connect()
        run_manager = CalibrationRunManager(conn)
        
        run = run_manager.get_run(run_id)
        conn.close()
        
        if not run:
            return jsonify({'error': 'Run not found'}), 404
        
        return jsonify({
            'success': True,
            'run': run
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@run_bp.route('/list', methods=['GET'])
def list_runs():
    """
    List all runs for environment
    
    GET /api/v2/calibration/run/list?env_id=xxx&status=APPROVED&limit=50
    """
    try:
        env_id = request.args.get('env_id')
        status = request.args.get('status')
        created_by = request.args.get('created_by')
        limit = int(request.args.get('limit', 50))
        
        db = services.get_calibration_db()
        conn = db.connect()
        run_manager = CalibrationRunManager(conn)
        
        runs = run_manager.list_runs(env_id, created_by, status, limit)
        conn.close()
        
        return jsonify({
            'success': True,
            'runs': runs
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@run_bp.route('/<run_id>', methods=['DELETE'])
def delete_run(run_id):
    """
    Delete calibration run
    
    DELETE /api/v2/calibration/run/{run_id}
    """
    try:
        db = services.get_calibration_db()
        conn = db.connect()
        run_manager = CalibrationRunManager(conn)
        
        result = run_manager.delete_run(run_id)
        conn.close()
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500