# backend/api/routes/calibration/comparison_routes.py
"""
Bank Alert Comparison Routes - Step 4 (Future Scope)
Handles: Comparing tool-generated alerts with bank alerts
"""
from flask import Blueprint, request, jsonify
import traceback

comparison_bp = Blueprint('comparison', __name__)

@comparison_bp.route('/<run_id>/upload-bank-alerts', methods=['POST'])
def upload_bank_alerts(run_id):
    """
    Upload bank's alert master file for comparison
    
    Form Data:
        file: CSV with columns [alert_id, account_id, alert_date, ...]
    """
    try:
        file = request.files.get('file')
        env_id = request.form.get('env_id') or request.headers.get('X-Environment-ID')
        
        if not all([file, env_id]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        from calibration.services.comparison_service import ComparisonService
        service = ComparisonService()
        
        result = service.upload_bank_alerts(run_id, env_id, file)
        
        return jsonify({
            'success': True,
            'stats': result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@comparison_bp.route('/<run_id>/compare', methods=['POST'])
def compare_alerts(run_id):
    """
    Execute comparison between tool alerts and bank alerts
    
    Performs FULL OUTER JOIN on (account_id, alert_date)
    
    Returns:
        - Common alerts (matched)
        - Tool-only alerts (missed by bank)
        - Bank-only alerts (false positives by tool)
    """
    try:
        env_id = request.json.get('env_id') or request.headers.get('X-Environment-ID')
        
        from calibration.services.comparison_service import ComparisonService
        service = ComparisonService()
        
        comparison = service.compare_alerts(run_id, env_id)
        
        return jsonify({
            'success': True,
            'comparison': comparison
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@comparison_bp.route('/<run_id>/metrics', methods=['GET'])
def get_comparison_metrics(run_id):
    """
    Get comparison metrics
    
    Returns:
        - Precision, Recall, F1-Score
        - Confusion matrix
        - Coverage analysis
    """
    try:
        from calibration.services.comparison_service import ComparisonService
        service = ComparisonService()
        
        metrics = service.get_comparison_metrics(run_id)
        
        return jsonify({
            'success': True,
            'metrics': metrics
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@comparison_bp.route('/<run_id>/details', methods=['GET'])
def get_comparison_details(run_id):
    """
    Get detailed comparison results
    
    Query Params:
        category: 'matched' | 'tool_only' | 'bank_only'
        limit: int
    """
    try:
        category = request.args.get('category', 'matched')
        limit = int(request.args.get('limit', 100))
        
        from calibration.services.comparison_service import ComparisonService
        service = ComparisonService()
        
        details = service.get_comparison_details(run_id, category, limit)
        
        return jsonify({
            'success': True,
            'category': category,
            'details': details,
            'count': len(details)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500