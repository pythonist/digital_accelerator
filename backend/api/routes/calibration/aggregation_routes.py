# backend/api/routes/calibration/aggregation_routes.py
"""
Aggregation Routes - Enhanced with Visuals
"""
from flask import Blueprint, request, jsonify
from api.services import services
import traceback
import json

aggregation_bp = Blueprint('calibration_aggregation', __name__)


@aggregation_bp.route('/<run_id>/preview', methods=['POST'])
def preview_aggregation(run_id):
    """
    Preview aggregation with stats + visuals
    
    POST /api/v2/calibration/aggregate/{run_id}/preview
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        aggregation_config = data.get('aggregation_config')
        
        if not env_id or not aggregation_config:
            return jsonify({'error': 'Missing required fields'}), 400
        
        agg_service = services.get_aggregation_service()
        result = agg_service.preview_aggregation_impact(run_id, aggregation_config)
        
        # ✅ FIX: Remove DataFrame if present (cannot be JSON serialized)
        if 'aggregated_df' in result:
            del result['aggregated_df']
            
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@aggregation_bp.route('/<run_id>/run', methods=['POST'])
def run_aggregation(run_id):
    """
    🔥 NEW ROUTE: Execute aggregation -> Commit to DB
    This is the route the frontend expects!
    
    POST /api/v2/calibration/aggregate/{run_id}/run
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        aggregation_config = data.get('aggregation_config') or data
        
        # Remove env_id from config if present
        if 'env_id' in aggregation_config:
            del aggregation_config['env_id']
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        print(f"📊 [AGG ROUTE] Executing aggregation for run {run_id}")
        print(f"📊 [AGG ROUTE] Config: {json.dumps(aggregation_config, indent=2)}")
        
        agg_service = services.get_aggregation_service()
        result = agg_service.execute_aggregation(run_id, aggregation_config)
        
        # ✅ FIX: Remove DataFrame if present (cannot be JSON serialized)
        if 'aggregated_df' in result:
            del result['aggregated_df']
        
        # Fetch updated run
        db = services.get_calibration_db()
        conn = db.connect()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM calibration_runs WHERE run_id = ?", (run_id,))
        row = cursor.fetchone()
        
        run_dict = {}
        if row:
            columns = [d[0] for d in cursor.description]
            run_dict = dict(zip(columns, row))
            
            # Parse JSON fields
            for field in ['scenario_config', 'aggregation_config', 'population_filters']:
                if field in run_dict and run_dict[field]:
                    try:
                        run_dict[field] = json.loads(run_dict[field])
                    except:
                        pass
            
        conn.close()
        
        print(f"✅ [AGG ROUTE] Aggregation complete, status: {run_dict.get('status')}")
        
        return jsonify({
            'success': True,
            'run': run_dict,
            **result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@aggregation_bp.route('/<run_id>/execute', methods=['POST'])
def execute_aggregation(run_id):
    """
    Alternative endpoint (legacy compatibility)
    
    POST /api/v2/calibration/aggregate/{run_id}/execute
    """
    return run_aggregation(run_id)


@aggregation_bp.route('/<run_id>/result', methods=['GET'])
def get_aggregation_result(run_id):
    """
    Get aggregation results
    
    GET /api/v2/calibration/aggregate/{run_id}/result
    """
    try:
        env_id = request.args.get('env_id')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        agg_service = services.get_aggregation_service()
        result = agg_service.get_aggregation_result(run_id)
        
        if not result:
            return jsonify({'error': 'No aggregation found'}), 404
        
        return jsonify({
            'success': True,
            'result': result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@aggregation_bp.route('/<run_id>/visuals', methods=['GET'])
def get_aggregation_visuals(run_id):
    """
    Get visual data for aggregation
    
    GET /api/v2/calibration/aggregate/{run_id}/visuals
    """
    try:
        env_id = request.args.get('env_id')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        # This would need to regenerate visuals from stored aggregation
        # For now, return empty (visuals are in preview)
        return jsonify({
            'success': True,
            'visuals': {}
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500