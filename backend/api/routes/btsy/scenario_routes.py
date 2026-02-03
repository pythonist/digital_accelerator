from flask import Blueprint, request, jsonify
import logging

from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.scenario.scenario_service import ScenarioService


logger = logging.getLogger(__name__)
scenario_bp = Blueprint('btsy_scenarios', __name__)


def _get(env_id: str, tenant_id: str = 'default') -> ScenarioService:
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    return ScenarioService(workbench_db)


@scenario_bp.route('/scenario/list', methods=['GET'])
def list_scenarios():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        ownership = request.args.get('ownership')
        status = request.args.get('status', default='ACTIVE')
        svc = _get(env_id)
        rows = svc.list_scenarios(ownership=ownership, status=status)
        return jsonify({'success': True, 'data': rows}), 200
    except Exception as e:
        logger.error(f"[BTSY][SCENARIO] List failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@scenario_bp.route('/scenario/<scenario_id>', methods=['GET'])
def get_scenario(scenario_id: str):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc = _get(env_id)
        obj = svc.get_scenario(str(scenario_id))
        return jsonify({'success': True, 'data': obj}), 200
    except Exception as e:
        logger.error(f"[BTSY][SCENARIO] Get failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@scenario_bp.route('/scenario/create', methods=['POST'])
def create_scenario():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        scenario_id = data.get('scenario_id')
        name = data.get('name')
        description = data.get('description')
        entity_level = data.get('entity_level', 'account')
        created_by = data.get('created_by', 'user')
        scenario_json = data.get('scenario_json')
        if not scenario_id or not name:
            return jsonify({'error': 'scenario_id and name required'}), 400
        svc = _get(env_id)
        out = svc.create_user_scenario(
            scenario_id=str(scenario_id),
            name=str(name),
            description=description,
            entity_level=str(entity_level),
            created_by=str(created_by),
            scenario_json=scenario_json,
        )
        return jsonify({'success': True, 'data': out}), 200
    except Exception as e:
        logger.error(f"[BTSY][SCENARIO] Create failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

