# backend/api/routes/calibration/approval_routes.py
"""
Approval & Report Routes
Handles governance workflow and PDF generation
"""
from flask import Blueprint, request, jsonify, send_file
import traceback

approval_bp = Blueprint('calibration_approval', __name__)

@approval_bp.route('/<run_id>/approve', methods=['POST'])
def approve_calibration(run_id):
    """
    Approve and lock calibration run
    
    POST /api/v2/calibration/approval/{run_id}/approve
    Body: {
        "env_id": "xxx",
        "approved_by": "user@example.com",
        "comment": "Approved after review"
    }
    """
    try:
        from api.services import services
        
        data = request.get_json()
        approved_by = data.get('approved_by', 'system')
        comment = data.get('comment')
        
        approval_service = services.get_approval_service()
        run = approval_service.approve_run(run_id, approved_by, comment)
        
        return jsonify({
            'success': True,
            'run': run,
            'message': 'Calibration approved and locked'
        })
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@approval_bp.route('/<run_id>/reject', methods=['POST'])
def reject_calibration(run_id):
    """
    Reject calibration run
    
    POST /api/v2/calibration/approval/{run_id}/reject
    Body: {
        "env_id": "xxx",
        "rejected_by": "user@example.com",
        "reason": "Threshold too aggressive"
    }
    """
    try:
        from api.services import services
        
        data = request.get_json()
        rejected_by = data.get('rejected_by', 'system')
        reason = data.get('reason')
        
        if not reason:
            return jsonify({'error': 'Rejection reason required'}), 400
        
        approval_service = services.get_approval_service()
        run = approval_service.reject_run(run_id, rejected_by, reason)
        
        return jsonify({
            'success': True,
            'run': run,
            'message': 'Calibration rejected'
        })
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@approval_bp.route('/<run_id>/report-data', methods=['GET'])
def get_report_data(run_id):
    """
    Get complete report data for UI display
    
    GET /api/v2/calibration/approval/{run_id}/report-data?env_id=xxx
    """
    try:
        from api.services import services
        
        env_id = request.args.get('env_id')
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        report_data_service = services.get_report_data_service()
        report = report_data_service.collect_report_data(run_id, env_id)
        
        return jsonify({
            'success': True,
            'report': report
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@approval_bp.route('/<run_id>/export-pdf', methods=['GET'])
def export_pdf_report(run_id):
    """
    Download PDF report
    
    GET /api/v2/calibration/approval/{run_id}/export-pdf?env_id=xxx
    """
    try:
        from api.services import services
        
        env_id = request.args.get('env_id')
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        # Collect data
        report_data_service = services.get_report_data_service()
        report_data = report_data_service.collect_report_data(run_id, env_id)
        
        # Generate PDF
        pdf_service = services.get_pdf_generator_service()
        pdf_path = pdf_service.generate_pdf(report_data)
        
        # Send file
        return send_file(
            pdf_path,
            as_attachment=True,
            download_name=f'calibration_report_{run_id}.pdf',
            mimetype='application/pdf'
        )
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@approval_bp.route('/<run_id>/approval-metadata', methods=['GET'])
def get_approval_metadata(run_id):
    """
    Get approval status and metadata
    
    GET /api/v2/calibration/approval/{run_id}/approval-metadata
    """
    try:
        from api.services import services
        
        approval_service = services.get_approval_service()
        metadata = approval_service.get_approval_metadata(run_id)
        
        if not metadata:
            return jsonify({'error': 'Run not found'}), 404
        
        return jsonify({
            'success': True,
            'metadata': metadata
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    

# @approval_bp.route('/<run_id>/full', methods=['GET'])
# def get_full_report_data(run_id):
#     """Get complete report data (alias for report-data)"""
#     try:
#         from api.services import services
        
#         env_id = request.args.get('env_id')
#         if not env_id:
#             return jsonify({'error': 'env_id required'}), 400
        
#         report_data_service = services.get_report_data_service()
#         report = report_data_service.collect_report_data(run_id, env_id)
        
#         return jsonify({
#             'success': True,
#             'report': report
#         })
        
#     except Exception as e:
#         traceback.print_exc()
#         return jsonify({'error': str(e)}), 500