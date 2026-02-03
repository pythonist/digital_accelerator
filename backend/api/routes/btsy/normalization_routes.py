# backend/api/routes/btsy/normalization_routes.py
"""
BTSY Normalization Routes
Handles data transformation from raw to canonical format with validation
"""
from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.mapping_service import MappingService
from api.tools.btsy.normalization_service import NormalizationService
from api.tools.btsy.snapshot_manager import SnapshotManager
import logging
import threading
import time
from typing import Dict

logger = logging.getLogger(__name__)

normalization_bp = Blueprint('normalization', __name__)

_norm_lock = threading.Lock()
_norm_jobs = {}


def _resolve_locks(mgr: SnapshotManager, env_id: str, tenant_id: str, domain: str, draft_snapshot_id: str, mapping_state: Dict) -> Dict:
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

    for a in mgr.list_extension_attributes(draft_snapshot_id, domain):
        if str(a.get("status") or "").lower() == "ignored":
            continue
        col = a.get("source_column_name")
        lock = mgr.get_type_lock(env_id, tenant_id, domain, "extension", col) if col else None
        if not lock or not lock.get("locked"):
            missing_locks.append({"field_kind": "extension", "field_key": col})
        else:
            extension_lock_types[col] = lock.get("locked_type")

    return {"missing_locks": missing_locks, "extension_lock_types": extension_lock_types}


def _set_job_state(service, tenant_id: str, env_id: str, domain: str, status: str, phase: str, percent: float, message: str = "", meta: Dict = None):
    prev = service.get_domain_state(tenant_id, env_id, domain) or {}
    preserved = {k: v for k, v in prev.items() if k not in ("domain", "state", "updated_at")}
    payload = {
        **preserved,
        "normalization_job": {
            "status": status,
            "phase": phase,
            "percent": float(percent),
            "estimated": True,
            "message": message,
            "updated_at": time.time(),
        },
    }
    if meta:
        payload["normalization_job"].update(meta)
    service.set_domain_state(tenant_id, env_id, domain, prev.get("state") or "NORMALIZING", payload)


def _job_key(env_id: str, domain: str, tenant_id: str = "default"):
    return (str(tenant_id), str(env_id), str(domain))


def _run_normalization_job(env_id: str, tenant_id: str, domain: str, resume: bool = False):
    service = get_btsy_service()
    folders = service.init_env_structure(tenant_id, env_id)
    mgr = SnapshotManager(folders["duckdb"] / "snapshots.duckdb")
    mapping_service = MappingService(folders["state"])
    key = _job_key(env_id, domain, tenant_id)

    try:
        _set_job_state(service, tenant_id, env_id, domain, "running", "pre-scan", 8.0, "Preparing normalization…")

        mapping_state = mapping_service.load_mapping(domain)
        if not mapping_state or mapping_state.get("status") != "confirmed":
            raise ValueError(f"{domain} mapping not finalized")

        draft_snapshot_id = mgr.get_latest_snapshot_id(env_id=env_id, tenant_id=tenant_id, status="draft")
        if not draft_snapshot_id:
            raise ValueError("No active draft snapshot found")

        lock_ctx = _resolve_locks(mgr, env_id, tenant_id, domain, draft_snapshot_id, mapping_state)
        if lock_ctx["missing_locks"]:
            _set_job_state(service, tenant_id, env_id, domain, "blocked", "locks", 0.0, "Datatype review incomplete", {"missing_locks": lock_ctx["missing_locks"]})
            return

        raw_path = folders["raw"]
        domain_files = list(raw_path.glob(f"{domain}.*"))
        if not domain_files:
            raise FileNotFoundError(f"No file found for {domain}")
        file_path = domain_files[0]
        conn = service.get_connection(tenant_id, env_id)

        norm_service = NormalizationService(folders["normalized"], snapshot_id=draft_snapshot_id)

        _set_job_state(service, tenant_id, env_id, domain, "running", "executing", 35.0, "Executing transformations…")
        result = norm_service.normalize_domain(domain, file_path, mapping_state, conn, extension_lock_types=lock_ctx["extension_lock_types"])

        _set_job_state(service, tenant_id, env_id, domain, "running", "post-checks", 90.0, "Running integrity checks…")

        service.set_domain_state(tenant_id, env_id, domain, service.STATE_NORMALIZED, {
            **{k: v for k, v in (service.get_domain_state(tenant_id, env_id, domain) or {}).items() if k not in ("domain", "state", "updated_at")},
            "normalization_result": result,
            "normalization_job": {
                "status": "success",
                "phase": "done",
                "percent": 100.0,
                "estimated": False,
                "message": "Normalization complete",
                "updated_at": time.time(),
            },
        })
    except Exception as e:
        logger.error(f"[BTSY] Normalization async failed for {domain}: {e}", exc_info=True)
        try:
            _set_job_state(service, tenant_id, env_id, domain, "failed", "error", 0.0, str(e))
        except Exception:
            pass
    finally:
        with _norm_lock:
            _norm_jobs.pop(key, None)


@normalization_bp.route('/normalize/<domain>', methods=['POST'])
def normalize_domain(domain):
    """
    Normalize a domain - transform raw data to canonical format
    """
    try:
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        if domain not in valid_domains:
            return jsonify({'error': f'Invalid domain'}), 400
        
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        
        # Check if file is uploaded
        status = service.get_upload_status(tenant_id, env_id)
        if not status[domain]['uploaded']:
            return jsonify({'error': f'{domain} not uploaded'}), 400
        
        # Get mapping contract
        folders = service.init_env_structure(tenant_id, env_id)
        mapping_service = MappingService(folders['state'])
        mapping_state = mapping_service.load_mapping(domain)
        
        if not mapping_state or mapping_state.get('status') != 'confirmed':
            return jsonify({'error': f'{domain} mapping not finalized'}), 400
        
        # Get file path
        raw_path = folders['raw']
        domain_files = list(raw_path.glob(f"{domain}.*"))
        if not domain_files:
            return jsonify({'error': f'No file found for {domain}'}), 404
        
        file_path = domain_files[0]
        conn = service.get_connection(tenant_id, env_id)
        
        # Initialize normalization service
        mgr = SnapshotManager(folders["duckdb"] / "snapshots.duckdb")
        draft_snapshot_id = mgr.get_latest_snapshot_id(env_id=env_id, tenant_id=tenant_id, status="draft")
        if not draft_snapshot_id:
            return jsonify({'error': 'No active draft snapshot found'}), 400
        norm_service = NormalizationService(folders['normalized'], snapshot_id=draft_snapshot_id)

        lock_ctx = _resolve_locks(mgr, env_id, tenant_id, domain, draft_snapshot_id, mapping_state)
        if lock_ctx["missing_locks"]:
            return jsonify({
                'error': 'Datatype review incomplete. Lock datatypes before normalization.',
                'missing_locks': lock_ctx["missing_locks"]
            }), 400
        
        # Normalize
        result = norm_service.normalize_domain(domain, file_path, mapping_state, conn, extension_lock_types=lock_ctx["extension_lock_types"])
        
        # Update state
        prev_state = service.get_domain_state(tenant_id, env_id, domain) or {}
        preserved = {k: v for k, v in prev_state.items() if k not in ("domain", "state", "updated_at")}
        service.set_domain_state(tenant_id, env_id, domain, service.STATE_NORMALIZED, {
            **preserved,
            'normalization_result': result
        })
        
        logger.info(f"[BTSY] Normalized {domain}: {result['output_rows']} rows")
        
        return jsonify({
            'success': True,
            'data': result
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Normalization failed for {domain}: {str(e)}", exc_info=True)
        return jsonify({
            'error': f'Failed to normalize {domain}',
            'details': str(e)
        }), 500


@normalization_bp.route('/result/<domain>', methods=['GET'])
def get_normalization_result(domain):
    """Get normalization result for a domain"""
    try:
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        if domain not in valid_domains:
            return jsonify({'error': f'Invalid domain'}), 400
        
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        
        # Get domain state
        state = service.get_domain_state(tenant_id, env_id, domain)
        result = state.get('normalization_result')
        
        if not result:
            return jsonify({
                'success': False,
                'error': 'No normalization result found'
            }), 404
        
        return jsonify({
            'success': True,
            'data': result
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Failed to get normalization result: {str(e)}")
        return jsonify({'error': str(e)}), 500


@normalization_bp.route('/normalize/start/<domain>', methods=['POST'])
def start_normalization(domain):
    try:
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        if domain not in valid_domains:
            return jsonify({'error': 'Invalid domain'}), 400
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        tenant_id = 'default'
        data = request.get_json() or {}
        resume = bool(data.get("resume", False))

        service = get_btsy_service()
        state = service.get_domain_state(tenant_id, env_id, domain)
        existing_result = state.get("normalization_result") or {}
        if existing_result.get("status") == "success":
            return jsonify({"success": True, "data": {"status": "success"}}), 200
        job = state.get("normalization_job") or {}
        key = _job_key(env_id, domain, tenant_id)

        with _norm_lock:
            existing = _norm_jobs.get(key)
            if existing and existing.get("thread") and existing["thread"].is_alive():
                return jsonify({"success": True, "data": job}), 200

            t = threading.Thread(target=_run_normalization_job, args=(env_id, tenant_id, domain, resume), daemon=True)
            _norm_jobs[key] = {"thread": t, "started_at": time.time()}
            t.start()

        return jsonify({"success": True, "data": {"status": "running"}}), 200
    except Exception as e:
        logger.error(f"[BTSY] Start normalization failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@normalization_bp.route('/normalize/progress/<domain>', methods=['GET'])
def get_normalization_progress(domain):
    try:
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        if domain not in valid_domains:
            return jsonify({'error': 'Invalid domain'}), 400
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        tenant_id = 'default'
        service = get_btsy_service()
        state = service.get_domain_state(tenant_id, env_id, domain)
        job = state.get("normalization_job") or {}
        key = _job_key(env_id, domain, tenant_id)
        with _norm_lock:
            alive = key in _norm_jobs and _norm_jobs[key].get("thread") and _norm_jobs[key]["thread"].is_alive()
        if job.get("status") == "running" and not alive:
            job["status"] = "paused"
            job["message"] = job.get("message") or "Normalization paused. Resume?"
        return jsonify({"success": True, "data": {"job": job, "state": state.get("state"), "result": state.get("normalization_result")}}), 200
    except Exception as e:
        logger.error(f"[BTSY] Progress failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500
