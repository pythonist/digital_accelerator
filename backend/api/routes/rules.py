"""
API Endpoint for Dynamic AML Rules & Risk Intelligence
Location: api/routes/rules.py
"""
from flask import Blueprint, request, jsonify
from api.services import services
from api.utils import handle_errors
import json

rules_bp = Blueprint('rules', __name__)

# --- 1. UNIFIED RISK INTELLIGENCE ENDPOINT ---
@rules_bp.route('/risk-intelligence/analyze', methods=['POST'])
@handle_errors
def analyze_risk():
    """
    Unified Endpoint: Runs both Rules and Typologies with smart prioritization.
    Returns comprehensive analysis with explanations.
    """
    case_id = request.json.get('case_id')
    if not case_id:
        return jsonify({'error': 'Case ID required'}), 400
    
    # Run comprehensive analysis
    result = services.rule_engine.run_risk_analysis(case_id)
    
    # Add smart selection metadata if this was auto-selected
    if result.get('status') == 'success':
        # Fetch case details for selection reasoning
        case_details = services.rule_engine.get_case_metadata(case_id)
        if case_details:
            result['selection_metadata'] = {
                'severity': case_details.get('severity', 'Unknown'),
                'alert_count': case_details.get('alert_count', 0),
                'auto_selected': True,
                'selection_factors': [
                    f"Severity Level: {case_details.get('severity', 'Unknown')}",
                    f"{case_details.get('alert_count', 0)} active alerts pending review",
                    "Automatically prioritized based on risk indicators"
                ]
            }
    
    return jsonify(result)

# --- 2. RULE MANAGEMENT ENDPOINTS ---

@rules_bp.route('/rules', methods=['GET'])
@handle_errors
def get_rules():
    """
    Get all configured rules with metadata.
    Used by Rule Manager UI.
    """
    services.rule_engine.reload_rules()
    
    rules_list = []
    for rule_id, rule in services.rule_engine.rules.items():
        rules_list.append({
            'id': rule_id,
            'name': rule.get('name', 'Unnamed Rule'),
            'description': rule.get('description', ''),
            'severity': rule.get('severity', 'Medium'),
            'category': rule.get('category', 'General'),
            'enabled': rule.get('enabled', True),
            'conditions': rule.get('conditions', []),
            'logic': rule.get('logic', 'AND'),
            'created_at': rule.get('created_at', None),
            'updated_at': rule.get('updated_at', None)
        })
    
    return jsonify({
        'rules': rules_list,
        'total_count': len(rules_list),
        'enabled_count': sum(1 for r in rules_list if r['enabled']),
        'severity_breakdown': {
            'critical': sum(1 for r in rules_list if r['severity'] == 'Critical'),
            'high': sum(1 for r in rules_list if r['severity'] == 'High'),
            'medium': sum(1 for r in rules_list if r['severity'] == 'Medium'),
            'low': sum(1 for r in rules_list if r['severity'] == 'Low')
        }
    })

@rules_bp.route('/rules/<rule_id>', methods=['GET'])
@handle_errors
def get_rule_detail(rule_id):
    """Get detailed information for a specific rule"""
    services.rule_engine.reload_rules()
    
    if rule_id not in services.rule_engine.rules:
        return jsonify({'error': 'Rule not found'}), 404
    
    rule = services.rule_engine.rules[rule_id]
    
    # Add explanation of what this rule does
    explanation = services.rule_engine.generate_rule_explanation(rule_id)
    
    return jsonify({
        'rule': rule,
        'explanation': explanation
    })

@rules_bp.route('/rules', methods=['POST'])
@handle_errors
def create_rule():
    """
    Create a new rule.
    Body: {name, description, severity, category, conditions, logic, enabled}
    """
    rule_data = request.json
    
    # Validation
    required_fields = ['name', 'severity', 'conditions']
    for field in required_fields:
        if field not in rule_data:
            return jsonify({'error': f'Missing required field: {field}'}), 400
    
    # Generate ID
    rule_id = rule_data.get('id') or f"RULE_{len(services.rule_engine.rules) + 1:03d}"
    
    # Check if ID already exists
    if rule_id in services.rule_engine.rules:
        return jsonify({'error': 'Rule ID already exists'}), 400
    
    # Add timestamps
    from datetime import datetime
    rule_data['created_at'] = datetime.now().isoformat()
    rule_data['updated_at'] = datetime.now().isoformat()
    
    # Set defaults
    rule_data.setdefault('enabled', True)
    rule_data.setdefault('logic', 'AND')
    rule_data.setdefault('category', 'General')
    rule_data.setdefault('description', '')
    
    # Save
    services.rule_engine.rules[rule_id] = rule_data
    if services.rule_engine.save_rules(services.rule_engine.rules):
        return jsonify({
            'success': True,
            'rule_id': rule_id,
            'message': 'Rule created successfully'
        }), 201
    else:
        return jsonify({'error': 'Failed to save rule'}), 500

@rules_bp.route('/rules/<rule_id>', methods=['PUT'])
@handle_errors
def update_rule(rule_id):
    """Update an existing rule"""
    if rule_id not in services.rule_engine.rules:
        return jsonify({'error': 'Rule not found'}), 404
    
    rule_data = request.json
    
    # Update timestamp
    from datetime import datetime
    rule_data['updated_at'] = datetime.now().isoformat()
    
    # Preserve created_at if it exists
    if 'created_at' in services.rule_engine.rules[rule_id]:
        rule_data['created_at'] = services.rule_engine.rules[rule_id]['created_at']
    
    # Update
    services.rule_engine.rules[rule_id] = rule_data
    
    if services.rule_engine.save_rules(services.rule_engine.rules):
        return jsonify({
            'success': True,
            'message': 'Rule updated successfully'
        })
    else:
        return jsonify({'error': 'Failed to save rule'}), 500

@rules_bp.route('/rules/<rule_id>', methods=['DELETE'])
@handle_errors
def delete_rule(rule_id):
    """Delete a rule"""
    if rule_id not in services.rule_engine.rules:
        return jsonify({'error': 'Rule not found'}), 404
    
    rule_name = services.rule_engine.rules[rule_id].get('name', rule_id)
    
    del services.rule_engine.rules[rule_id]
    
    if services.rule_engine.save_rules(services.rule_engine.rules):
        return jsonify({
            'success': True,
            'message': f'Rule "{rule_name}" deleted successfully'
        })
    else:
        return jsonify({'error': 'Failed to save changes'}), 500

@rules_bp.route('/rules/<rule_id>/toggle', methods=['POST'])
@handle_errors
def toggle_rule(rule_id):
    """Enable/disable a rule"""
    if rule_id not in services.rule_engine.rules:
        return jsonify({'error': 'Rule not found'}), 404
    
    current_state = services.rule_engine.rules[rule_id].get('enabled', True)
    services.rule_engine.rules[rule_id]['enabled'] = not current_state
    
    from datetime import datetime
    services.rule_engine.rules[rule_id]['updated_at'] = datetime.now().isoformat()
    
    if services.rule_engine.save_rules(services.rule_engine.rules):
        return jsonify({
            'success': True,
            'enabled': not current_state,
            'message': f'Rule {"enabled" if not current_state else "disabled"}'
        })
    else:
        return jsonify({'error': 'Failed to save changes'}), 500

@rules_bp.route('/rules/bulk-update', methods=['POST'])
@handle_errors
def bulk_update_rules():
    """
    Bulk update multiple rules at once.
    Used by JSON editor in Rule Manager.
    """
    new_rules = request.json.get('rules')
    if not new_rules or not isinstance(new_rules, dict):
        return jsonify({'error': 'Invalid rule format'}), 400
    
    # Validate structure
    for rule_id, rule in new_rules.items():
        if not isinstance(rule, dict):
            return jsonify({'error': f'Invalid rule format for {rule_id}'}), 400
        
        required = ['name', 'severity', 'conditions']
        for field in required:
            if field not in rule:
                return jsonify({'error': f'Missing {field} in rule {rule_id}'}), 400
    
    if services.rule_engine.save_rules(new_rules):
        return jsonify({
            'success': True,
            'message': f'{len(new_rules)} rules updated successfully'
        })
    else:
        return jsonify({'error': 'Failed to save rules'}), 500

# --- 3. TYPOLOGY ENDPOINTS ---

@rules_bp.route('/typologies/available', methods=['GET'])
@handle_errors
def get_available_typologies():
    """
    Get list of all available typology detectors.
    Returns metadata about each typology.
    """
    typologies = services.rule_engine.get_typology_metadata()
    return jsonify({'typologies': typologies})

@rules_bp.route('/typologies/explain/<typology_id>', methods=['GET'])
@handle_errors
def explain_typology(typology_id):
    """
    Get detailed explanation of how a specific typology is detected.
    """
    explanation = services.rule_engine.explain_typology(typology_id)
    
    if not explanation:
        return jsonify({'error': 'Typology not found'}), 404
    
    return jsonify(explanation)

# --- 4. STATISTICS & INSIGHTS ---

@rules_bp.route('/statistics/rules', methods=['GET'])
@handle_errors
def get_rule_statistics():
    """
    Get statistics about rule performance.
    Shows which rules trigger most frequently.
    """
    stats = services.rule_engine.get_rule_statistics()
    return jsonify(stats)

@rules_bp.route('/validation/check', methods=['POST'])
@handle_errors
def validate_case_data():
    """
    Check if a case has all required data fields for analysis.
    Returns missing fields and data quality score.
    """
    case_id = request.json.get('case_id')
    if not case_id:
        return jsonify({'error': 'Case ID required'}), 400
    
    validation = services.rule_engine.validate_case_data(case_id)
    return jsonify(validation)

# --- 5. LEGACY COMPATIBILITY ---

@rules_bp.route('/rules/list', methods=['GET'])
@handle_errors
def list_rules_legacy():
    """Legacy endpoint - redirects to new format"""
    return get_rules()

@rules_bp.route('/rules/update', methods=['POST'])
@handle_errors
def update_rules_legacy():
    """Legacy endpoint - redirects to bulk update"""
    return bulk_update_rules()

@rules_bp.route('/rules/evaluate-case', methods=['POST'])
@handle_errors
def evaluate_case_legacy():
    """Legacy endpoint - redirects to new analysis"""
    return analyze_risk()

@rules_bp.route('/rules/add', methods=['POST'])
@handle_errors
def add_rule_legacy():
    """Legacy endpoint - redirects to create"""
    return create_rule()

@rules_bp.route('/rules/delete', methods=['POST'])
@handle_errors
def delete_rule_legacy():
    """Legacy endpoint - uses DELETE method now"""
    rule_id = request.json.get('rule_id')
    if not rule_id:
        return jsonify({'error': 'rule_id required'}), 400
    return delete_rule(rule_id)