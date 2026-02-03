from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.signal_analysis.signal_analysis_service import SignalAnalysisService
import logging

logger = logging.getLogger(__name__)
signal_bp = Blueprint('signal_analysis', __name__)


def _get_service(env_id: str, tenant_id: str = 'default'):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    signal_service = SignalAnalysisService(workbench_db)
    return signal_service, folders


@signal_bp.route('/calibration/session/<int:session_id>/signal/compute', methods=['POST'])
def compute_signal(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        view = data.get('view') or {}
        created_by = data.get('created_by', 'user')

        signal_service, folders = _get_service(env_id)
        behavior_db = folders['duckdb'] / 'behavior.duckdb'
        workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'

        result = signal_service.compute_signal_report(
            behavior_db_path=behavior_db,
            workbench_db_path=workbench_db,
            session_id=session_id,
            view=view,
            created_by=created_by
        )
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[SIGNAL] Compute failed: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@signal_bp.route('/calibration/session/<int:session_id>/signal/event', methods=['POST'])
def log_signal_event(session_id: int):
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

        signal_service, _ = _get_service(env_id)
        signal_service.log_event(session_id, event_type, params, created_by)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.error(f"[SIGNAL] Log event failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@signal_bp.route('/calibration/session/<int:session_id>/signal/state/save', methods=['POST'])
def save_signal_state(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        name = data.get('name')
        state = data.get('state') or {}
        created_by = data.get('created_by', 'user')
        if not name:
            return jsonify({'error': 'name required'}), 400

        signal_service, _ = _get_service(env_id)
        result = signal_service.save_state(session_id, name, state, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[SIGNAL] Save state failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@signal_bp.route('/calibration/session/<int:session_id>/signal/state/list', methods=['GET'])
def list_signal_states(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        signal_service, _ = _get_service(env_id)
        result = signal_service.list_states(session_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[SIGNAL] List states failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@signal_bp.route('/calibration/session/signal/state/<int:state_id>', methods=['GET'])
def get_signal_state(state_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        signal_service, _ = _get_service(env_id)
        result = signal_service.get_state(state_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[SIGNAL] Get state failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

