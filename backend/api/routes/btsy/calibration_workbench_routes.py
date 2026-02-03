from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.transaction_universe.audit_service import AuditTrailService
from api.tools.btsy.behavior.behavior_service import BehaviorService
from api.tools.btsy.calibration_workbench.calibration_workbench_service import CalibrationWorkbenchService
from api.tools.btsy.risk_population.risk_population_service import RiskPopulationService
from api.tools.btsy.validation.ks_validation_service import KSValidationService
from api.tools.btsy.validation.j_statistic_service import JStatisticService
import logging
import json
import duckdb

logger = logging.getLogger(__name__)
calibration_workbench_bp = Blueprint('calibration_workbench', __name__)


def _get_services(env_id: str, tenant_id: str = 'default'):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    audit_db_path = folders['duckdb'] / 'audit.duckdb'
    audit_service = AuditTrailService(audit_db_path)

    behavior_db = folders['duckdb'] / 'behavior.duckdb'
    behavior_service = BehaviorService(behavior_db, folders['snapshots'], audit_service)

    workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    workbench_service = CalibrationWorkbenchService(workbench_db, audit_service)
    return workbench_service, behavior_service, audit_service, folders


@calibration_workbench_bp.route('/calibration/session/create', methods=['POST'])
def create_session():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        behavior_run_id = data.get('behavior_run_id')
        created_by = data.get('created_by', 'user')
        if not behavior_run_id:
            return jsonify({'error': 'behavior_run_id required'}), 400

        workbench_service, behavior_service, _, _ = _get_services(env_id)
        result = workbench_service.create_session(behavior_service.db_path, int(behavior_run_id), created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[CALIBRATION] Create session failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_workbench_bp.route('/calibration/session/list', methods=['GET'])
def list_sessions():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        behavior_run_id = request.args.get('behavior_run_id', type=int)
        workbench_service, _, _, _ = _get_services(env_id)
        result = workbench_service.list_sessions(behavior_run_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[CALIBRATION] List sessions failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_workbench_bp.route('/calibration/session/<int:session_id>', methods=['GET'])
def get_session(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        workbench_service, _, _, _ = _get_services(env_id)
        result = workbench_service.get_session(session_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[CALIBRATION] Get session failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_workbench_bp.route('/calibration/session/<int:session_id>/freeze', methods=['POST'])
def freeze_session(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        created_by = data.get('created_by', 'user')
        workbench_service, _, _, _ = _get_services(env_id)
        result = workbench_service.freeze_session(session_id, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[CALIBRATION] Freeze session failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_workbench_bp.route('/calibration/session/<int:session_id>/aggregation', methods=['PUT'])
def set_aggregation(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        entity_collapse = data.get('entity_collapse', 'max')
        time_lens = data.get('time_lens', 'full')
        sustained_days = data.get('sustained_days', 3)
        created_by = data.get('created_by', 'user')
        workbench_service, _, _, _ = _get_services(env_id)
        result = workbench_service.set_aggregation(session_id, entity_collapse, time_lens, sustained_days, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[CALIBRATION] Set aggregation failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_workbench_bp.route('/calibration/session/<int:session_id>/aggregate_view', methods=['GET'])
def aggregate_view(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        limit_entities = request.args.get('limit_entities', default=200, type=int)
        workbench_service, behavior_service, _, _ = _get_services(env_id)
        result = workbench_service.get_aggregate_view(behavior_service.db_path, session_id, limit_entities=limit_entities)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[CALIBRATION] Aggregate view failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_workbench_bp.route('/calibration/session/<int:session_id>/strategy', methods=['POST'])
def add_strategy(session_id: int):
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

        workbench_service, behavior_service, _, _ = _get_services(env_id)
        result = workbench_service.add_strategy(behavior_service.db_path, session_id, name, strategy_type, params, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[CALIBRATION] Add strategy failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_workbench_bp.route('/calibration/session/<int:session_id>/annotation', methods=['POST'])
def add_annotation(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        annotation_type = data.get('annotation_type')
        text = data.get('text')
        created_by = data.get('created_by', 'user')
        if not annotation_type or not text:
            return jsonify({'error': 'annotation_type and text required'}), 400
        workbench_service, _, _, _ = _get_services(env_id)
        result = workbench_service.add_annotation(session_id, annotation_type, text, created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[CALIBRATION] Add annotation failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_workbench_bp.route('/calibration/session/<int:session_id>/event', methods=['POST'])
def add_event(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        event_type = data.get('event_type')
        event = data.get('event') or {}
        created_by = data.get('created_by', 'user')
        if not event_type:
            return jsonify({'error': 'event_type required'}), 400

        workbench_service, _, _, _ = _get_services(env_id)
        workbench_service._log_event(int(session_id), str(event_type), event, created_by)
        return jsonify({'success': True, 'data': {'session_id': int(session_id), 'event_type': str(event_type)}}), 200
    except Exception as e:
        logger.error(f"[CALIBRATION] Add event failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_workbench_bp.route('/calibration/session/<int:session_id>/entity/<entity_id>', methods=['GET'])
def entity_drilldown(session_id: int, entity_id: str):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        workbench_service, behavior_service, _, _ = _get_services(env_id)
        result = workbench_service.get_entity_drilldown(behavior_service.db_path, session_id, entity_id)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[CALIBRATION] Entity drilldown failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@calibration_workbench_bp.route('/calibration/session/<int:session_id>/finalize/summary', methods=['GET'])
def finalize_summary(session_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        boundary_id = request.args.get('boundary_id', type=int)

        workbench_service, behavior_service, _, folders = _get_services(env_id)
        workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
        behavior_db = folders['duckdb'] / 'behavior.duckdb'

        session_data = workbench_service.get_session(int(session_id))
        sess = session_data.get('session') if isinstance(session_data, dict) else None
        if not sess:
            return jsonify({'error': 'Session not found'}), 404

        behavior_run_id = int(sess.get('behavior_run_id'))
        behavior_run = None
        conn = duckdb.connect(str(behavior_db))
        try:
            row = conn.execute(
                """
                SELECT behavior_run_id, universe_id, entity_level, total_rows, total_entities, started_at, finished_at, status, config_json
                FROM behavior_runs
                WHERE behavior_run_id = ?
                """,
                [behavior_run_id],
            ).fetchone()
            if row:
                cfg = json.loads(row[8]) if row[8] else {}
                metric = (cfg.get('metrics') or [{}])[0] if isinstance(cfg, dict) else {}
                behavior_run = {
                    'behavior_run_id': int(row[0]),
                    'universe_id': int(row[1]) if row[1] is not None else None,
                    'entity_level': row[2],
                    'total_rows': int(row[3] or 0),
                    'total_entities': int(row[4] or 0),
                    'started_at': str(row[5]) if row[5] is not None else None,
                    'finished_at': str(row[6]) if row[6] is not None else None,
                    'status': row[7],
                    'metric': {
                        'name': metric.get('name'),
                        'type': metric.get('type'),
                        'column': metric.get('column'),
                        'window': metric.get('window'),
                    },
                }
        finally:
            conn.close()

        aggregate_view = workbench_service.get_aggregate_view(behavior_service.db_path, int(session_id), limit_entities=10)

        risk = RiskPopulationService(workbench_db)
        boundaries = risk.list_boundaries(int(session_id))
        chosen_boundary_id = int(boundary_id) if boundary_id else (int(boundaries[0]['boundary_id']) if boundaries else None)
        boundary = None
        if chosen_boundary_id:
            boundary = risk.get_boundary(int(session_id), int(chosen_boundary_id))
            computed = risk.compute_boundary_stats(behavior_db, int(session_id), int(chosen_boundary_id), created_by='system')
            boundary['computed'] = computed

        ks = KSValidationService(workbench_db)
        ks_runs = ks.list_runs(int(session_id))
        ks_for_boundary = [r for r in ks_runs if chosen_boundary_id and int(r.get('boundary_id')) == int(chosen_boundary_id)]
        ks_detail = ks.get_run(int(ks_for_boundary[0]['ks_run_id'])) if ks_for_boundary else None

        jsvc = JStatisticService(workbench_db)
        step36_runs = jsvc.list_runs(int(session_id))
        step36_for_boundary = [r for r in step36_runs if chosen_boundary_id and int(r.get('boundary_id')) == int(chosen_boundary_id)]
        step36_detail = jsvc.get_run(int(session_id), int(step36_for_boundary[0]['step36_id'])) if step36_for_boundary else None

        ready = bool(aggregate_view) and bool(boundary) and (bool(ks_detail) or bool(step36_detail))

        events = session_data.get('events') or []
        try:
            events = sorted(events, key=lambda e: int(e.get('event_id', 0)))
        except Exception:
            pass

        boundary_comparison = None
        try:
            if boundaries and len(boundaries) >= 2:
                a = int(boundaries[1]['boundary_id'])
                b = int(boundaries[0]['boundary_id'])
                boundary_comparison = risk.overlap_boundaries(behavior_db, int(session_id), a, b, created_by='system')
        except Exception:
            boundary_comparison = None

        return jsonify(
            {
                'success': True,
                'data': {
                    'session': sess,
                    'behavior_run': behavior_run,
                    'aggregation': session_data.get('aggregation'),
                    'strategies': session_data.get('strategies') or [],
                    'aggregate_view': aggregate_view,
                    'boundaries': boundaries,
                    'selected_boundary': boundary,
                    'ks_runs': ks_runs,
                    'ks': ks_detail,
                    'step36_runs': step36_runs,
                    'step36': step36_detail,
                    'events': events,
                    'annotations': session_data.get('annotations') or [],
                    'boundary_comparison': boundary_comparison,
                    'ready_to_freeze': ready,
                },
            }
        ), 200
    except Exception as e:
        logger.error(f"[CALIBRATION] Finalize summary failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
