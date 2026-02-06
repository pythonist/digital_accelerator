# backend/api/routes/btsy/mapping_routes.py
"""
BTSY Schema Mapping Routes
Handles detection, suggestion, and confirmation of schema mappings
"""
from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.mapping_service import MappingService
from api.tools.btsy.snapshot_manager import SnapshotManager
from api.tools.btsy.foundation_audit_service import FoundationAuditService
import logging
import time

logger = logging.getLogger(__name__)

mapping_bp = Blueprint('mapping', __name__)


@mapping_bp.route('/detect/<domain>', methods=['POST'])
def detect_mapping(domain):
    """
    Detect and suggest schema mapping for a domain.
    Auto-suggests candidates based on name similarity and data types.
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
        
        # Get file path
        folders = service.init_env_structure(tenant_id, env_id)
        raw_path = folders['raw']
        domain_files = list(raw_path.glob(f"{domain}.*"))
        if not domain_files:
            return jsonify({'error': f'No file found for {domain}'}), 404
        
        file_path = domain_files[0]
        conn = service.get_connection(tenant_id, env_id)
        
        # Initialize mapping service
        mapping_service = MappingService(folders['state'])
        
        started = time.time()
        mapping_state = mapping_service.detect_and_suggest(domain, file_path, conn)
        
        # Save state
        mapping_service.save_mapping(domain, mapping_state)

        try:
            mgr = SnapshotManager(folders["duckdb"] / "snapshots.duckdb")
            sid = mgr.get_latest_snapshot_id(env_id=env_id, tenant_id=tenant_id, status="draft")
            if sid:
                bank_cols = set((mapping_state.get("bank_column_info") or {}).keys())
                mapped_cols = set(
                    f.get("mapped_column")
                    for f in (mapping_state.get("canonical_fields") or [])
                    if f.get("status") == "mapped" and f.get("mapped_column")
                )
                ignored = set(mapping_state.get("ignored_columns") or [])
                ext_cols = sorted(c for c in bank_cols if c not in mapped_cols and c not in ignored)
                attrs = []
                for c in ext_cols:
                    info = (mapping_state.get("bank_column_info") or {}).get(c) or {}
                    attrs.append(
                        {
                            "source_column_name": c,
                            "data_type": info.get("datatype"),
                            "status": "pending",
                        }
                    )
                mgr.upsert_extension_attributes(sid, domain, attrs)
        except Exception:
            pass
        
        logger.info(f"[BTSY] Detected mapping for {domain}")
        try:
            audit = FoundationAuditService(folders["duckdb"] / "snapshots.duckdb")
            audit.log_event(
                tenant_id=tenant_id,
                env_id=env_id,
                domain=domain,
                snapshot_id=None,
                event="mapping.detect",
                duration_ms=int((time.time() - started) * 1000),
                metadata={
                    "file_path": str(file_path),
                    "columns": len((mapping_state.get("bank_column_info") or {}).keys()),
                    "mapped_fields": len([f for f in (mapping_state.get("canonical_fields") or []) if f.get("status") == "mapped"]),
                },
            )
        except Exception:
            pass
        
        return jsonify({
            'success': True,
            'data': mapping_state
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Mapping detection failed for {domain}: {str(e)}", exc_info=True)
        return jsonify({
            'error': f'Failed to detect mapping for {domain}',
            'details': str(e)
        }), 500


@mapping_bp.route('/state/<domain>', methods=['GET'])
def get_mapping_state(domain):
    """Get current mapping state for a domain"""
    try:
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        if domain not in valid_domains:
            return jsonify({'error': f'Invalid domain'}), 400
        
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        
        mapping_service = MappingService(folders['state'])
        mapping_state = mapping_service.load_mapping(domain)
        
        if not mapping_state:
            return jsonify({
                'success': False,
                'error': 'No mapping state found'
            }), 404
        
        return jsonify({
            'success': True,
            'data': mapping_state
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Failed to get mapping state: {str(e)}")
        return jsonify({'error': str(e)}), 500


@mapping_bp.route('/update/<domain>', methods=['PUT'])
def update_field_mapping(domain):
    """
    Update mapping for a specific canonical field.
    Body: {
        "canonical_field": "transaction_amount",
        "mapped_column": "AMOUNT" | null,
        "status": "mapped" | "not_present"
    }
    """
    try:
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        if domain not in valid_domains:
            return jsonify({'error': f'Invalid domain'}), 400
        
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Request body required'}), 400
        
        canonical_field = data.get('canonical_field')
        mapped_column = data.get('mapped_column')
        status = data.get('status')
        
        if not canonical_field or not status:
            return jsonify({'error': 'canonical_field and status required'}), 400
        
        if status not in ['mapped', 'not_present']:
            return jsonify({'error': 'status must be "mapped" or "not_present"'}), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        
        mapping_service = MappingService(folders['state'])
        updated_state = mapping_service.update_field_mapping(
            domain, canonical_field, mapped_column, status
        )
        try:
            audit = FoundationAuditService(folders["duckdb"] / "snapshots.duckdb")
            audit.log_event(
                tenant_id=tenant_id,
                env_id=env_id,
                domain=domain,
                snapshot_id=None,
                event="mapping.update",
                metadata={
                    "canonical_field": canonical_field,
                    "mapped_column": mapped_column,
                    "status": status,
                },
            )
        except Exception:
            pass

        try:
            mgr = SnapshotManager(folders["duckdb"] / "snapshots.duckdb")
            sid = mgr.get_latest_snapshot_id(env_id=env_id, tenant_id=tenant_id, status="draft")
            if sid and mapped_column:
                mgr.upsert_extension_attributes(
                    sid,
                    domain,
                    [{"source_column_name": mapped_column, "status": "ignored"}],
                )
        except Exception:
            pass
        
        logger.info(f"[BTSY] Updated mapping for {domain}.{canonical_field}")
        
        return jsonify({
            'success': True,
            'data': updated_state
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Failed to update mapping: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@mapping_bp.route('/validate/<domain>', methods=['GET'])
def validate_mapping(domain):
    """Validate mapping completeness and correctness"""
    try:
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        if domain not in valid_domains:
            return jsonify({'error': f'Invalid domain'}), 400
        
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        
        mapping_service = MappingService(folders['state'])
        validation = mapping_service.validate_mapping(domain)
        
        return jsonify({
            'success': True,
            'data': validation
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Validation failed: {str(e)}")
        return jsonify({'error': str(e)}), 500

@mapping_bp.route('/verify/<domain>', methods=['POST'])
def confirm_verification(domain):
    """
    Record that user has reviewed and confirmed the mapping.
    Required before finalization.
    """
    try:
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        if domain not in valid_domains:
            return jsonify({'error': 'Invalid domain'}), 400
        
        env_id = request.headers.get('X-Environment-ID')
        tenant_id = 'default'
        
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        
        mapping_service = MappingService(folders['state'])
        # confirm_verification sets verification_confirmed = True in the JSON state
        updated_state = mapping_service.confirm_verification(domain)
        try:
            audit = FoundationAuditService(folders["duckdb"] / "snapshots.duckdb")
            audit.log_event(
                tenant_id=tenant_id,
                env_id=env_id,
                domain=domain,
                snapshot_id=None,
                event="mapping.verify_confirmed",
            )
        except Exception:
            pass
        
        return jsonify({
            'success': True,
            'message': f'Verification confirmed for {domain}',
            'data': updated_state
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Verification confirmation failed: {str(e)}")
        return jsonify({'error': str(e)}), 500

@mapping_bp.route('/columns/<domain>', methods=['GET'])
def list_bank_columns(domain):
    """
    List all source (bank) columns with their disposition:
    - mapped (used)
    - ignored
    - unmapped (available)
    """
    try:
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        if domain not in valid_domains:
            return jsonify({'error': 'Invalid domain'}), 400
        
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        mapping_service = MappingService(folders['state'])
        state = mapping_service.load_mapping(domain)
        if not state:
            return jsonify({'error': 'No mapping state found'}), 404
        
        bank_columns = list(state.get('bank_column_info', {}).keys())
        mapped_columns = set(
            f['mapped_column'] for f in state['canonical_fields']
            if f.get('mapped_column')
        )
        ignored = set(state.get('ignored_columns', []))
        unmapped = [c for c in bank_columns if c not in mapped_columns and c not in ignored]
        
        return jsonify({
            'success': True,
            'data': {
                'mapped': sorted(mapped_columns),
                'ignored': sorted(ignored),
                'unmapped': sorted(unmapped),
                'all': bank_columns
            }
        }), 200
    except Exception as e:
        logger.error(f"[BTSY] List bank columns failed: {str(e)}")
        return jsonify({'error': str(e)}), 500

@mapping_bp.route('/column/<domain>/disposition', methods=['PUT'])
def set_column_disposition(domain):
    """
    Mark a source column as 'ignored' or 'available'
    Body: { "column_name": "gender", "disposition": "ignored" | "available" }
    """
    try:
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        if domain not in valid_domains:
            return jsonify({'error': 'Invalid domain'}), 400
        
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        data = request.get_json() or {}
        column_name = data.get('column_name')
        disposition = data.get('disposition')
        if not column_name or disposition not in ['ignored', 'available']:
            return jsonify({'error': 'column_name and valid disposition required'}), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        mapping_service = MappingService(folders['state'])
        
        updated_state = mapping_service.set_column_disposition(domain, column_name, disposition)
        try:
            mgr = SnapshotManager(folders["duckdb"] / "snapshots.duckdb")
            sid = mgr.get_latest_snapshot_id(env_id=env_id, tenant_id=tenant_id, status="draft")
            if sid:
                new_status = "ignored" if disposition == "ignored" else "pending"
                info = (updated_state.get("bank_column_info") or {}).get(column_name) or {}
                mgr.upsert_extension_attributes(
                    sid,
                    domain,
                    [{"source_column_name": column_name, "data_type": info.get("datatype"), "status": new_status}],
                )
        except Exception:
            pass
        return jsonify({
            'success': True,
            'data': updated_state
        }), 200
    except Exception as e:
        logger.error(f"[BTSY] Set column disposition failed: {str(e)}")
        return jsonify({'error': str(e)}), 500

@mapping_bp.route('/summary/<domain>', methods=['GET'])
def get_verification_summary(domain):
    """
    Return verification summary with semantic warnings and disposition info
    """
    try:
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        if domain not in valid_domains:
            return jsonify({'error': 'Invalid domain'}), 400
        
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        
        # Need file path and connection to compute warnings
        raw_path = folders['raw']
        domain_files = list(raw_path.glob(f"{domain}.*"))
        if not domain_files:
            return jsonify({'error': f'No file found for {domain}'}), 404
        file_path = domain_files[0]
        conn = service.get_connection(tenant_id, env_id)
        
        mapping_service = MappingService(folders['state'])
        summary = mapping_service.get_verification_summary(domain, conn, file_path)
        
        return jsonify({
            'success': True,
            'data': summary
        }), 200
    except Exception as e:
        logger.error(f"[BTSY] Verification summary failed: {str(e)}")
        return jsonify({'error': str(e)}), 500
@mapping_bp.route('/finalize/<domain>', methods=['POST'])
def finalize_mapping(domain):
    """
    Finalize mapping after validation.
    Creates the mapping contract.
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
        folders = service.init_env_structure(tenant_id, env_id)
        
        mapping_service = MappingService(folders['state'])
        
        # Validate first
        validation = mapping_service.validate_mapping(domain)
        if not validation['valid']:
            return jsonify({
                'success': False,
                'error': 'Cannot finalize invalid mapping',
                'validation': validation
            }), 400
        
        # Finalize
        contract = mapping_service.finalize_mapping(domain)
        try:
            audit = FoundationAuditService(folders["duckdb"] / "snapshots.duckdb")
            audit.log_event(
                tenant_id=tenant_id,
                env_id=env_id,
                domain=domain,
                snapshot_id=None,
                event="mapping.finalize",
                metadata={
                    "mapped_fields": len([f for f in (contract.get("canonical_fields") or []) if f.get("status") == "mapped"]),
                },
            )
        except Exception:
            pass
        
        logger.info(f"[BTSY] Finalized mapping for {domain}")
        
        return jsonify({
            'success': True,
            'message': f'Mapping finalized for {domain}',
            'data': contract
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Finalization failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500
