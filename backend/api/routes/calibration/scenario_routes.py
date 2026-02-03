# backend/api/routes/calibration/scenario_routes.py
"""
Scenario Catalog Routes
"""
from flask import Blueprint, request, jsonify
from api.services import services
import traceback

scenario_bp = Blueprint('calibration_scenario', __name__)

@scenario_bp.route('/list', methods=['GET'])
def list_scenarios():
    """
    Get all available scenarios
    GET /api/v2/calibration/scenario/list
    """
    try:
        from calibration.services.scenario_catalog_service import ScenarioCatalogService
        
        db = services.get_calibration_db()
        catalog = ScenarioCatalogService(db)
        
        scenarios = catalog.list_scenarios()
        
        return jsonify({
            'success': True,
            'scenarios': scenarios
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@scenario_bp.route('/<scenario_id>/template', methods=['GET'])
def get_scenario_template(scenario_id):
    """
    Get specific scenario template
    GET /api/v2/calibration/scenario/{scenario_id}/template
    """
    try:
        from calibration.services.scenario_catalog_service import ScenarioCatalogService
        
        db = services.get_calibration_db()
        catalog = ScenarioCatalogService(db)
        
        scenario = catalog.get_scenario(scenario_id)
        
        if not scenario:
            return jsonify({'error': 'Scenario not found'}), 404
        
        return jsonify({
            'success': True,
            'scenario': scenario
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@scenario_bp.route('/custom', methods=['POST'])
def create_custom_scenario():
    """
    Save custom scenario
    POST /api/v2/calibration/scenario/custom
    """
    try:
        data = request.get_json()
        user_id = data.get('user_id', 'system')
        name = data.get('name')
        description = data.get('description')
        step1_defaults = data.get('step1_defaults', {})
        step2_defaults = data.get('step2_defaults', {})
        
        if not name:
            return jsonify({'error': 'name required'}), 400
        
        from calibration.services.scenario_catalog_service import ScenarioCatalogService
        
        db = services.get_calibration_db()
        catalog = ScenarioCatalogService(db)
        
        scenario = catalog.save_custom_scenario(
            user_id, name, description, step1_defaults, step2_defaults
        )
        
        return jsonify({
            'success': True,
            'scenario': scenario
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500