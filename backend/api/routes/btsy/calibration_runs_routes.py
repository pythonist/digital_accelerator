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
        logic_config = data.get('logic_config') or {}
        if not snapshot_id:
            return jsonify({'error': 'snapshot_id required'}), 400
        svc = _get(env_id)
        run = svc.create_run(
            env_id=env_id,
            snapshot_id=str(snapshot_id),
            created_by=str(created_by),
            notes=notes,
            logic_config=logic_config
        )
        next_url = f"/calibration/run/{run.get('run_id')}"
        return jsonify({'success': True, 'data': run, 'next_url': next_url}), 200
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


@calibration_runs_bp.route('/calibration/run/<run_id>', methods=['GET'])
def get_calibration_run(run_id: str):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc = _get(env_id)
        try:
            run = svc.get_run_by_id(env_id=env_id, run_id=str(run_id))
        except ValueError:
            if str(run_id).isdigit():
                run = svc.get_run(env_id=env_id, calibration_run_id=int(run_id))
            else:
                raise
        return jsonify({'success': True, 'data': run}), 200
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 404
    except Exception as e:
        logger.error(f"[BTSY][CAL_RUN] Get failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_runs_bp.route('/calibration/run/<run_id>/activate', methods=['POST'])
def activate_calibration_run(run_id: str):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc = _get(env_id)
        if str(run_id).isdigit():
            run = svc.set_active(env_id=env_id, calibration_run_id=int(run_id), active=True)
        else:
            run = svc.set_active_by_id(env_id=env_id, run_id=str(run_id), active=True)
        return jsonify({'success': True, 'data': run}), 200
    except Exception as e:
        logger.error(f"[BTSY][CAL_RUN] Activate failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_runs_bp.route('/calibration/run/<run_id>/clone', methods=['POST'])
def clone_calibration_run(run_id: str):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        created_by = data.get('created_by', 'user')
        notes = data.get('notes')
        logic_config = data.get('logic_config') or {}
        svc = _get(env_id)
        resolved_run_id = str(run_id)
        if resolved_run_id.isdigit():
            base = svc.get_run(env_id=env_id, calibration_run_id=int(resolved_run_id))
            resolved_run_id = str(base.get("run_id") or resolved_run_id)
        new_run = svc.clone_run_by_id(env_id=env_id, run_id=resolved_run_id, created_by=str(created_by), notes=notes, logic_config=logic_config)
        return jsonify({'success': True, 'data': new_run}), 200
    except Exception as e:
        logger.error(f"[BTSY][CAL_RUN] Clone failed: {e}", exc_info=True)
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
