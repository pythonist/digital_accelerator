# backend/api/routes/calibration/report_routes.py
"""
Report Generation Routes - FIXED VERSION
Handles comprehensive report generation with AI explanations
"""
from flask import Blueprint, request, jsonify, send_file, make_response
from api.services import services
import traceback
import os
report_bp = Blueprint('report', __name__)

@report_bp.route('/<run_id>/full', methods=['GET'])
def get_full_report_data(run_id):
    """
    Get complete JSON data for UI report screen
    
    GET /api/v2/calibration/report/{run_id}/full?env_id=xxx
    """
    try:
        # Handle both query param styles
        env_id = request.args.get('env_id') or request.args.get('params[env_id]')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400

        print(f"📊 Generating report data for run {run_id}, env {env_id}")

        # Use ReportDataService to collect all data
        report_service = services.get_report_service()
        report = report_service.collect_report_data(run_id, env_id)

        print(f"✅ Report data generated successfully")

        return jsonify({
            'success': True,
            'report': report
        })

    except Exception as e:
        print(f"❌ Report generation failed: {e}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@report_bp.route('/<run_id>/pdf', methods=['GET'])
def download_pdf_report(run_id):
    """
    Generate and download PDF with AI explanations
    
    GET /api/v2/calibration/report/{run_id}/pdf?env_id=xxx
    """
    try:
        env_id = request.args.get('env_id') or request.args.get('params[env_id]')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400

        print(f"📄 Generating PDF for run {run_id}, env {env_id}")

        # Step 1: Collect report data
        print("  → Collecting report data...")
        data_service = services.get_report_service()
        report_data = data_service.collect_report_data(run_id, env_id)
        
        # Step 2: Generate PDF
        print("  → Generating PDF (this may take 10-15 seconds with AI)...")
        pdf_service = services.get_pdf_generator_service()
        pdf_path = pdf_service.generate_pdf(report_data)
        
        # ✅ Verify file exists and is readable
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF not found at {pdf_path}")
        
        print(f"✅ PDF generated successfully at: {pdf_path}")
        print(f"   File size: {os.path.getsize(pdf_path)} bytes")
        
        # ✅ Step 3: Send file with proper headers
        response = make_response(
            send_file(
                pdf_path,
                mimetype='application/pdf',
                as_attachment=True,
                download_name=f'calibration_report_{run_id}.pdf'
            )
        )
        
        # ✅ Add CORS headers if needed
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Expose-Headers'] = 'Content-Disposition'
        
        return response

    except Exception as e:
        print(f"❌ PDF generation failed: {e}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@report_bp.route('/<run_id>/ai-explanation', methods=['POST'])
def generate_ai_explanation(run_id):
    """
    Generate AI explanation for a specific section
    Called from UI for on-demand explanations
    
    POST /api/v2/calibration/report/{run_id}/ai-explanation
    Body: {
        "section": "data_foundation" | "filters" | "aggregation" | "threshold" | "governance",
        "data": {...section-specific data...}
    }
    """
    try:
        env_id = request.args.get('env_id')
        body = request.get_json()
        section = body.get('section')
        section_data = body.get('data', {})
        
        if not section:
            return jsonify({'error': 'section parameter required'}), 400
        
        print(f"🤖 Generating AI explanation for section: {section}")
        
        ollama = getattr(services, 'llm_provider', None) or getattr(services, 'ollama_wrapper', None)
        
        if not ollama or not ollama.check_connection():
            return jsonify({
                'success': False,
                'error': 'AI service unavailable',
                'explanation': None
            }), 503
        
        # Initialize AI explanation service
        from calibration.services.ai_explanation_service import AIExplanationService
        ai_service = AIExplanationService(ollama)
        
        # Generate explanation based on section
        explanation = None
        
        if section == 'data_foundation':
            explanation = ai_service.explain_data_foundation(section_data)
        elif section == 'filters':
            explanation = ai_service.explain_filter_strategy(section_data)
        elif section == 'aggregation':
            explanation = ai_service.explain_aggregation_logic(section_data)
        elif section == 'threshold':
            explanation = ai_service.explain_threshold_selection(section_data)
        elif section == 'governance':
            explanation = ai_service.explain_governance_decision(section_data)
        elif section == 'executive_summary':
            # Get full report data for executive summary
            report_service = services.get_report_data_service()
            full_report = report_service.collect_report_data(run_id, env_id)
            explanation = ai_service.generate_executive_summary(full_report)
        else:
            return jsonify({'error': f'Unknown section: {section}'}), 400
        
        if explanation:
            print(f"✅ AI explanation generated for {section}")
            # Clean markdown formatting
            from calibration.services.pdf_reporting.components import clean_ai_markdown
            clean_explanation = clean_ai_markdown(explanation)
            
            return jsonify({
                'success': True,
                'section': section,
                'explanation': clean_explanation,
                'raw_explanation': explanation
            })
        else:
            return jsonify({
                'success': False,
                'error': 'AI explanation generation failed',
                'explanation': None
            }), 500

    except Exception as e:
        print(f"❌ AI explanation failed: {e}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@report_bp.route('/<run_id>/ai-status', methods=['GET'])
def check_ai_status(run_id):
    """
    Check if AI explanations are available
    
    GET /api/v2/calibration/report/{run_id}/ai-status
    """
    try:
        llm_service = getattr(services, 'llm_provider', None) or getattr(services, 'ollama_wrapper', None)
        
        if llm_service:
            is_connected = llm_service.check_connection()
            models = llm_service.list_models()
            
            return jsonify({
                'available': is_connected,
                'connected': is_connected,
                'provider': getattr(llm_service, 'provider_name', 'ollama'),
                'models': models,
                'default_model': llm_service.default_model if is_connected else None
            })
        else:
            return jsonify({
                'available': False,
                'connected': False,
                'provider': None,
                'models': [],
                'default_model': None,
                'message': 'AI provider not initialized'
            })
    
    except Exception as e:
        return jsonify({
            'available': False,
            'error': str(e)
        })
