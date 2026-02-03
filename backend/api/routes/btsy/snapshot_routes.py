# backend/api/routes/btsy/snapshot_routes.py
"""
BTSY Snapshot Routes - Foundation Snapshot Management
"""
from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.mapping_service import MappingService
from api.tools.btsy.snapshot_manager import SnapshotManager
from pathlib import Path
import logging
import duckdb

logger = logging.getLogger(__name__)

snapshot_bp = Blueprint('snapshot', __name__)


@snapshot_bp.route('/snapshot/create', methods=['POST'])
def create_snapshot():
    """
    Create an immutable foundation snapshot.
    This freezes the current foundation state for calibration runs.
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        data = request.get_json() or {}
        frozen_by = data.get('frozen_by', 'system')
        snapshot_id = data.get('snapshot_id')
        snapshot_name = data.get('snapshot_name')
        
        tenant_id = 'default'
        service = get_btsy_service()
        
        # Gather all foundation data
        upload_status = service.get_upload_status(tenant_id, env_id)
        
        folders = service.init_env_structure(tenant_id, env_id)
        mapping_service = MappingService(folders['state'])
        
        # Collect mappings
        mappings = {}
        for domain in ['transactions', 'accounts', 'customers', 'str']:
            mapping_state = mapping_service.load_mapping(domain)
            if mapping_state:
                mappings[domain] = mapping_state
        
        # Collect normalization results
        normalization_results = {}
        for domain in ['transactions', 'accounts', 'customers', 'str']:
            state = service.get_domain_state(tenant_id, env_id, domain)
            norm_result = state.get('normalization_result')
            if norm_result:
                normalization_results[domain] = norm_result
        
        # Add raw file paths to upload_status
        raw_path = folders['raw']
        for domain, status in upload_status.items():
            if status.get('uploaded'):
                domain_files = list(raw_path.glob(f"{domain}.*"))
                if domain_files:
                    status['raw_file_path'] = str(domain_files[0])
        
        foundation_data = {
            'upload_status': upload_status,
            'mappings': mappings,
            'normalization_results': normalization_results
        }
        
        # Verify foundation is complete
        if not mappings or not normalization_results:
            return jsonify({
                'error': 'Foundation not complete',
                'details': 'Please complete upload, mapping, and normalization steps'
            }), 400
        
        # Create snapshot
        snapshot_manager = SnapshotManager(folders['duckdb'] / 'snapshots.duckdb')
        snapshot_metadata = snapshot_manager.create_snapshot(
            tenant_id, env_id, foundation_data, frozen_by, snapshot_id=snapshot_id, snapshot_name=snapshot_name
        )
        
        logger.info(f"[BTSY] Snapshot created: {snapshot_metadata['snapshot_id']}")
        
        return jsonify({
            'success': True,
            'message': 'Foundation snapshot created',
            'data': snapshot_metadata
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Snapshot creation failed: {str(e)}", exc_info=True)
        return jsonify({
            'error': 'Failed to create snapshot',
            'details': str(e)
        }), 500


@snapshot_bp.route('/snapshot/list', methods=['GET'])
def list_snapshots():
    """List all snapshots for current environment"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        
        snapshot_manager = SnapshotManager(folders['duckdb'] / 'snapshots.duckdb')
        snapshots = snapshot_manager.list_snapshots(env_id, tenant_id)

        used_by = {}
        workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
        if workbench_db.exists():
            conn = duckdb.connect(str(workbench_db), read_only=True)
            try:
                rows = conn.execute(
                    "SELECT snapshot_id, COUNT(*) AS n FROM calibration_runs WHERE env_id = ? GROUP BY snapshot_id",
                    [env_id],
                ).fetchall()
                used_by = {str(r[0]): int(r[1] or 0) for r in rows}
            except Exception:
                used_by = {}
            finally:
                conn.close()

        out = []
        for s in snapshots:
            sid = str(s.get("snapshot_id"))
            n = int(used_by.get(sid, 0))
            status = (s.get("status") or "").lower()
            if status == "draft":
                status_label = "Draft"
            elif n > 0:
                status_label = "In Use"
            else:
                status_label = "Locked"
            s2 = dict(s)
            s2["used_by_runs"] = n
            s2["status_label"] = status_label
            out.append(s2)
        
        return jsonify({
            'success': True,
            'data': out
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] List snapshots failed: {str(e)}")
        return jsonify({'error': str(e)}), 500


@snapshot_bp.route('/snapshot/<snapshot_id>', methods=['GET'])
def get_snapshot(snapshot_id):
    """Get detailed snapshot information"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        
        snapshot_manager = SnapshotManager(folders['duckdb'] / 'snapshots.duckdb')
        snapshot = snapshot_manager.get_snapshot(snapshot_id)
        
        if not snapshot:
            return jsonify({
                'success': False,
                'error': 'Snapshot not found'
            }), 404

        used_by_runs = 0
        workbench_db = folders['duckdb'] / 'calibration_workbench.duckdb'
        if workbench_db.exists():
            conn = duckdb.connect(str(workbench_db), read_only=True)
            try:
                row = conn.execute(
                    "SELECT COUNT(*) FROM calibration_runs WHERE env_id = ? AND snapshot_id = ?",
                    [env_id, str(snapshot_id)],
                ).fetchone()
                used_by_runs = int(row[0] or 0) if row else 0
            except Exception:
                used_by_runs = 0
            finally:
                conn.close()

        status = (snapshot.get("status") or "").lower()
        if status == "draft":
            status_label = "Draft"
        elif used_by_runs > 0:
            status_label = "In Use"
        else:
            status_label = "Locked"
        snapshot["used_by_runs"] = used_by_runs
        snapshot["status_label"] = status_label
        
        return jsonify({
            'success': True,
            'data': snapshot
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Get snapshot failed: {str(e)}")
        return jsonify({'error': str(e)}), 500


@snapshot_bp.route('/snapshot/<snapshot_id>/verify', methods=['POST'])
def verify_snapshot(snapshot_id):
    """Verify snapshot integrity"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        
        snapshot_manager = SnapshotManager(folders['duckdb'] / 'snapshots.duckdb')
        verification = snapshot_manager.verify_snapshot_integrity(snapshot_id)
        
        return jsonify({
            'success': True,
            'data': verification
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Verify snapshot failed: {str(e)}")
        return jsonify({'error': str(e)}), 500


@snapshot_bp.route('/snapshot/draft', methods=['POST'])
def create_snapshot_draft():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        snapshot_name = data.get('snapshot_name')
        created_by = data.get('created_by', 'user')
        if not snapshot_name:
            return jsonify({'error': 'snapshot_name required'}), 400
        tenant_id = 'default'
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        snapshot_manager = SnapshotManager(folders['duckdb'] / 'snapshots.duckdb')
        draft = snapshot_manager.create_draft_snapshot(tenant_id, env_id, snapshot_name, created_by)
        return jsonify({'success': True, 'data': draft}), 200
    except Exception as e:
        logger.error(f"[BTSY] Draft snapshot failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@snapshot_bp.route('/snapshot/<snapshot_id>/rename', methods=['PATCH'])
def rename_snapshot(snapshot_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        data = request.get_json() or {}
        snapshot_name = data.get('snapshot_name')
        if not snapshot_name:
            return jsonify({'error': 'snapshot_name required'}), 400
        tenant_id = 'default'
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        snapshot_manager = SnapshotManager(folders['duckdb'] / 'snapshots.duckdb')
        snapshot_manager.rename_snapshot(snapshot_id, snapshot_name)
        return jsonify({'success': True, 'data': {'snapshot_id': snapshot_id, 'snapshot_name': snapshot_name}}), 200
    except Exception as e:
        logger.error(f"[BTSY] Rename snapshot failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500
