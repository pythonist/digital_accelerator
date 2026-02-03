from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.validation.ml_validation_service import MLValidationService
import logging

logger = logging.getLogger(__name__)
ml_validation_bp = Blueprint('ml_validation', __name__)


def _get(env_id: str, tenant_id: str = 'default'):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    behavior_db = folders['duckdb'] / 'behavior.duckdb'
    return MLValidationService(workbench_db), behavior_db


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/training_preview', methods=['POST'])
def training_preview(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        boundary_id = data.get('boundary_id')
        if not boundary_id:
            return jsonify({'error': 'boundary_id required'}), 400
        svc, behavior_db = _get(env_id)
        preview = svc.training_preview(behavior_db, session_id, int(boundary_id))
        return jsonify({'success': True, 'data': preview}), 200
    except Exception as e:
        logger.error(f"[ML] Training preview failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/preview', methods=['POST'])
def preview(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        boundary_id = data.get('boundary_id')
        training_mode = data.get('training_mode', 'BTL')
        params = data.get('params') or {}
        if not boundary_id:
            return jsonify({'error': 'boundary_id required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.preview(behavior_db, session_id, int(boundary_id), training_mode, params=params)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] Preview failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/run/save', methods=['POST'])
def save_run(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        boundary_id = data.get('boundary_id')
        training_mode = data.get('training_mode', 'BTL')
        params = data.get('params') or {}
        analyst_note = data.get('analyst_note')
        support_level = data.get('support_level')
        limitations = data.get('limitations')
        created_by = data.get('created_by', 'user')
        if not boundary_id:
            return jsonify({'error': 'boundary_id required'}), 400
        if not analyst_note or not support_level:
            return jsonify({'error': 'analyst_note and support_level required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.save_run(behavior_db, session_id, int(boundary_id), training_mode, analyst_note, support_level, limitations, created_by, params=params)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] Save run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/dbscan/preview', methods=['POST'])
def dbscan_preview(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        boundary_id = data.get('boundary_id')
        eps = data.get('eps')
        min_samples = data.get('min_samples')
        if not boundary_id:
            return jsonify({'error': 'boundary_id required'}), 400
        if eps is None or min_samples is None:
            return jsonify({'error': 'eps and min_samples required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.dbscan_preview(behavior_db, session_id, int(boundary_id), float(eps), int(min_samples))
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] DBSCAN preview failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/dbscan/run/save', methods=['POST'])
def dbscan_save_run(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        boundary_id = data.get('boundary_id')
        eps = data.get('eps')
        min_samples = data.get('min_samples')
        analyst_note = data.get('analyst_note')
        support_level = data.get('support_level')
        limitations = data.get('limitations')
        created_by = data.get('created_by', 'user')
        if not boundary_id:
            return jsonify({'error': 'boundary_id required'}), 400
        if eps is None or min_samples is None:
            return jsonify({'error': 'eps and min_samples required'}), 400
        if not analyst_note or not support_level:
            return jsonify({'error': 'analyst_note and support_level required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.dbscan_save_run(behavior_db, session_id, int(boundary_id), float(eps), int(min_samples), analyst_note, support_level, limitations, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] DBSCAN save failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/dbscan/run/list', methods=['GET'])
def dbscan_list_runs(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.list_dbscan_runs(int(session_id))
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] DBSCAN list failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/dbscan/run/<int:dbscan_run_id>', methods=['GET'])
def dbscan_get_run(session_id: int, dbscan_run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.get_dbscan_run(int(session_id), int(dbscan_run_id))
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] DBSCAN get failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/dbscan/run/<int:dbscan_run_id>', methods=['DELETE'])
def dbscan_delete_run(session_id: int, dbscan_run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json(silent=True) or {}
        created_by = data.get('created_by', 'user')
        svc, _ = _get(env_id)
        svc.delete_dbscan_run(int(session_id), int(dbscan_run_id), created_by)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.error(f"[ML] DBSCAN delete failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/cross_compare', methods=['GET'])
def cross_compare(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.cross_algorithm(int(session_id))
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] Cross compare failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/recommendation_pack', methods=['POST'])
def recommendation_pack(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json(silent=True) or {}
        created_by = data.get('created_by', 'user')
        svc, _ = _get(env_id)
        result = svc.recommendation_pack(int(session_id), created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] Recommendation pack failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/run/list', methods=['GET'])
def list_runs(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.list_runs(session_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] List runs failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/run/<int:ml_run_id>', methods=['GET'])
def get_run(session_id: int, ml_run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.get_run(ml_run_id)
        if int(result['run']['session_id']) != int(session_id):
            return jsonify({'error': 'ML run not found for session'}), 404
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] Get run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/run/<int:ml_run_id>', methods=['DELETE'])
def delete_run(session_id: int, ml_run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json(silent=True) or {}
        created_by = data.get('created_by', 'user')
        svc, _ = _get(env_id)
        svc.delete_run(session_id, ml_run_id, created_by)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.error(f"[ML] Delete run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/coverage', methods=['GET'])
def coverage_map(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        ml_run_id = request.args.get('run_id', type=int)
        if not ml_run_id:
            return jsonify({'error': 'run_id required'}), 400
        svc, _ = _get(env_id)
        result = svc.coverage_map(int(ml_run_id))
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] Coverage map failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/cbp', methods=['GET'])
def cbp(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        boundary_id = request.args.get('boundary_id', type=int)
        entity_id = request.args.get('entity_id')
        band_low = request.args.get('band_low', type=float)
        band_high = request.args.get('band_high', type=float)
        if not boundary_id:
            return jsonify({'error': 'boundary_id required'}), 400
        if not entity_id and (band_low is None or band_high is None):
            return jsonify({'error': 'entity_id or band_low/band_high required'}), 400
        svc, behavior_db = _get(env_id)
        result = svc.cbp(behavior_db, session_id, int(boundary_id), entity_id, band_low, band_high)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] CBP failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/edt', methods=['GET'])
def edt(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc, _ = _get(env_id)
        result = svc.evidence_drift()
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] EDT failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ml_validation_bp.route('/calibration/session/<int:session_id>/ml/report', methods=['POST'])
def report(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        ml_run_id = data.get('ml_run_id')
        created_by = data.get('created_by', 'user')
        if not ml_run_id:
            return jsonify({'error': 'ml_run_id required'}), 400
        svc, _ = _get(env_id)
        result = svc.report_section(session_id, int(ml_run_id), created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[ML] Report section failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
