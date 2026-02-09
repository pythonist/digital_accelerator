from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.transaction_universe.transaction_universe_service import TransactionUniverseService
from api.tools.btsy.transaction_universe.audit_service import AuditTrailService
from api.tools.btsy.behavior.behavior_service import BehaviorService
import logging

logger = logging.getLogger(__name__)
behavior_bp = Blueprint('behavior', __name__)

def _get_services(env_id: str, tenant_id: str = 'default'):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    behavior_db = folders['duckdb'] / 'behavior.duckdb'
    universe_db = folders['duckdb'] / 'universes.duckdb'
    snapshot_storage = folders['snapshots']
    audit_db_path = folders['duckdb'] / 'audit.duckdb'
    audit_service = AuditTrailService(audit_db_path)
    behavior_service = BehaviorService(behavior_db, snapshot_storage, audit_service)
    universe_service = TransactionUniverseService(universe_db, snapshot_storage, audit_service)
    return behavior_service, universe_service

@behavior_bp.route('/behavior/run/create', methods=['POST'])
def create_behavior_run():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        universe_id = data.get('universe_id')
        config = data.get('config')
        created_by = data.get('created_by', 'user')
        if not universe_id or not config:
            return jsonify({'error': 'universe_id and config required'}), 400
        behavior_service, universe_service = _get_services(env_id)
        result = behavior_service.create_behavior_run(universe_id, config, created_by, universe_service.db_path)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Create run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@behavior_bp.route('/behavior/runs/list', methods=['GET'])
def list_behavior_runs():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        universe_id = request.args.get('universe_id', type=int)
        behavior_service, _ = _get_services(env_id)
        runs = behavior_service.list_runs(universe_id)
        return jsonify({'success': True, 'data': runs}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] List runs failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@behavior_bp.route('/behavior/run/<int:run_id>/preview', methods=['GET'])
def preview_behavior_run(run_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        limit = request.args.get('limit', default=100, type=int)
        offset = request.args.get('offset', default=0, type=int)
        entity_search = request.args.get('entity_search', default=None, type=str)
        value_min = request.args.get('value_min', default=None, type=float)
        value_max = request.args.get('value_max', default=None, type=float)
        sort_by = request.args.get('sort_by', default='as_of_date', type=str)
        sort_dir = request.args.get('sort_dir', default='asc', type=str)
        behavior_service, _ = _get_services(env_id)
        rows = behavior_service.preview_run(
            run_id,
            limit,
            offset,
            entity_search=entity_search,
            value_min=value_min,
            value_max=value_max,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
        return jsonify({'success': True, 'data': rows}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Preview run failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@behavior_bp.route('/behavior/run/<int:run_id>/preview_entity', methods=['GET'])
def preview_behavior_run_entity(run_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        limit = request.args.get('limit', default=100, type=int)
        offset = request.args.get('offset', default=0, type=int)
        agg = request.args.get('agg', default='last', type=str)
        entity_search = request.args.get('entity_search', default=None, type=str)
        value_min = request.args.get('value_min', default=None, type=float)
        value_max = request.args.get('value_max', default=None, type=float)
        sort_by = request.args.get('sort_by', default=None, type=str)
        sort_dir = request.args.get('sort_dir', default='desc', type=str)
        behavior_service, _ = _get_services(env_id)
        rows = behavior_service.preview_run_entity(
            run_id,
            agg,
            limit,
            offset,
            entity_search=entity_search,
            value_min=value_min,
            value_max=value_max,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
        return jsonify({'success': True, 'data': rows}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Preview entity failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@behavior_bp.route('/behavior/entity/values', methods=['GET'])
def behavior_entity_values():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        run_ids_raw = request.args.get('run_ids', default='', type=str)
        agg = request.args.get('agg', default='max', type=str)
        limit_entities = request.args.get('limit', default=200, type=int)
        entity_search = request.args.get('entity_search', default=None, type=str)
        value_min = request.args.get('value_min', default=None, type=float)
        value_max = request.args.get('value_max', default=None, type=float)

        run_ids = [int(x) for x in (run_ids_raw.split(',') if run_ids_raw else []) if str(x).strip().isdigit()]
        if not run_ids:
            return jsonify({'error': 'run_ids required'}), 400

        behavior_service, _ = _get_services(env_id)
        data = behavior_service.entity_values(
            run_ids=run_ids,
            agg=agg,
            limit_entities=limit_entities,
            entity_search=entity_search,
            value_min=value_min,
            value_max=value_max,
        )
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Entity values failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@behavior_bp.route('/behavior/entity/timeline', methods=['GET'])
def behavior_entity_timeline():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        run_ids_raw = request.args.get('run_ids', default='', type=str)
        entity_ids_raw = request.args.get('entity_ids', default='', type=str)
        points = request.args.get('points', default=2000, type=int)

        run_ids = [int(x) for x in (run_ids_raw.split(',') if run_ids_raw else []) if str(x).strip().isdigit()]
        entity_ids = [x for x in (entity_ids_raw.split(',') if entity_ids_raw else []) if str(x).strip()]
        if not run_ids:
            return jsonify({'error': 'run_ids required'}), 400
        if not entity_ids:
            return jsonify({'error': 'entity_ids required'}), 400

        behavior_service, _ = _get_services(env_id)
        data = behavior_service.entity_timeline(run_ids=run_ids, entity_ids=entity_ids, points_per_series=points)
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Entity timeline failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@behavior_bp.route('/behavior/runs/validate', methods=['GET'])
def validate_behavior_runs():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        run_a = request.args.get('run_a', type=int)
        run_b = request.args.get('run_b', type=int)
        entity_id = request.args.get('entity_id', default=None, type=str)
        if not run_a or not run_b:
            return jsonify({'error': 'run_a and run_b required'}), 400
        behavior_service, universe_service = _get_services(env_id)
        data = behavior_service.validate_runs(run_a, run_b, universe_service.db_path, entity_id=entity_id)
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Validate runs failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@behavior_bp.route('/behavior/run/<int:run_id>/account/<entity_id>/transactions', methods=['GET'])
def behavior_account_transactions(run_id, entity_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        limit = request.args.get('limit', default=200, type=int)
        offset = request.args.get('offset', default=0, type=int)
        lookback_days = request.args.get('lookback_days', default=30, type=int)
        behavior_service, universe_service = _get_services(env_id)
        data = behavior_service.account_transactions(
            run_id=run_id,
            entity_id=entity_id,
            universe_db_path=universe_service.db_path,
            limit=limit,
            offset=offset,
            lookback_days=lookback_days,
        )
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Account transactions failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@behavior_bp.route('/behavior/run/<int:run_id>/quality', methods=['GET'])
def behavior_quality(run_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        behavior_service, _ = _get_services(env_id)
        stats = behavior_service.get_quality(run_id)
        return jsonify({'success': True, 'data': stats}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Quality failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@behavior_bp.route('/behavior/run/<int:run_id>/evidence', methods=['GET'])
def behavior_evidence(run_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        behavior_service, universe_service = _get_services(env_id)
        evidence = behavior_service.get_evidence(run_id, universe_service.db_path)
        return jsonify({'success': True, 'data': evidence}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Evidence failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@behavior_bp.route('/behavior/run/<int:run_id>/overlap/overview', methods=['GET'])
def behavior_overlap_overview(run_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        created_by = request.args.get('created_by', default='user', type=str)
        behavior_service, universe_service = _get_services(env_id)
        data = behavior_service.get_overlap_overview(run_id, created_by=created_by)
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Overlap overview failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@behavior_bp.route('/behavior/run/<int:run_id>/overlap/matrix', methods=['GET'])
def behavior_overlap_matrix(run_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        created_by = request.args.get('created_by', default='user', type=str)
        behavior_service, universe_service = _get_services(env_id)
        data = behavior_service.get_overlap_matrix(run_id, created_by=created_by)
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Overlap matrix failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@behavior_bp.route('/behavior/run/<int:run_id>/overlap/population', methods=['GET'])
def behavior_overlap_population(run_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        created_by = request.args.get('created_by', default='user', type=str)
        behavior_service, universe_service = _get_services(env_id)
        data = behavior_service.get_population_interaction_stats(run_id, created_by=created_by)
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Overlap population failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@behavior_bp.route('/behavior/run/<int:run_id>/overlap/recurring', methods=['GET'])
def behavior_overlap_recurring(run_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        created_by = request.args.get('created_by', default='user', type=str)
        limit = request.args.get('limit', default=10, type=int)
        behavior_service, universe_service = _get_services(env_id)
        data = behavior_service.get_recurring_pairs(run_id, limit=limit, created_by=created_by)
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Overlap recurring failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@behavior_bp.route('/behavior/run/<int:run_id>/overlap/entity/<entity_id>', methods=['GET'])
def behavior_overlap_entity(run_id, entity_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        created_by = request.args.get('created_by', default='user', type=str)
        behavior_service, universe_service = _get_services(env_id)
        data = behavior_service.get_entity_footprint(run_id, entity_id, created_by=created_by)
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Entity footprint failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@behavior_bp.route('/behavior/run/<int:run_id>/signal_intelligence', methods=['GET'])
def behavior_signal_intelligence(run_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        compare_run_id = request.args.get('compare_run_id', default=None, type=int)
        behavior_service, universe_service = _get_services(env_id)
        data = behavior_service.get_signal_intelligence(run_id, universe_service.db_path, compare_run_id=compare_run_id)
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Signal intelligence failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@behavior_bp.route('/behavior/run/<int:run_id>/export', methods=['GET'])
def behavior_export(run_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        fmt = request.args.get('format', default='parquet')
        behavior_service, _ = _get_services(env_id)
        result = behavior_service.export_run(run_id, fmt)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Export failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@behavior_bp.route('/behavior/run/<int:run_id>/top/entities', methods=['GET'])
def behavior_top_entities(run_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        k = request.args.get('k', default=20, type=int)
        behavior_service, _ = _get_services(env_id)
        rows = behavior_service.top_entities(run_id, k)
        return jsonify({'success': True, 'data': rows}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Top entities failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@behavior_bp.route('/behavior/run/<int:run_id>/aggregate/median_by_day', methods=['GET'])
def behavior_median_by_day(run_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        behavior_service, _ = _get_services(env_id)
        rows = behavior_service.median_by_day(run_id)
        return jsonify({'success': True, 'data': rows}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Median by day failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@behavior_bp.route('/behavior/compare/data', methods=['GET'])
def behavior_compare_data():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        run_a = request.args.get('run_a', type=int)
        run_b = request.args.get('run_b', type=int)
        agg = request.args.get('agg', default='max')
        if not run_a or not run_b:
            return jsonify({'error': 'run_a and run_b required'}), 400
        behavior_service, _ = _get_services(env_id)
        data = behavior_service.compare_runs(run_a, run_b, agg)
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[BEHAVIOR] Compare data failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
