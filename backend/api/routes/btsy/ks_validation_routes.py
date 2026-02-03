from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.validation.ks_validation_service import KSValidationService
import logging

logger = logging.getLogger(__name__)
ks_validation_bp = Blueprint('ks_validation', __name__)


def _get(env_id: str, tenant_id: str = 'default'):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    behavior_db = folders['duckdb'] / 'behavior.duckdb'
    return KSValidationService(workbench_db), behavior_db


@ks_validation_bp.route('/calibration/session/<int:session_id>/validation/ks/run/create', methods=['POST'])
def create_ks_run(session_id: int):
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
        result = svc.create_run(behavior_db, session_id, int(boundary_id), created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[KS] Create run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ks_validation_bp.route('/calibration/session/<int:session_id>/validation/ks/run/list', methods=['GET'])
def list_ks_runs(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.list_runs(session_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[KS] List runs failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ks_validation_bp.route('/calibration/session/<int:session_id>/validation/ks/run/<int:ks_run_id>', methods=['GET'])
def get_ks_run(session_id: int, ks_run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.get_run(ks_run_id)
        if int(result['run']['session_id']) != int(session_id):
            return jsonify({'error': 'KS run not found for session'}), 404
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[KS] Get run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ks_validation_bp.route('/calibration/session/<int:session_id>/validation/ks/run/<int:ks_run_id>/stress', methods=['POST'])
def stress_ks_run(session_id: int, ks_run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        created_by = data.get('created_by', 'user')
        deltas_pct = data.get('deltas_pct') or [-5, -2, -1, 1, 2, 5]
        subsample_fracs = data.get('subsample_fracs') or [1.0, 0.5, 0.25]
        svc, behavior_db = _get(env_id)
        result = svc.stress_run(behavior_db, session_id, ks_run_id, deltas_pct, subsample_fracs, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[KS] Stress run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ks_validation_bp.route('/calibration/session/<int:session_id>/validation/ks/run/<int:ks_run_id>/annotation', methods=['POST'])
def annotate_ks_run(session_id: int, ks_run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        note = data.get('analyst_note')
        created_by = data.get('created_by', 'user')
        svc, _ = _get(env_id)
        result = svc.add_annotation(session_id, ks_run_id, note, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[KS] Add annotation failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

