from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.risk_population.risk_population_service import RiskPopulationService
import logging

logger = logging.getLogger(__name__)
risk_bp = Blueprint('risk_population', __name__)


def _get(env_id: str, tenant_id: str = 'default'):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    behavior_db = folders['duckdb'] / 'behavior.duckdb'
    return RiskPopulationService(workbench_db), behavior_db


@risk_bp.route('/calibration/session/<int:session_id>/risk/boundary/create', methods=['POST'])
def create_boundary(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        strategy_id = data.get('strategy_id')
        buffer_type = data.get('buffer_type', 'hard')
        buffer_params = data.get('buffer_params') or {}
        created_by = data.get('created_by', 'user')
        if not strategy_id:
            return jsonify({'error': 'strategy_id required'}), 400

        svc, behavior_db = _get(env_id)
        result = svc.create_boundary(behavior_db, session_id, int(strategy_id), buffer_type, buffer_params, created_by)
        detail = svc.compute_boundary_stats(behavior_db, session_id, int(result['boundary_id']), created_by)
        return jsonify({'success': True, 'data': {'created': result, 'computed': detail}}), 200
    except Exception as e:
        logger.error(f"[RISK] Create boundary failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@risk_bp.route('/calibration/session/<int:session_id>/risk/boundary/list', methods=['GET'])
def list_boundaries(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.list_boundaries(session_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[RISK] List boundaries failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@risk_bp.route('/calibration/session/<int:session_id>/risk/boundary/<int:boundary_id>', methods=['GET'])
def get_boundary(session_id: int, boundary_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, behavior_db = _get(env_id)
        created_by = request.args.get('created_by', default='user', type=str)
        computed = svc.compute_boundary_stats(behavior_db, session_id, boundary_id, created_by)
        result = svc.get_boundary(session_id, boundary_id)
        result['computed'] = computed
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[RISK] Get boundary failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@risk_bp.route('/calibration/session/<int:session_id>/risk/boundary/<int:boundary_id>/stress', methods=['POST'])
def stress_boundary(session_id: int, boundary_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        deltas = data.get('deltas_pct') or [-5, -2, -1, 1, 2, 5]
        created_by = data.get('created_by', 'user')
        svc, behavior_db = _get(env_id)
        result = svc.stress_boundary(behavior_db, session_id, boundary_id, deltas, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[RISK] Stress boundary failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@risk_bp.route('/calibration/session/<int:session_id>/risk/boundary/<int:boundary_id>/borderline', methods=['GET'])
def borderline(session_id: int, boundary_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        limit = request.args.get('limit', default=50, type=int)
        svc, behavior_db = _get(env_id)
        result = svc.borderline_entities(behavior_db, session_id, boundary_id, limit=limit)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[RISK] Borderline failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@risk_bp.route('/calibration/session/<int:session_id>/risk/overlap', methods=['POST'])
def overlap(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        boundary_a = data.get('boundary_a')
        boundary_b = data.get('boundary_b')
        created_by = data.get('created_by', 'user')
        if not boundary_a or not boundary_b:
            return jsonify({'error': 'boundary_a and boundary_b required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.overlap_boundaries(behavior_db, session_id, int(boundary_a), int(boundary_b), created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[RISK] Overlap failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@risk_bp.route('/calibration/session/<int:session_id>/risk/boundary/<int:boundary_id>/annotation', methods=['POST'])
def add_annotation(session_id: int, boundary_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        text = data.get('annotation_text')
        created_by = data.get('created_by', 'user')
        if not text:
            return jsonify({'error': 'annotation_text required'}), 400
        svc, _ = _get(env_id)
        result = svc.add_annotation(session_id, boundary_id, text, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[RISK] Add annotation failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
