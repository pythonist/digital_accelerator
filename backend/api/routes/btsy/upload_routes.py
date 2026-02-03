# backend/api/routes/btsy/upload_routes.py
"""
BTSY Upload Routes - FIXED
1. Parallel upload support (non-blocking)
2. Clear with DuckDB reset confirmation
3. Row count immediately visible
"""
from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.mapping_service import MappingService
from api.tools.btsy.snapshot_manager import SnapshotManager
import logging
import os
import tempfile

logger = logging.getLogger(__name__)

upload_bp = Blueprint('btsy_upload', __name__)

ALLOWED_EXTENSIONS = {'csv', 'parquet'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@upload_bp.route('/upload/<domain>', methods=['POST'])
def upload_domain_file(domain):
    """
    Upload a file for a specific domain (transactions, accounts, customers, str)
    FIX: Non-blocking, immediately returns row count
    """
    try:
        # Validate domain
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        if domain not in valid_domains:
            return jsonify({
                'success': False,
                'error': f'Invalid domain. Must be one of: {valid_domains}'
            }), 400
        
        # Get environment info from headers
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({
                'success': False,
                'error': 'X-Environment-ID header required'
            }), 400
        
        tenant_id = 'default'
        
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No file provided'
            }), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({
                'success': False,
                'error': 'Empty filename'
            }), 400
        
        if not allowed_file(file.filename):
            return jsonify({
                'success': False,
                'error': f'Invalid file type. Allowed: {ALLOWED_EXTENSIONS}'
            }), 400
        
        # Get BTSY service
        service = get_btsy_service()
        
        # Get file size from Content-Length header if available
        file_size = request.content_length
        if file_size:
            logger.info(f"[BTSY] Uploading {domain}: {file.filename} ({file_size / 1024 / 1024:.2f} MB)")
        else:
            logger.info(f"[BTSY] Uploading {domain}: {file.filename} (size unknown, streaming)")
        
        # Save to temporary file first
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as tmp:
            file.save(tmp.name)
            temp_path = tmp.name
        
        try:
            # Upload the file - FIX: This now immediately calculates and persists row count
            upload_result = service.upload_file(tenant_id, env_id, domain, temp_path, file.filename)
            
            logger.info(
                f"[BTSY] Upload successful: {domain} - {upload_result['filename']} "
                f"({upload_result['size_bytes'] / 1024 / 1024:.2f} MB, {upload_result['row_count']} rows)"
            )
            
            # Automatically trigger mapping detection
            try:
                folders = service.init_env_structure(tenant_id, env_id)
                raw_path = folders['raw']
                domain_files = list(raw_path.glob(f"{domain}.*"))
                
                if domain_files:
                    file_path = domain_files[0]
                    conn = service.get_connection(tenant_id, env_id)
                    
                    mapping_service = MappingService(folders['state'])
                    mapping_state = mapping_service.detect_and_suggest(domain, file_path, conn)
                    mapping_service.save_mapping(domain, mapping_state)
                    
                    logger.info(f"[BTSY] Auto-detected mapping for {domain}")
                    upload_result['mapping_detected'] = True
                    upload_result['mapping_summary'] = {
                        'auto_mapped_count': sum(1 for f in mapping_state['canonical_fields'] if f.get('mapped_column')),
                        'total_canonical': len(mapping_state['canonical_fields'])
                    }

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
            except Exception as map_err:
                logger.warning(f"[BTSY] Mapping auto-detection failed for {domain}: {map_err}")
                upload_result['mapping_detected'] = False
                upload_result['mapping_error'] = str(map_err)
            
            return jsonify({
                'success': True,
                'message': f'{domain.title()} file uploaded successfully',
                'data': upload_result
            }), 200
            
        finally:
            # Clean up temp file
            try:
                os.unlink(temp_path)
            except:
                pass
        
    except Exception as e:
        logger.error(f"[BTSY] Upload failed: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': f'Upload failed: {str(e)}'
        }), 500


@upload_bp.route('/status', methods=['GET'])
def get_upload_status():
    """
    Get comprehensive upload status for all domains
    FIX: Always returns persisted row_count from state
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({
                'success': False,
                'error': 'X-Environment-ID header required'
            }), 400
        
        tenant_id = 'default'
        
        service = get_btsy_service()
        status = service.get_upload_status(tenant_id, env_id)
        
        # Calculate completion
        mandatory_domains = ['transactions', 'accounts', 'customers']
        mandatory_complete = all(status[d]['uploaded'] for d in mandatory_domains)
        
        return jsonify({
            'success': True,
            'data': {
                'domains': status,
                'mandatory_complete': mandatory_complete,
                'all_complete': all(status[d]['uploaded'] for d in status.keys())
            }
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Status check failed: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': f'Status check failed: {str(e)}'
        }), 500


@upload_bp.route('/clear/<domain>', methods=['DELETE'])
def clear_domain(domain):
    """
    Clear uploaded file for a domain (no database reset).
    """
    try:
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        if domain not in valid_domains:
            return jsonify({
                'success': False,
                'error': f'Invalid domain. Must be one of: {valid_domains}'
            }), 400
        
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({
                'success': False,
                'error': 'X-Environment-ID header required'
            }), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        
        # Clear the domain file
        service.clear_domain(tenant_id, env_id, domain)
        
        # Also clear mapping state
        try:
            folders = service.init_env_structure(tenant_id, env_id)
            mapping_service = MappingService(folders['state'])
            mapping_service.clear_mapping(domain)
            logger.info(f"[BTSY] Cleared mapping state for {domain}")
        except Exception as map_err:
            logger.warning(f"[BTSY] Failed to clear mapping for {domain}: {map_err}")
        
        return jsonify({
            'success': True,
            'domain': domain,
            'message': f'{domain.title()} cleared successfully'
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Clear failed for {domain}: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'domain': domain,
            'error': f'Failed to clear {domain}: {str(e)}'
        }), 500


@upload_bp.route('/clear-all', methods=['DELETE'])
def clear_all_domains():
    """
    FIX: Clear ALL domains and completely reset DuckDB
    Requires confirmation via query parameter: ?confirm_reset=true
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({
                'success': False,
                'error': 'X-Environment-ID header required'
            }), 400
        
        # Require confirmation
        confirm_reset = request.args.get('confirm_reset', '').lower() == 'true'
        if not confirm_reset:
            return jsonify({
                'success': False,
                'requires_confirmation': True,
                'warning': (
                    'This will clear ALL uploaded data and COMPLETELY RESET the DuckDB database. '
                    'All tables, mappings, and cached data will be permanently deleted. '
                    'Add ?confirm_reset=true to proceed.'
                )
            }), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        
        # Close connections
        logger.info(f"[BTSY] Closing all connections for environment {env_id}")
        service.close_connection(tenant_id, env_id)
        
        # Reset database completely
        try:
            service.reset_database(tenant_id, env_id)
            logger.info(f"[BTSY] DuckDB completely reset for environment {env_id}")
        except Exception as db_err:
            logger.error(f"[BTSY] Failed to reset DuckDB: {db_err}")
            return jsonify({
                'success': False,
                'error': f'Failed to reset database: {str(db_err)}'
            }), 500
        
        # Clear all domains
        valid_domains = ['transactions', 'accounts', 'customers', 'str']
        cleared_domains = []
        
        for domain in valid_domains:
            try:
                service.clear_domain(tenant_id, env_id, domain)
                cleared_domains.append(domain)
            except Exception as e:
                logger.warning(f"[BTSY] Failed to clear {domain}: {e}")
        
        # Clear all mapping states
        folders = service.init_env_structure(tenant_id, env_id)
        mapping_service = MappingService(folders['state'])
        for domain in valid_domains:
            try:
                mapping_service.clear_mapping(domain)
            except Exception as e:
                logger.warning(f"[BTSY] Failed to clear mapping for {domain}: {e}")
        
        return jsonify({
            'success': True,
            'message': 'All data cleared and database reset successfully',
            'cleared_domains': cleared_domains,
            'database_reset': True
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Clear all failed: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': f'Failed to clear all: {str(e)}'
        }), 500
