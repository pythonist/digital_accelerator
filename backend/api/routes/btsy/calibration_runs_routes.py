from flask import Blueprint, request, jsonify
import logging

from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.calibration_runs.calibration_run_service import CalibrationRunService


logger = logging.getLogger(__name__)
calibration_runs_bp = Blueprint('btsy_calibration_runs', __name__)


def _get(env_id: str, tenant_id: str = 'default') -> CalibrationRunService:
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    return CalibrationRunService(workbench_db)


@calibration_runs_bp.route('/calibration/run/create', methods=['POST'])
def create_calibration_run():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        snapshot_id = data.get('snapshot_id')
        created_by = data.get('created_by', 'user')
        notes = data.get('notes')
        if not snapshot_id:
            return jsonify({'error': 'snapshot_id required'}), 400
        svc = _get(env_id)
        run = svc.create_run(env_id=env_id, snapshot_id=str(snapshot_id), created_by=str(created_by), notes=notes)
        return jsonify({'success': True, 'data': run}), 200
    except Exception as e:
        logger.error(f"[BTSY][CAL_RUN] Create failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_runs_bp.route('/calibration/run/list', methods=['GET'])
def list_calibration_runs():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        limit = request.args.get('limit', default=200, type=int)
        svc = _get(env_id)
        runs = svc.list_runs(env_id=env_id, limit=limit)
        return jsonify({'success': True, 'data': runs}), 200
    except Exception as e:
        logger.error(f"[BTSY][CAL_RUN] List failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_runs_bp.route('/calibration/run/<int:calibration_run_id>', methods=['GET'])
def get_calibration_run(calibration_run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc = _get(env_id)
        run = svc.get_run(env_id=env_id, calibration_run_id=int(calibration_run_id))
        return jsonify({'success': True, 'data': run}), 200
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 404
    except Exception as e:
        logger.error(f"[BTSY][CAL_RUN] Get failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_runs_bp.route('/calibration/run/<int:calibration_run_id>/activate', methods=['POST'])
def activate_calibration_run(calibration_run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc = _get(env_id)
        run = svc.set_active(env_id=env_id, calibration_run_id=int(calibration_run_id), active=True)
        return jsonify({'success': True, 'data': run}), 200
    except Exception as e:
        logger.error(f"[BTSY][CAL_RUN] Activate failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_runs_bp.route('/calibration/run/active', methods=['GET'])
def get_active_calibration_run():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc = _get(env_id)
        run = svc.get_active(env_id=env_id)
        return jsonify({'success': True, 'data': run}), 200
    except Exception as e:
        logger.error(f"[BTSY][CAL_RUN] Active failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
