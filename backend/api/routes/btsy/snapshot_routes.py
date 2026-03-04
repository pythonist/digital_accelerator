# backend/api/routes/btsy/snapshot_routes.py
"""
BTSY Snapshot Routes - Foundation Snapshot Management
"""
from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.mapping_service import MappingService
from api.tools.btsy.normalization_service import NormalizationService
from api.tools.btsy.snapshot_manager import SnapshotManager
from api.tools.btsy.foundation_audit_service import FoundationAuditService
from pathlib import Path
import logging
import duckdb
import time

logger = logging.getLogger(__name__)

snapshot_bp = Blueprint('snapshot', __name__)

def _resolve_locks(mgr: SnapshotManager, env_id: str, tenant_id: str, domain: str, snapshot_id: str, mapping_state: dict) -> dict:
    missing_locks = []
    extension_lock_types = {}

    for f in (mapping_state.get("canonical_fields") or []):
        if f.get("status") != "mapped" or not f.get("mapped_column"):
            continue
        key = f.get("canonical_name")
        lock = mgr.get_type_lock(env_id, tenant_id, domain, "canonical", key) if key else None
        if not lock or not lock.get("locked"):
            missing_locks.append({"field_kind": "canonical", "field_key": key})
        else:
            f["locked_datatype"] = lock.get("locked_type")

    for a in mgr.list_extension_attributes(snapshot_id, domain):
        if str(a.get("status") or "").lower() == "ignored":
            continue
        col = a.get("source_column_name")
        lock = mgr.get_type_lock(env_id, tenant_id, domain, "extension", col) if col else None
        if not lock or not lock.get("locked"):
            missing_locks.append({"field_kind": "extension", "field_key": col})
        else:
            extension_lock_types[col] = lock.get("locked_type")

    return {"missing_locks": missing_locks, "extension_lock_types": extension_lock_types}


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
        snapshot_manager = SnapshotManager(folders['duckdb'] / 'snapshots.duckdb')
        audit = FoundationAuditService(folders['duckdb'] / 'snapshots.duckdb')

        active_snapshot_id = str(snapshot_id) if snapshot_id else snapshot_manager.get_latest_snapshot_id(env_id=env_id, tenant_id=tenant_id, status="draft")
        if not active_snapshot_id:
            return jsonify({'error': 'No active draft snapshot found'}), 400
        
        # Collect mappings
        mappings = {}
        for domain in ['transactions', 'accounts', 'customers', 'str']:
            mapping_state = mapping_service.load_mapping(domain)
            if mapping_state:
                mappings[domain] = mapping_state
        
        # Add raw file paths to upload_status
        raw_path = folders['raw']
        for domain, status in upload_status.items():
            if status.get('uploaded'):
                domain_files = list(raw_path.glob(f"{domain}.*"))
                if domain_files:
                    status['raw_file_path'] = str(domain_files[0])

        conn = service.get_connection(tenant_id, env_id)
        try:
            normalization_results = {}
            for domain in ['transactions', 'accounts', 'customers', 'str']:
                if not upload_status.get(domain, {}).get('uploaded'):
                    continue

                mapping_state = mappings.get(domain)
                if not mapping_state or mapping_state.get('status') != 'confirmed':
                    return jsonify({'error': f'{domain} mapping not finalized'}), 400

                domain_state = service.get_domain_state(tenant_id, env_id, domain) or {}
                norm_result = domain_state.get('normalization_result') or {}
                existing_out = Path(norm_result.get('output_file') or '') if norm_result else None

                needs_normalize = True
                if existing_out and existing_out.exists():
                    if str(existing_out).lower().replace("\\", "/").find(f"/{str(active_snapshot_id).lower()}/") != -1:
                        needs_normalize = False

                if needs_normalize:
                    lock_ctx = _resolve_locks(snapshot_manager, env_id, tenant_id, domain, active_snapshot_id, mapping_state)
                    if lock_ctx["missing_locks"]:
                        return jsonify({
                            'error': 'Datatype review incomplete. Lock datatypes before snapshot creation.',
                            'missing_locks': lock_ctx["missing_locks"],
                            'domain': domain
                        }), 400

                    file_path = None
                    domain_files = list(raw_path.glob(f"{domain}.*"))
                    if domain_files:
                        file_path = domain_files[0]
                    if not file_path or not file_path.exists():
                        return jsonify({'error': f'No file found for {domain}'}), 404

                    start = time.time()
                    norm_service = NormalizationService(folders['normalized'], snapshot_id=active_snapshot_id)
                    result = norm_service.normalize_domain(domain, file_path, mapping_state, conn, extension_lock_types=lock_ctx["extension_lock_types"])
                    result['duration_ms'] = int((time.time() - start) * 1000)
                    try:
                        audit.log_event(
                            tenant_id=tenant_id,
                            env_id=env_id,
                            domain=domain,
                            snapshot_id=active_snapshot_id,
                            event="normalization.run",
                            duration_ms=result.get("duration_ms"),
                            metadata={
                                "input_file": str(file_path),
                                "output_file": result.get("output_file"),
                                "output_rows": result.get("output_rows"),
                                "mapped_fields": len([f for f in (result.get("field_stats") or []) if f.get("mapped")]),
                            },
                        )
                    except Exception:
                        pass

                    prev_state = service.get_domain_state(tenant_id, env_id, domain) or {}
                    preserved = {k: v for k, v in prev_state.items() if k not in ("domain", "state", "updated_at")}
                    service.set_domain_state(tenant_id, env_id, domain, service.STATE_NORMALIZED, {
                        **preserved,
                        'normalization_result': result
                    })
                    norm_result = result

                if norm_result:
                    normalization_results[domain] = norm_result
        finally:
            try:
                conn.close()
            except Exception:
                pass
        
        foundation_data = {
            'upload_status': upload_status,
            'mappings': mappings,
            'normalization_results': normalization_results
        }
        
        # Verify foundation is complete
        if not mappings:
            return jsonify({
                'error': 'Foundation not complete',
                'details': 'Please complete upload and mapping steps'
            }), 400
        
        # Create snapshot
        snapshot_metadata = snapshot_manager.create_snapshot(
            tenant_id, env_id, foundation_data, frozen_by, snapshot_id=active_snapshot_id, snapshot_name=snapshot_name
        )
        try:
            audit.log_event(
                tenant_id=tenant_id,
                env_id=env_id,
                domain=None,
                snapshot_id=str(snapshot_metadata.get("snapshot_id")),
                event="snapshot.create",
                duration_ms=snapshot_metadata.get("foundation_duration_ms"),
                metadata={
                    "snapshot_name": snapshot_metadata.get("snapshot_name"),
                    "status": snapshot_metadata.get("status"),
                    "domains_processed": snapshot_metadata.get("domains_processed"),
                },
            )
        except Exception:
            pass
        
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


@snapshot_bp.route('/snapshot/audit', methods=['GET'])
def list_foundation_audit():
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400

        snapshot_id = request.args.get('snapshot_id')
        domain = request.args.get('domain')
        limit = int(request.args.get('limit', 200))

        tenant_id = 'default'
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        db_path = folders['duckdb'] / 'snapshots.duckdb'

        FoundationAuditService(db_path)

        conn = duckdb.connect(str(db_path))
        try:
            where = ["tenant_id = ?", "env_id = ?"]
            params = [tenant_id, env_id]
            if snapshot_id:
                where.append("snapshot_id = ?")
                params.append(str(snapshot_id))
            if domain:
                where.append("domain = ?")
                params.append(str(domain))

            q = f"""
                SELECT
                    id,
                    tenant_id,
                    env_id,
                    domain,
                    snapshot_id,
                    event,
                    status,
                    duration_ms,
                    metadata_json,
                    created_at
                FROM foundation_audit_log
                WHERE {' AND '.join(where)}
                ORDER BY id DESC
                LIMIT {limit}
            """
            rows = conn.execute(q, params).fetchall()
            cols = [d[0] for d in conn.description]
            out = [dict(zip(cols, r)) for r in rows]
        finally:
            conn.close()

        return jsonify({'success': True, 'data': out}), 200
    except Exception as e:
        logger.error(f"[BTSY] Audit list failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


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
            conn = duckdb.connect(str(workbench_db))
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
            conn = duckdb.connect(str(workbench_db))
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
