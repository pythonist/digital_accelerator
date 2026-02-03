from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.calibration_workbench.orchestrated_calibration_service import OrchestratedCalibrationService
import logging

logger = logging.getLogger(__name__)
ocr_bp = Blueprint('orchestrated_calibration', __name__)


def _get(env_id: str, tenant_id: str = 'default'):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    behavior_db = folders['duckdb'] / 'behavior.duckdb'
    return OrchestratedCalibrationService(workbench_db), behavior_db


@ocr_bp.route('/calibration/session/<int:session_id>/orchestrated/run/create', methods=['POST'])
def create_run(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        created_by = data.get('created_by', 'user')
        baseline_ocr_run_id = data.get('baseline_ocr_run_id')
        config = data.get('config') or {}
        config['created_by'] = created_by
        svc, behavior_db = _get(env_id)
        run = svc.create_run(session_id, config, int(baseline_ocr_run_id) if baseline_ocr_run_id else None, created_by)
        svc.start_async(int(run['run']['ocr_run_id']), behavior_db)
        return jsonify({'success': True, 'data': run}), 200
    except Exception as e:
        logger.error(f"[OCR] Create run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ocr_bp.route('/calibration/session/<int:session_id>/orchestrated/run/list', methods=['GET'])
def list_runs(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        runs = svc.list_runs(session_id)
        return jsonify({'success': True, 'data': runs}), 200
    except Exception as e:
        logger.error(f"[OCR] List runs failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ocr_bp.route('/calibration/session/<int:session_id>/orchestrated/run/<int:ocr_run_id>', methods=['GET'])
def get_run(session_id: int, ocr_run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        svc.reconcile_stalled_run(ocr_run_id)
        run = svc.get_run(ocr_run_id)
        if int(run['run']['session_id']) != int(session_id):
            return jsonify({'error': 'Orchestrated run not found for session'}), 404
        return jsonify({'success': True, 'data': run}), 200
    except Exception as e:
        logger.error(f"[OCR] Get run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ocr_bp.route('/calibration/session/<int:session_id>/orchestrated/approved', methods=['GET'])
def get_approved(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.get_approved_boundary(session_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[OCR] Get approved failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ocr_bp.route('/calibration/session/<int:session_id>/orchestrated/run/<int:ocr_run_id>/approve', methods=['POST'])
def approve(session_id: int, ocr_run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        approved_by = data.get('approved_by', 'user')
        svc, behavior_db = _get(env_id)
        result = svc.approve_and_freeze_boundary(behavior_db, session_id, ocr_run_id, approved_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[OCR] Approve failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
