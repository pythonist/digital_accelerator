# backend/api/routes/calibration/atl_btl_routes.py
"""
ATL / BTL Routes
===============
API endpoints for Above-the-Line / Below-the-Line analysis.
"""
from flask import Blueprint, request, jsonify
from api.services import services
import traceback


atl_btl_bp = Blueprint('calibration_atl_btl', __name__)


@atl_btl_bp.route('/<run_id>/atl-btl-split', methods=['POST'])
def compute_atl_btl_split(run_id):
    """
    POST /api/v2/calibration/atl-btl/{run_id}/atl-btl-split
    Body: {
        "threshold": 50000,
        "btl_band_pct": 10,
        "metric": "amount"
    }
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        btl_band_pct = data.get('btl_band_pct', 10.0)
        metric = data.get('metric', 'amount')
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        atl_btl_service = services.get_atl_btl_service()
        result = atl_btl_service.compute_atl_btl_split(
            run_id,
            float(threshold),
            float(btl_band_pct),
            metric
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': 'Failed to compute ATL/BTL split'}), 500


@atl_btl_bp.route('/<run_id>/volume-sensitivity', methods=['POST'])
def get_volume_sensitivity(run_id):
    """
    POST /api/v2/calibration/atl-btl/{run_id}/volume-sensitivity
    Body: {
        "threshold": 50000,
        "btl_band_pct": 10,
        "metric": "amount"
    }
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        btl_band_pct = data.get('btl_band_pct', 10.0)
        metric = data.get('metric', 'amount')
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        atl_btl_service = services.get_atl_btl_service()
        result = atl_btl_service.compute_volume_sensitivity(
            run_id,
            float(threshold),
            float(btl_band_pct),
            metric
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': 'Failed to compute volume sensitivity'}), 500


@atl_btl_bp.route('/<run_id>/str-overlay', methods=['POST'])
def get_str_overlay(run_id):
    """
    POST /api/v2/calibration/atl-btl/{run_id}/str-overlay
    Body: {
        "threshold": 50000,
        "btl_band_pct": 10,
        "metric": "amount"
    }
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        btl_band_pct = data.get('btl_band_pct', 10.0)
        metric = data.get('metric', 'amount')
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        atl_btl_service = services.get_atl_btl_service()
        result = atl_btl_service.compute_str_overlay(
            run_id,
            float(threshold),
            float(btl_band_pct),
            metric
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': 'Failed to compute STR overlay'}), 500


@atl_btl_bp.route('/<run_id>/behavioral-concentration', methods=['POST'])
def get_behavioral_concentration(run_id):
    """
    POST /api/v2/calibration/atl-btl/{run_id}/behavioral-concentration
    Body: {
        "threshold": 50000,
        "btl_band_pct": 10,
        "metric": "amount"
    }
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        btl_band_pct = data.get('btl_band_pct', 10.0)
        metric = data.get('metric', 'amount')
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        atl_btl_service = services.get_atl_btl_service()
        result = atl_btl_service.compute_behavioral_concentration(
            run_id,
            float(threshold),
            float(btl_band_pct),
            metric
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': 'Failed to compute behavioral concentration'}), 500


@atl_btl_bp.route('/<run_id>/narrative', methods=['POST'])
def get_atl_btl_narrative(run_id):
    """
    POST /api/v2/calibration/atl-btl/{run_id}/narrative
    Body: {
        "threshold": 50000,
        "btl_band_pct": 10,
        "metric": "amount"
    }
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        btl_band_pct = data.get('btl_band_pct', 10.0)
        metric = data.get('metric', 'amount')
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        atl_btl_service = services.get_atl_btl_service()
        result = atl_btl_service.generate_atl_btl_narrative(
            run_id,
            float(threshold),
            float(btl_band_pct),
            metric
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': 'Failed to generate narrative'}), 500