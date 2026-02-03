from flask import Blueprint, request, jsonify, send_file
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.autorun.autorun_registry import AutoRunRegistry
from api.tools.btsy.autorun.autorun_executor import AutoRunExecutor
from api.tools.btsy.autorun.autorun_service import AutoRunService
import logging
from pathlib import Path
import re

import duckdb


logger = logging.getLogger(__name__)
autorun_bp = Blueprint('autorun', __name__)

_executors = {}


def _get_services(env_id: str, tenant_id: str = 'default'):
    btsy = get_btsy_service()
    folders = btsy.init_env_structure(tenant_id, env_id)
    index_db = folders['duckdb'] / 'calibration_workbench.duckdb'
    key = f"{tenant_id}:{env_id}:{str(index_db)}"
    if key not in _executors:
        registry = AutoRunRegistry(index_db)
        executor = AutoRunExecutor(registry, max_workers=2)
        _executors[key] = (registry, executor, folders)
    return _executors[key][0], _executors[key][1], _executors[key][2]


@autorun_bp.route('/auto_run/calibration_runs', methods=['POST'])
def create_run():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        snapshot_id = data.get('snapshot_id')
        session_id = data.get('session_id')
        mode = data.get('mode', 'simulation')
        created_by = data.get('created_by', 'user')
        if not snapshot_id or not session_id:
            return jsonify({'error': 'snapshot_id and session_id required'}), 400
        registry, executor, folders = _get_services(env_id)
        svc = AutoRunService(folders, registry, executor, tenant_id='default', env_id=env_id)
        result = svc.create_run(snapshot_id=str(snapshot_id), session_id=int(session_id), mode=str(mode), created_by=created_by)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[AUTORUN] Create failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@autorun_bp.route('/auto_run/calibration_runs', methods=['GET'])
def list_runs():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        limit = request.args.get('limit', default=200, type=int)
        registry, executor, folders = _get_services(env_id)
        _ = executor
        svc = AutoRunService(folders, registry, executor, tenant_id='default', env_id=env_id)
        result = svc.list_runs(limit=limit)
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[AUTORUN] List failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@autorun_bp.route('/auto_run/calibration_runs/<int:run_id>', methods=['GET'])
def get_run(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        registry, executor, folders = _get_services(env_id)
        _ = executor
        svc = AutoRunService(folders, registry, executor, tenant_id='default', env_id=env_id)
        result = svc.get_run(int(run_id))
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.error(f"[AUTORUN] Get failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@autorun_bp.route('/auto_run/calibration_runs/<int:run_id>/report', methods=['GET'])
def get_report(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        registry, executor, folders = _get_services(env_id)
        _ = executor
        svc = AutoRunService(folders, registry, executor, tenant_id='default', env_id=env_id)
        r = svc.get_run(int(run_id))
        p = r.get('report_pdf_path')
        if not p:
            return jsonify({'error': 'Report not available'}), 404
        pdf_path = Path(p)
        if not pdf_path.exists():
            return jsonify({'error': 'Report file missing'}), 404
        return send_file(str(pdf_path), mimetype='application/pdf', as_attachment=False, download_name=f'calibration_run_{run_id}.pdf')
    except Exception as e:
        logger.error(f"[AUTORUN] Report failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@autorun_bp.route('/auto_run/calibration_runs/<int:run_id>/log', methods=['GET'])
def get_log(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        tail = request.args.get('tail', default=200, type=int)
        registry, executor, folders = _get_services(env_id)
        _ = executor
        svc = AutoRunService(folders, registry, executor, tenant_id='default', env_id=env_id)
        r = svc.get_run(int(run_id))
        ws = Path(r.get('workspace_path') or '')
        p = ws / 'logs' / 'run.log'
        if not p.exists():
            return jsonify({'success': True, 'data': {'lines': []}}), 200
        lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
        if tail and tail > 0:
            lines = lines[-tail:]
        return jsonify({'success': True, 'data': {'lines': lines}}), 200
    except Exception as e:
        logger.error(f"[AUTORUN] Log failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


_TABLE_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@autorun_bp.route('/auto_run/calibration_runs/<int:run_id>/evidence/steps', methods=['GET'])
def get_evidence_steps(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        registry, executor, folders = _get_services(env_id)
        _ = executor
        svc = AutoRunService(folders, registry, executor, tenant_id='default', env_id=env_id)
        r = svc.get_run(int(run_id))
        run_db_path = Path(r.get('run_db_path') or '')
        if not run_db_path.exists():
            return jsonify({'error': 'Run DB missing'}), 404
        con = duckdb.connect(str(run_db_path), read_only=True)
        try:
            rows = con.execute(
                """
                SELECT step_id, step_name, started_at, completed_at, status, input_tables, output_tables, config_json
                FROM calibration_step_run
                WHERE run_id = ?
                ORDER BY started_at ASC
                """,
                [int(run_id)],
            ).fetchall()
        finally:
            con.close()
        data = []
        for row in rows:
            data.append(
                {
                    "step_id": row[0],
                    "step_name": row[1],
                    "started_at": str(row[2]) if row[2] is not None else None,
                    "completed_at": str(row[3]) if row[3] is not None else None,
                    "status": row[4],
                    "input_tables": row[5],
                    "output_tables": row[6],
                    "config_json": row[7],
                }
            )
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[AUTORUN] Evidence steps failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@autorun_bp.route('/auto_run/calibration_runs/<int:run_id>/evidence/artifacts', methods=['GET'])
def get_evidence_artifacts(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        step_id = request.args.get('step_id')
        registry, executor, folders = _get_services(env_id)
        _ = executor
        svc = AutoRunService(folders, registry, executor, tenant_id='default', env_id=env_id)
        r = svc.get_run(int(run_id))
        run_db_path = Path(r.get('run_db_path') or '')
        if not run_db_path.exists():
            return jsonify({'error': 'Run DB missing'}), 404
        con = duckdb.connect(str(run_db_path), read_only=True)
        try:
            if step_id:
                rows = con.execute(
                    """
                    SELECT step_id, artifact_type, artifact_key, table_name, metadata_json, created_at
                    FROM calibration_step_artifact
                    WHERE run_id = ? AND step_id = ?
                    ORDER BY created_at ASC
                    """,
                    [int(run_id), str(step_id)],
                ).fetchall()
            else:
                rows = con.execute(
                    """
                    SELECT step_id, artifact_type, artifact_key, table_name, metadata_json, created_at
                    FROM calibration_step_artifact
                    WHERE run_id = ?
                    ORDER BY created_at ASC
                    """,
                    [int(run_id)],
                ).fetchall()
        finally:
            con.close()
        data = []
        for row in rows:
            data.append(
                {
                    "step_id": row[0],
                    "artifact_type": row[1],
                    "artifact_key": row[2],
                    "table_name": row[3],
                    "metadata_json": row[4],
                    "created_at": str(row[5]) if row[5] is not None else None,
                }
            )
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[AUTORUN] Evidence artifacts failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@autorun_bp.route('/auto_run/calibration_runs/<int:run_id>/evidence/inferences', methods=['GET'])
def get_evidence_inferences(run_id: int):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        step_id = request.args.get('step_id')
        registry, executor, folders = _get_services(env_id)
        _ = executor
        svc = AutoRunService(folders, registry, executor, tenant_id='default', env_id=env_id)
        r = svc.get_run(int(run_id))
        run_db_path = Path(r.get('run_db_path') or '')
        if not run_db_path.exists():
            return jsonify({'error': 'Run DB missing'}), 404
        con = duckdb.connect(str(run_db_path), read_only=True)
        try:
            if step_id:
                rows = con.execute(
                    """
                    SELECT step_id, inference_type, input_metrics_json, inference_text, generated_at
                    FROM calibration_inference
                    WHERE run_id = ? AND step_id = ?
                    ORDER BY generated_at ASC
                    """,
                    [int(run_id), str(step_id)],
                ).fetchall()
            else:
                rows = con.execute(
                    """
                    SELECT step_id, inference_type, input_metrics_json, inference_text, generated_at
                    FROM calibration_inference
                    WHERE run_id = ?
                    ORDER BY generated_at ASC
                    """,
                    [int(run_id)],
                ).fetchall()
        finally:
            con.close()
        data = []
        for row in rows:
            data.append(
                {
                    "step_id": row[0],
                    "inference_type": row[1],
                    "input_metrics_json": row[2],
                    "inference_text": row[3],
                    "generated_at": str(row[4]) if row[4] is not None else None,
                }
            )
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[AUTORUN] Evidence inferences failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@autorun_bp.route('/auto_run/calibration_runs/<int:run_id>/evidence/table/<table_name>', methods=['GET'])
def get_evidence_table(run_id: int, table_name: str):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        if not table_name or not _TABLE_NAME_RE.match(table_name):
            return jsonify({'error': 'Invalid table name'}), 400
        limit = request.args.get('limit', default=200, type=int)
        offset = request.args.get('offset', default=0, type=int)
        limit = max(1, min(int(limit or 200), 500))
        offset = max(0, int(offset or 0))
        registry, executor, folders = _get_services(env_id)
        _ = executor
        svc = AutoRunService(folders, registry, executor, tenant_id='default', env_id=env_id)
        r = svc.get_run(int(run_id))
        run_db_path = Path(r.get('run_db_path') or '')
        if not run_db_path.exists():
            return jsonify({'error': 'Run DB missing'}), 404
        con = duckdb.connect(str(run_db_path), read_only=True)
        try:
            cols = [c[1] for c in con.execute(f"PRAGMA table_info('{table_name}')").fetchall()]
            if not cols:
                return jsonify({'error': 'Table not found'}), 404
            rows = con.execute(f"SELECT * FROM {table_name} LIMIT ? OFFSET ?", [int(limit), int(offset)]).fetchall()
        finally:
            con.close()
        out_rows = [list(r) for r in rows]
        return jsonify({'success': True, 'data': {'columns': cols, 'rows': out_rows, 'limit': limit, 'offset': offset}}), 200
    except Exception as e:
        logger.error(f"[AUTORUN] Evidence table failed: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
