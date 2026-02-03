# backend/api/routes/calibration/ks_routes.py
"""
KS Statistics Routes
===================
API endpoints for Kolmogorov-Smirnov analysis in Step 3.
"""
from flask import Blueprint, request, jsonify
from api.services import services
import traceback


ks_bp = Blueprint('calibration_ks', __name__)


@ks_bp.route('/<run_id>/ks-statistic', methods=['POST'])
def compute_ks_statistic(run_id):
    """
    Compute KS statistic for a threshold.
    
    POST /api/v2/calibration/ks/{run_id}/ks-statistic
    Body: {
        "threshold": 50000,
        "metric": "amount"
    }
    
    Returns KS value, interpretation, and population splits.
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        metric = data.get('metric', 'amount')
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        ks_service = services.get_ks_service()
        result = ks_service.compute_ks_statistic(
            run_id,
            float(threshold),
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
        return jsonify({'error': 'Failed to compute KS statistic'}), 500


@ks_bp.route('/<run_id>/ks-sensitivity', methods=['GET'])
def get_ks_sensitivity(run_id):
    """
    Get KS sensitivity curve across percentiles.
    
    GET /api/v2/calibration/ks/{run_id}/ks-sensitivity?metric=amount
    
    Returns KS values for common percentiles (75-99).
    """
    try:
        metric = request.args.get('metric', 'amount')
        
        ks_service = services.get_ks_service()
        result = ks_service.compute_ks_across_percentiles(
            run_id,
            metric=metric
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': 'Failed to compute KS sensitivity'}), 500


@ks_bp.route('/<run_id>/ks-cdf', methods=['POST'])
def get_cdf_comparison(run_id):
    """
    Get CDF comparison curves for visualization.
    
    POST /api/v2/calibration/ks/{run_id}/ks-cdf
    Body: {
        "threshold": 50000,
        "metric": "amount",
        "points": 100
    }
    
    Returns dual CDF curves ready for frontend charting.
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        metric = data.get('metric', 'amount')
        points = data.get('points', 100)
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        viz_service = services.get_ks_visualization_service()
        result = viz_service.generate_cdf_comparison(
            run_id,
            float(threshold),
            metric,
            points
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': 'Failed to generate CDF comparison'}), 500


@ks_bp.route('/<run_id>/ks-heatmap', methods=['GET'])
def get_ks_heatmap(run_id):
    """
    Get KS heatmap across percentile range.
    
    GET /api/v2/calibration/ks/{run_id}/ks-heatmap?metric=amount&resolution=20
    
    Returns heatmap data for identifying optimal separation zones.
    """
    try:
        metric = request.args.get('metric', 'amount')
        resolution = int(request.args.get('resolution', 20))
        
        viz_service = services.get_ks_visualization_service()
        result = viz_service.generate_ks_heatmap(
            run_id,
            metric,
            resolution
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': 'Failed to generate KS heatmap'}), 500


@ks_bp.route('/<run_id>/ks-narrative', methods=['POST'])
def get_ks_narrative(run_id):
    """
    Get narrative explanation for KS result.
    
    POST /api/v2/calibration/ks/{run_id}/ks-narrative
    Body: {
        "threshold": 50000,
        "metric": "amount"
    }
    
    Returns investigator-friendly explanation of KS statistics.
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        metric = data.get('metric', 'amount')
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        # Compute KS
        ks_service = services.get_ks_service()
        ks_result = ks_service.compute_ks_statistic(
            run_id,
            float(threshold),
            metric
        )
        
        # Generate narrative
        narrative_service = services.get_ks_narrative_service()
        narrative = narrative_service.generate_ks_explanation(ks_result)
        
        return jsonify({
            'success': True,
            'ks_result': ks_result,
            'narrative': narrative
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': 'Failed to generate narrative'}), 500


@ks_bp.route('/<run_id>/ks-with-str', methods=['POST'])
def get_ks_with_str_overlay(run_id):
    """
    Get KS statistic with STR evaluation overlay.
    
    POST /api/v2/calibration/ks/{run_id}/ks-with-str
    Body: {
        "threshold": 50000,
        "metric": "amount"
    }
    
    Returns KS + STR context (STR for interpretation only).
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        metric = data.get('metric', 'amount')
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        ks_service = services.get_ks_service()
        result = ks_service.compare_ks_with_str_overlay(
            run_id,
            float(threshold),
            metric
        )
        
        # Generate combined narrative
        narrative_service = services.get_ks_narrative_service()
        narrative = narrative_service.generate_str_context_narrative(result)
        
        return jsonify({
            'success': True,
            **result,
            'narrative': narrative
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': 'Failed to compute KS with STR overlay'}), 500


@ks_bp.route('/<run_id>/ks-sensitivity-narrative', methods=['GET'])
def get_ks_sensitivity_narrative(run_id):
    """
    Get narrative for KS sensitivity curve.
    
    GET /api/v2/calibration/ks/{run_id}/ks-sensitivity-narrative?metric=amount
    
    Returns insights about optimal KS ranges.
    """
    try:
        metric = request.args.get('metric', 'amount')
        
        # Compute sensitivity
        ks_service = services.get_ks_service()
        sensitivity_data = ks_service.compute_ks_across_percentiles(
            run_id,
            metric=metric
        )
        
        # Generate narrative
        narrative_service = services.get_ks_narrative_service()
        narrative = narrative_service.generate_comparison_narrative(sensitivity_data)
        
        return jsonify({
            'success': True,
            'sensitivity_data': sensitivity_data,
            'narrative': narrative
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': 'Failed to generate sensitivity narrative'}), 500