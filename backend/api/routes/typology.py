from flask import Blueprint, request, jsonify
from api.services import services

typology_bp = Blueprint('typology', __name__) 

@typology_bp.route('/typology/analyze', methods=['POST'])
def analyze_case():
    """
    Connects the API to your TypologyDetector logic
    """
    try:
        case_id = request.json.get('case_id')
        if not case_id:
            return jsonify({'error': 'Case ID is required'}), 400

        # Call the logic from services
        if not services.typology_detector:
            return jsonify({'error': 'Typology Service not initialized'}), 500
            
        result = services.typology_detector.run_analysis(case_id)
        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e)}), 500