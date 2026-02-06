# backend/api/routes/btsy/cortex_scenario_routes.py
"""Flask routes for the cortex scenario builder (Step 2)."""

from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.cortex.scenario_builder import CortexScenarioBuilderService
from api.tools.btsy.calibration_runs.calibration_run_service import CalibrationRunService
import duckdb

cortex_scenario_bp = Blueprint('cortex_scenario', __name__)


def _get_services(env_id: str, tenant_id: str = 'default'):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    universe_db = folders['duckdb'] / 'universes.duckdb'
    cortex_db = folders['duckdb'] / 'cortex.duckdb'
    builder = CortexScenarioBuilderService(cortex_db)
    return builder, universe_db


@cortex_scenario_bp.route('/cortex/scenario/run', methods=['POST'])
def run_cortex_scenario():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400

        data = request.get_json() or {}
        universe_id = data.get('universe_id')
        config = data.get('config') or {}
        created_by = data.get('created_by', 'user')

        if not universe_id:
            return jsonify({'error': 'universe_id required'}), 400

        builder, universe_db = _get_services(env_id)
        run = builder.create_run(int(universe_id), config, universe_db, created_by=created_by)

        preview_thresholds = builder.preview_thresholds(run['run_id'], limit=50)
        preview_worst = builder.preview_worst_case(run['run_id'], limit=20)
        preview_monthly = builder.preview_monthly_threshold(run['run_id'], limit=20)

        return jsonify({
            'success': True,
            'data': {
                'run_id': run['run_id'],
                'stats': run['stats'],
                'threshold_preview': preview_thresholds.to_dict('records'),
                'worst_case_preview': preview_worst.to_dict('records'),
                'monthly_threshold_preview': preview_monthly.to_dict('records')
            }
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cortex_scenario_bp.route('/cortex/scenario/run-by-run', methods=['POST'])
def run_cortex_scenario_by_run_id():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        run_id = data.get('run_id')
        config = data.get('config') or {}
        created_by = data.get('created_by', 'user')
        if not run_id:
            return jsonify({'error': 'run_id required'}), 400
        builder, universe_db = _get_services(env_id)
        # Derive config from calibration run if not provided, and get selected universe
        service = get_btsy_service()
        folders = service.init_env_structure('default', env_id)
        workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
        crsvc = CalibrationRunService(workbench_db)
        crun = crsvc.get_run_by_id(env_id, str(run_id))
        # Try by run_id first, fallback to calibration_run_id
        conn = duckdb.connect(str(universe_db))
        try:
            row = conn.execute("""
                SELECT id
                FROM transaction_universe_runs
                WHERE run_id = ? AND selected = TRUE
                ORDER BY selected_at DESC
                LIMIT 1
            """, [str(run_id)]).fetchone()
            if not row:
                row = conn.execute("""
                    SELECT id
                    FROM transaction_universe_runs
                    WHERE run_id = ?
                    ORDER BY created_at DESC
                    LIMIT 1
                """, [str(run_id)]).fetchone()
            if not row and crun and crun.get('calibration_run_id'):
                row = conn.execute("""
                    SELECT id
                    FROM transaction_universe_runs
                    WHERE calibration_run_id = ? AND selected = TRUE
                    ORDER BY selected_at DESC
                    LIMIT 1
                """, [int(crun.get('calibration_run_id'))]).fetchone()
                if not row:
                    row = conn.execute("""
                        SELECT id
                        FROM transaction_universe_runs
                        WHERE calibration_run_id = ?
                        ORDER BY created_at DESC
                        LIMIT 1
                    """, [int(crun.get('calibration_run_id'))]).fetchone()
        finally:
            conn.close()
        if not row:
            return jsonify({'error': 'No selected universe found for run_id'}), 404
        universe_id = int(row[0])
        derived = {
            'transaction_type': str(config.get('transaction_type') or crun.get('transaction_type') or 'ALL').upper(),
            'aggregation_level': str(config.get('aggregation_level') or crun.get('aggregation_level') or 'daily').lower(),
            'lookback_days': int(config.get('lookback_days') or crun.get('lookback_days') or 7)
        }
        run = builder.create_run(universe_id, derived, universe_db, created_by=created_by)
        preview_thresholds = builder.preview_thresholds(run['run_id'], limit=50)
        preview_worst = builder.preview_worst_case(run['run_id'], limit=20)
        preview_monthly = builder.preview_monthly_threshold(run['run_id'], limit=20)
        return jsonify({
            'success': True,
            'data': {
                'run_id': run['run_id'],
                'stats': run['stats'],
                'threshold_preview': preview_thresholds.to_dict('records'),
                'worst_case_preview': preview_worst.to_dict('records'),
                'monthly_threshold_preview': preview_monthly.to_dict('records')
            }
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cortex_scenario_bp.route('/cortex/scenario/run/<int:run_id>/thresholds', methods=['GET'])
def get_cortex_thresholds(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400

        limit = request.args.get('limit', default=50, type=int)
        offset = request.args.get('offset', default=0, type=int)

        builder, _ = _get_services(env_id)
        df = builder.preview_thresholds(run_id, limit=limit, offset=offset)
        return jsonify({'success': True, 'data': df.to_dict('records')}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cortex_scenario_bp.route('/cortex/scenario/run/<int:run_id>/worst_case', methods=['GET'])
def get_cortex_worst_case(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400

        limit = request.args.get('limit', default=20, type=int)
        offset = request.args.get('offset', default=0, type=int)

        builder, _ = _get_services(env_id)
        df = builder.preview_worst_case(run_id, limit=limit, offset=offset)
        return jsonify({'success': True, 'data': df.to_dict('records')}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cortex_scenario_bp.route('/cortex/scenario/run/<int:run_id>/monthly_threshold', methods=['GET'])
def get_cortex_monthly_threshold(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400

        limit = request.args.get('limit', default=20, type=int)
        offset = request.args.get('offset', default=0, type=int)

        builder, _ = _get_services(env_id)
        df = builder.preview_monthly_threshold(run_id, limit=limit, offset=offset)
        return jsonify({'success': True, 'data': df.to_dict('records')}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@cortex_scenario_bp.route('/cortex/scenario/run/<int:run_id>', methods=['DELETE'])
def delete_cortex_run(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        builder, _ = _get_services(env_id)
        result = builder.delete_run(run_id)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
