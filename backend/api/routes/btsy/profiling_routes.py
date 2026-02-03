# backend/api/routes/btsy/profiling_routes.py
"""
BTSY Profiling Routes - Handle data profiling and analysis
"""
from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
import logging

logger = logging.getLogger(__name__)

profiling_bp = Blueprint('btsy_profiling', __name__)


@profiling_bp.route('/profile/<domain>', methods=['GET'])
def profile_domain(domain):
    """
    Profile a domain file (get stats without loading into memory)
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
        
        logger.info(f"[BTSY] Profiling {domain} for env {env_id}")
        
        profile = service.profile_file(tenant_id, env_id, domain)
        
        logger.info(f"[BTSY] Successfully profiled {domain}")
        
        return jsonify({
            'success': True,
            'data': profile
        }), 200
        
    except FileNotFoundError as e:
        logger.warning(f"[BTSY] File not found for {domain}: {str(e)}")
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        logger.error(f"[BTSY] Profiling failed for {domain}: {str(e)}", exc_info=True)
        return jsonify({
            'error': f'Failed to profile {domain}',
            'details': str(e)
        }), 500


@profiling_bp.route('/profile/all', methods=['GET'])
def profile_all_domains():
    """
    Profile all uploaded domains
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        tenant_id = 'default'
        service = get_btsy_service()
        
        # Get upload status first
        status = service.get_upload_status(tenant_id, env_id)
        
        profiles = {}
        for domain, info in status.items():
            if info['uploaded']:
                try:
                    profiles[domain] = service.profile_file(tenant_id, env_id, domain)
                except Exception as e:
                    logger.error(f"[BTSY] Failed to profile {domain}: {str(e)}")
                    profiles[domain] = {'error': str(e)}
        
        return jsonify({
            'success': True,
            'data': profiles
        }), 200
        
    except Exception as e:
        logger.error(f"[BTSY] Profile all failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500