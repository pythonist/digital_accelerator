from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.validation.str_alignment_service import STRAlignmentService
import logging


logger = logging.getLogger(__name__)
str_validation_bp = Blueprint('str_validation', __name__)


def _get(env_id: str, tenant_id: str = 'default'):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    behavior_db = folders['duckdb'] / 'behavior.duckdb'
    universes_db = folders['duckdb'] / 'universes.duckdb'
    snapshots_db = folders['duckdb'] / 'snapshots.duckdb'
    normalized = folders['normalized']
    return STRAlignmentService(workbench_db, universes_db, snapshots_db, normalized), behavior_db


@str_validation_bp.route('/calibration/session/<int:session_id>/validation/str_alignment/context', methods=['GET'])
def context(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.get_context(behavior_db, session_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[STR_VALIDATION] Context failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@str_validation_bp.route('/calibration/session/<int:session_id>/validation/str_alignment/run/list', methods=['GET'])
def list_runs(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.list_alignment_runs(session_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[STR_VALIDATION] List runs failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@str_validation_bp.route('/calibration/session/<int:session_id>/validation/str_alignment/run/create', methods=['POST'])
def create_run(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        alert_run_id = data.get('alert_run_id')
        created_by = data.get('created_by', 'user')
        if not alert_run_id:
            return jsonify({'error': 'alert_run_id required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.create_alignment_run(behavior_db, session_id, int(alert_run_id), created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[STR_VALIDATION] Create run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@str_validation_bp.route('/validation/str_alignment/run/<int:run_id>', methods=['GET'])
def get_run(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.get_alignment_run(run_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[STR_VALIDATION] Get run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@str_validation_bp.route('/validation/str_alignment/run/<int:run_id>/diagnostics', methods=['GET'])
def get_diagnostics(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.get_alignment_diagnostics(behavior_db, int(run_id))
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[STR_VALIDATION] Diagnostics failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@str_validation_bp.route('/validation/str_alignment/run/<int:run_id>/missed/classify', methods=['POST'])
def classify_missed(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        created_by = data.get('created_by', 'user')
        svc, behavior_db = _get(env_id)
        result = svc.classify_missed(behavior_db, int(run_id), created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[STR_VALIDATION] Classify missed failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@str_validation_bp.route('/validation/missed_str/run/<int:missed_run_id>', methods=['GET'])
def get_missed_run(missed_run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        root_cause_code = request.args.get('root_cause_code')
        limit = request.args.get('limit', default=200, type=int)
        offset = request.args.get('offset', default=0, type=int)
        svc, _ = _get(env_id)
        result = svc.get_missed_run(int(missed_run_id), limit=limit, offset=offset, root_cause_code=root_cause_code)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[STR_VALIDATION] Get missed run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
