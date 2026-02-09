from flask import Blueprint, request, jsonify
from api.utils import handle_errors
from api.services import services

typology_bp = Blueprint('typology', __name__) 

@typology_bp.route('/typology/analyze', methods=['POST'])
@handle_errors
def analyze_case():
    """
    Connects the API to your TypologyDetector logic
    """
    try:
        data = request.get_json(silent=True) or {}
        case_id = data.get('case_id')
        if not case_id:
            return jsonify({'error': 'Case ID is required'}), 400

        # Call the logic from services
        if not services.typology_detector:
            return jsonify({'error': 'Typology Service not initialized'}), 400
        matches = services.typology_detector.analyze_case(case_id)
        return jsonify({'matches': [m.__dict__ for m in matches]})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@typology_bp.route('/typology/analyze-case', methods=['POST'])
@handle_errors
def analyze_case_alias():
    try:
        data = request.get_json(silent=True) or {}
        case_id = data.get('case_id')
        if not case_id:
            return jsonify({'error': 'Case ID is required'}), 400
        if not services.typology_detector:
            return jsonify({'error': 'Typology Service not initialized'}), 400
        matches = services.typology_detector.analyze_case(case_id)
        return jsonify({'matches': [m.__dict__ for m in matches]})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@typology_bp.route('/typology/list', methods=['GET'])
@handle_errors
def list_typologies():
    try:
        if not services.rule_engine:
            return jsonify({'typologies': []})
        meta = services.rule_engine.get_typology_metadata()
        return jsonify({'typologies': meta})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@typology_bp.route('/typology/report/<case_id>', methods=['GET'])
@handle_errors
def typology_report(case_id):
    try:
        if not case_id:
            return jsonify({'error': 'Case ID is required'}), 400
        if not services.typology_detector:
            return jsonify({'error': 'Typology Service not initialized'}), 400
        res = services.typology_detector.analyze_case(case_id)
        summary = {
            'case_id': case_id,
            'match_count': len(res) if isinstance(res, list) else 0,
            'matches': [m.__dict__ for m in res] if isinstance(res, list) else [],
        }
        return jsonify({'success': True, 'report': summary})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
