from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.validation.j_statistic_service import JStatisticService
import logging

logger = logging.getLogger(__name__)
step36_bp = Blueprint('step36', __name__)


def _get(env_id: str, tenant_id: str = 'default'):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    behavior_db = folders['duckdb'] / 'behavior.duckdb'
    return JStatisticService(workbench_db), behavior_db


@step36_bp.route('/calibration/session/<int:session_id>/validation/step36/run', methods=['POST'])
def run_step36(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        boundary_id = data.get('boundary_id')
        created_by = data.get('created_by', 'user')
        if not boundary_id:
            return jsonify({'error': 'boundary_id required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.compute_step36(behavior_db, session_id, int(boundary_id), created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[STEP36] Run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@step36_bp.route('/calibration/session/<int:session_id>/validation/step36/run/list', methods=['GET'])
def list_step36_runs(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.list_runs(session_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[STEP36] List failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@step36_bp.route('/calibration/session/<int:session_id>/validation/step36/run/<int:step36_id>', methods=['GET'])
def get_step36_run(session_id: int, step36_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.get_run(session_id, int(step36_id))
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[STEP36] Get failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@step36_bp.route('/calibration/session/<int:session_id>/validation/step36/run/<int:step36_id>/stability', methods=['POST'])
def step36_stability(session_id: int, step36_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        created_by = data.get('created_by', 'user')
        n_samples = data.get('n_samples', 20)
        sample_frac = data.get('sample_frac', 0.75)
        svc, behavior_db = _get(env_id)
        result = svc.compute_stability(behavior_db, session_id, int(step36_id), int(n_samples), float(sample_frac), created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[STEP36] Stability failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

