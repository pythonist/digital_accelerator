from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.alerting.eligibility_alert_service import EligibilityAlertService
import logging

logger = logging.getLogger(__name__)
alerting_bp = Blueprint('alerting', __name__)


def _get(env_id: str, tenant_id: str = 'default'):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    behavior_db = folders['duckdb'] / 'behavior.duckdb'
    universes_db = folders['duckdb'] / 'universes.duckdb'
    snapshots_db = folders['duckdb'] / 'snapshots.duckdb'
    normalized = folders['normalized']
    return EligibilityAlertService(workbench_db, universes_db, snapshots_db, normalized), behavior_db


@alerting_bp.route('/calibration/session/<int:session_id>/alerting/context', methods=['GET'])
def context(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.get_policy_context(behavior_db, session_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ALERTING] Context failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@alerting_bp.route('/calibration/session/<int:session_id>/alerting/preview', methods=['POST'])
def preview(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        mode = data.get('mode', 'preview')
        overrides = data.get('overrides') or {}
        svc, behavior_db = _get(env_id)
        result = svc.preview(behavior_db, session_id, mode=mode, overrides=overrides)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ALERTING] Preview failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@alerting_bp.route('/calibration/session/<int:session_id>/alerting/run/generate', methods=['POST'])
def generate(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        created_by = data.get('created_by', 'user')
        svc, behavior_db = _get(env_id)
        result = svc.generate(behavior_db, session_id, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ALERTING] Generate failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@alerting_bp.route('/calibration/session/<int:session_id>/alerting/run/list', methods=['GET'])
def list_runs(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.list_runs(session_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ALERTING] List runs failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@alerting_bp.route('/calibration/session/<int:session_id>/alerting/run/<int:alert_run_id>', methods=['GET'])
def get_run(session_id: int, alert_run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.get_run(session_id, alert_run_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ALERTING] Get run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
