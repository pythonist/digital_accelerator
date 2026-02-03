from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.threshold_simulation.threshold_simulation_service import ThresholdSimulationService
import logging

logger = logging.getLogger(__name__)
threshold_bp = Blueprint('threshold_simulation', __name__)


def _get(env_id: str, tenant_id: str = 'default'):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    behavior_db = folders['duckdb'] / 'behavior.duckdb'
    return ThresholdSimulationService(workbench_db), behavior_db


@threshold_bp.route('/calibration/session/<int:session_id>/threshold/percentile_preview', methods=['GET'])
def percentile_preview(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        pct = request.args.get('percentile', type=float)
        if pct is None:
            return jsonify({'error': 'percentile required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.preview_percentile(behavior_db, session_id, pct)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[THRESHOLD] Preview failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@threshold_bp.route('/calibration/session/<int:session_id>/threshold/strategy/list', methods=['GET'])
def list_strategies(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.list_strategies(session_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[THRESHOLD] List strategies failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@threshold_bp.route('/calibration/session/<int:session_id>/threshold/strategy/create', methods=['POST'])
def create_strategy(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        name = data.get('name')
        strategy_type = data.get('strategy_type')
        params = data.get('params') or {}
        created_by = data.get('created_by', 'user')
        if not name or not strategy_type:
            return jsonify({'error': 'name and strategy_type required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.create_strategy(behavior_db, session_id, name, strategy_type, params, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[THRESHOLD] Create strategy failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@threshold_bp.route('/calibration/session/<int:session_id>/threshold/strategy/<int:strategy_id>', methods=['DELETE'])
def delete_strategy(session_id: int, strategy_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json(silent=True) or {}
        created_by = data.get('created_by', 'user')
        svc, _ = _get(env_id)
        svc.delete_strategy(session_id, strategy_id, created_by)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.error(f"[THRESHOLD] Delete strategy failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@threshold_bp.route('/calibration/session/<int:session_id>/threshold/impact_matrix', methods=['GET'])
def impact_matrix(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        created_by = request.args.get('created_by', default='user', type=str)
        svc, behavior_db = _get(env_id)
        result = svc.impact_matrix(behavior_db, session_id, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[THRESHOLD] Impact matrix failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@threshold_bp.route('/calibration/session/<int:session_id>/threshold/overlap', methods=['POST'])
def overlap(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        strategy_ids = data.get('strategy_ids') or []
        created_by = data.get('created_by', 'user')
        if not isinstance(strategy_ids, list) or len(strategy_ids) < 2:
            return jsonify({'error': 'strategy_ids must be a list of length >= 2'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.overlap(behavior_db, session_id, [int(x) for x in strategy_ids], created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[THRESHOLD] Overlap failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@threshold_bp.route('/calibration/session/<int:session_id>/threshold/sensitivity', methods=['POST'])
def sensitivity(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        strategy_id = data.get('strategy_id')
        delta = float(data.get('delta', 1.0))
        created_by = data.get('created_by', 'user')
        if not strategy_id:
            return jsonify({'error': 'strategy_id required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.sensitivity(behavior_db, session_id, int(strategy_id), delta, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[THRESHOLD] Sensitivity failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@threshold_bp.route('/calibration/session/<int:session_id>/threshold/event', methods=['POST'])
def threshold_event(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        event_type = data.get('event_type')
        params = data.get('params') or {}
        created_by = data.get('created_by', 'user')
        if not event_type:
            return jsonify({'error': 'event_type required'}), 400
        svc, _ = _get(env_id)
        svc._log_event(session_id, event_type, params, created_by)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.error(f"[THRESHOLD] Event failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
