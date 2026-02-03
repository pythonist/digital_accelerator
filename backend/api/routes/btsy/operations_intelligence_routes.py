from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.operations_intelligence.operations_intelligence_service import OperationsIntelligenceService, WorkloadConfig
import logging


logger = logging.getLogger(__name__)
ops_bp = Blueprint('operations_intelligence', __name__)


def _get(env_id: str, tenant_id: str = 'default'):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    return OperationsIntelligenceService(workbench_db)


@ops_bp.route('/operations/alert_runs/list', methods=['GET'])
def list_alert_runs():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        limit = request.args.get('limit', default=200, type=int)
        svc = _get(env_id)
        result = svc.list_alert_runs(limit=limit)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[OPS] List alert runs failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ops_bp.route('/operations/scenario_interaction/run/list', methods=['GET'])
def list_scenario_interaction_runs():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc = _get(env_id)
        result = svc.list_scenario_interaction_runs()
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[OPS] List scenario interaction runs failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ops_bp.route('/operations/scenario_interaction/run', methods=['POST'])
def run_scenario_interaction():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        alert_run_ids = data.get('alert_run_ids') or []
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        created_by = data.get('created_by', 'user')
        svc = _get(env_id)
        result = svc.run_scenario_interaction(alert_run_ids, start_date, end_date, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[OPS] Run scenario interaction failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ops_bp.route('/operations/scenario_interaction/run/<int:run_id>', methods=['GET'])
def get_scenario_interaction_run(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc = _get(env_id)
        result = svc.get_scenario_interaction_run(run_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[OPS] Get scenario interaction run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ops_bp.route('/operations/workload/run/list', methods=['GET'])
def list_workload_runs():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc = _get(env_id)
        result = svc.list_workload_runs()
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[OPS] List workload runs failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ops_bp.route('/operations/workload/run', methods=['POST'])
def run_workload():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        alert_run_ids = data.get('alert_run_ids') or []
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        created_by = data.get('created_by', 'user')
        cfg = data.get('config') or {}
        wc = WorkloadConfig(
            analysts=int(cfg.get('analysts', 10)),
            alerts_per_analyst=int(cfg.get('alerts_per_analyst', 15)),
            sla_days=int(cfg.get('sla_days', 3)),
        )
        svc = _get(env_id)
        result = svc.run_workload_simulation(alert_run_ids, start_date, end_date, wc, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[OPS] Run workload failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@ops_bp.route('/operations/workload/run/<int:run_id>', methods=['GET'])
def get_workload_run(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        svc = _get(env_id)
        result = svc.get_workload_run(run_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[OPS] Get workload run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

