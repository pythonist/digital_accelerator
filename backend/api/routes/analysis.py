# analysis.py - Enhanced API Routes for AML Analysis

from collections import Counter
from flask import Blueprint, request, jsonify
from api.utils import handle_errors
from api.services import services
import traceback

analysis_bp = Blueprint('analysis', __name__)

# ============================================================================
# BASELINE ANALYSIS ROUTES (Enhanced)
# ============================================================================

@analysis_bp.route('/baseline/detect-deviations', methods=['POST'])
@handle_errors
def detect_deviations():
    """
    ENHANCED: Advanced behavioral deviation detection with multi-dimensional analysis.
    
    Request body:
    {
        "case_id": "CASE123",
        "customer_id": "optional",  // Auto-resolved if not provided
        "analysis_mode": "comprehensive"  // quick, comprehensive, or deep
    }
    
    Returns comprehensive deviation analysis with risk scoring.
    """
    data = request.json
    case_id = data.get('case_id')
    customer_id = data.get('customer_id')
    analysis_mode = data.get('analysis_mode', 'comprehensive')
    
    if not case_id:
        return jsonify({
            'error': 'case_id is required',
            'status': 'failed'
        }), 400
    
    if not services.baseline_engine:
        return jsonify({
            'error': 'Baseline Engine not initialized',
            'status': 'failed',
            'hint': 'Check server configuration'
        }), 500
    
    try:
        print(f"🔍 Processing baseline analysis for case: {case_id}")
        
        # Run comprehensive analysis
        result = services.baseline_engine.detect_deviations(
            case_id=case_id,
            customer_id=customer_id,
            analysis_mode=analysis_mode
        )
        
        # Check for errors in result
        if 'error' in result:
            return jsonify({
                **result,
                'status': 'failed'
            }), 404 if 'not found' in result['error'].lower() else 400
        
        # Success - add status
        result['status'] = 'success'
        
        print(f"✅ Analysis complete: {result['deviation_level']} risk ({result['deviation_score']} score)")
        
        return jsonify(result), 200
        
    except Exception as e:
        print(f"❌ Baseline analysis error: {str(e)}")
        traceback.print_exc()
        
        return jsonify({
            'error': f'Analysis failed: {str(e)}',
            'case_id': case_id,
            'status': 'failed',
            'traceback': traceback.format_exc() if services.app.debug else None
        }), 500


@analysis_bp.route('/baseline/customer-history/<customer_id>', methods=['GET'])
@handle_errors
def get_customer_history(customer_id):
    """
    NEW: Retrieve historical deviation analysis for a customer.
    
    Shows trend over time - useful for identifying persistent patterns.
    """
    if not services.baseline_engine:
        return jsonify({'error': 'Baseline Engine not initialized'}), 500
    
    try:
        history = services.baseline_engine.get_customer_history(customer_id)
        
        return jsonify({
            'status': 'success',
            'customer_id': customer_id,
            'history': history,
            'count': len(history)
        }), 200
        
    except Exception as e:
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


@analysis_bp.route('/baseline/batch-analyze', methods=['POST'])
@handle_errors
def batch_baseline_analysis():
    """
    NEW: Analyze multiple cases in batch mode.
    
    Request body:
    {
        "case_ids": ["CASE1", "CASE2", "CASE3"],
        "analysis_mode": "quick"  // Use quick mode for batch
    }
    
    Useful for portfolio-level risk assessment.
    """
    data = request.json
    case_ids = data.get('case_ids', [])
    analysis_mode = data.get('analysis_mode', 'quick')
    
    if not case_ids or len(case_ids) == 0:
        return jsonify({'error': 'case_ids array is required'}), 400
    
    if len(case_ids) > 100:
        return jsonify({'error': 'Maximum 100 cases per batch'}), 400
    
    if not services.baseline_engine:
        return jsonify({'error': 'Baseline Engine not initialized'}), 500
    
    results = []
    errors = []
    
    for case_id in case_ids:
        try:
            result = services.baseline_engine.detect_deviations(
                case_id=case_id,
                analysis_mode=analysis_mode
            )
            
            if 'error' not in result:
                results.append({
                    'case_id': case_id,
                    'deviation_score': result.get('deviation_score', 0),
                    'deviation_level': result.get('deviation_level', 'Unknown'),
                    'customer_id': result.get('customer_id'),
                    'findings_count': len(result.get('deviations', []))
                })
            else:
                errors.append({
                    'case_id': case_id,
                    'error': result['error']
                })
        except Exception as e:
            errors.append({
                'case_id': case_id,
                'error': str(e)
            })
    
    # Sort by risk score descending
    results.sort(key=lambda x: x['deviation_score'], reverse=True)
    
    return jsonify({
        'status': 'success',
        'analyzed': len(results),
        'failed': len(errors),
        'results': results,
        'errors': errors if errors else None,
        'summary': {
            'critical_risk': len([r for r in results if r['deviation_score'] >= 75]),
            'high_risk': len([r for r in results if 50 <= r['deviation_score'] < 75]),
            'medium_risk': len([r for r in results if 25 <= r['deviation_score'] < 50]),
            'low_risk': len([r for r in results if 0 < r['deviation_score'] < 25])
        }
    }), 200


@analysis_bp.route('/baseline/stats', methods=['GET'])
@handle_errors
def baseline_statistics():
    """
    NEW: Get system-wide baseline analysis statistics.
    
    Useful for compliance reporting and system monitoring.
    """
    if not services.baseline_engine:
        return jsonify({'error': 'Baseline Engine not initialized'}), 500
    
    try:
        conn = services.investigation_db.connect()
        cursor = conn.cursor()
        
        # Get total analyses performed
        cursor.execute("""
            SELECT COUNT(*) as total_analyses,
                   COUNT(DISTINCT customer_id) as unique_customers,
                   AVG(deviation_score) as avg_score
            FROM deviation_history
        """)
        
        stats_row = cursor.fetchone()
        
        # Get distribution by risk level
        cursor.execute("""
            SELECT deviation_level, COUNT(*) as count
            FROM deviation_history
            GROUP BY deviation_level
        """)
        
        distribution = {row['deviation_level']: row['count'] for row in cursor.fetchall()}
        
        services.investigation_db.close_connection(conn)
        
        return jsonify({
            'status': 'success',
            'total_analyses': stats_row['total_analyses'] if stats_row else 0,
            'unique_customers': stats_row['unique_customers'] if stats_row else 0,
            'average_score': round(stats_row['avg_score'], 2) if stats_row and stats_row['avg_score'] else 0,
            'risk_distribution': distribution,
            'timestamp': datetime.now().isoformat()
        }), 200
        
    except Exception as e:
        return jsonify({
            'error': str(e),
            'status': 'failed'
        }), 500


# ============================================================================
# INVESTIGATOR DASHBOARD
# ============================================================================

@analysis_bp.route('/dashboard/priority-queue', methods=['GET'])
@handle_errors
def get_priority_cases():
    """
    Returns a ranked list of high-risk cases for the investigator.
    Eliminates manual searching.
    """
    if not services.graph_builder: 
        return jsonify({'error': 'Graph service not initialized'}), 500
        
    prioritized_cases = services.graph_builder.prioritize_cases()
    
    return jsonify({
        'success': True,
        'queue': prioritized_cases,
        'count': len(prioritized_cases)
    })


# ============================================================================
# GRAPH ANALYSIS ROUTES
# ============================================================================

@analysis_bp.route('/graph/build-full-case', methods=['POST'])
@handle_errors
def build_full_case():
    """
    Builds the full investigation pack: 
    Network Graph + Typology Evidence + Risk Metrics
    """
    case_id = request.json.get('case_id')
    if not case_id: return jsonify({'error': 'Case ID is required'}), 400
    if not services.graph_builder: return jsonify({'error': 'Graph service not initialized'}), 500
        
    # 1. Build the Network
    services.graph_builder.build_full_case_network(case_id)
    
    # 2. Export with enriched data (Evidence & Metrics)
    data = services.graph_builder.export_graph_data()
    
    # 3. Generate a human-readable summary
    alert_count = sum(1 for n in data['nodes'] if n['type'] == 'alert')
    risk_score = data['metrics']['max_risk']
    
    narrative = f"Case {case_id} represents a High Risk network ({risk_score}/100) involving {len(data['nodes'])} entities and {alert_count} active alerts."
    
    if data['evidence']:
        narrative += f" Primary typology detected: {data['evidence'][0]['typology']}."

    return jsonify({
        'success': True,
        'graph': data,
        'narrative': narrative
    })


@analysis_bp.route('/graph/build-case', methods=['POST'])
@handle_errors
def build_case_graph():
    """
    Simple network: Source Accounts -> Target Counterparties (Transactions only)
    """
    case_id = request.json.get('case_id')
    if not case_id: return jsonify({'error': 'Case ID is required'}), 400
    if not services.graph_builder: return jsonify({'error': 'Service not ready'}), 400
        
    services.graph_builder.build_case_graph(case_id)
    data = services.graph_builder.export_graph_data()

    return jsonify({
        'success': True,
        'graph': data,
        'narrative': "Simplified transaction graph generated."
    })


@analysis_bp.route('/graph/build-custom', methods=['POST'])
@handle_errors
def build_custom_graph():
    """
    User-defined mapping: Table + {source, target, amount}
    """
    req = request.json
    if not services.graph_builder: return jsonify({'error': 'Graph service not initialized.'}), 400
    
    table = req.get('table')
    mapping = req.get('mapping') 

    if not table or not mapping: return jsonify({'error': 'Missing table or mapping'}), 400

    services.graph_builder.build_custom_graph(table, mapping)
    data = services.graph_builder.export_graph_data()
    
    return jsonify({
        'success': True, 
        'graph': data,
        'insights': "Custom graph built."
    })


@analysis_bp.route('/graph/build-any', methods=['POST'])
@handle_errors
def build_any_graph():
    """
    Auto-detects columns from any table
    """
    table = request.json.get('table')
    if not table: return jsonify({'error': 'Table name is required'}), 400
    if not services.graph_builder: return jsonify({'error': 'Graph service not initialized.'}), 400

    services.graph_builder.build_graph_from_any_table(table)
    data = services.graph_builder.export_graph_data()

    return jsonify({
        'success': True,
        'graph': data,
        'narrative': f"Auto-built graph from table '{table}'"
    })


@analysis_bp.route('/graph/detect-cycles', methods=['POST'])
@handle_errors
def detect_cycles():
    """Circular money flow detection"""
    case_id = request.json.get('case_id')
    if not services.graph_builder: return jsonify({'error': 'Service not ready'}), 400
    
    services.graph_builder.build_case_graph(case_id)
    cycles = services.graph_builder.detect_circular_patterns()
    return jsonify({
        'cycles_found': len(cycles), 
        'cycles': [{'path': c, 'length': len(c)} for c in cycles]
    })


@analysis_bp.route('/graph/key-players', methods=['POST'])
@handle_errors
def key_players():
    """Network centrality analysis"""
    case_id = request.json.get('case_id')
    if not services.graph_builder: return jsonify({'error': 'Service not ready'}), 400

    services.graph_builder.build_case_graph(case_id)
    players = services.graph_builder.find_key_players()
    return jsonify({
        'key_players': [{'node_id': p[0], 'centrality_scores': p[1]} for p in players]
    })


# ============================================================================
# TYPOLOGY DETECTION
# ============================================================================

@analysis_bp.route('/typology/analyze-case', methods=['POST'])
@handle_errors
def analyze_typology():
    """Money laundering typology detection"""
    matches = services.typology_detector.analyze_case(request.json.get('case_id'))
    return jsonify({
        'matches': [m.__dict__ for m in matches]
    })


# ============================================================================
# CASE COMPARISON
# ============================================================================

@analysis_bp.route('/compare/run-analysis', methods=['POST'])
@handle_errors
def compare_cases():
    """
    Side-by-side case comparison with forensic analysis
    """
    c1 = request.json.get('case_id_1')
    c2 = request.json.get('case_id_2')
    
    if not c1 or not c2:
        return jsonify({'error': 'Two cases are required'}), 400

    p1 = services.case_pack_generator.generate_case_pack(c1)
    p2 = services.case_pack_generator.generate_case_pack(c2)
    
    if 'error' in p1: return jsonify({'error': f"Case A ({c1}): {p1['error']}"}), 404
    if 'error' in p2: return jsonify({'error': f"Case B ({c2}): {p2['error']}"}), 404

    forensics = services.comparison_engine.compare_cases(p1, p2)

    def count_by_key(pack, key, subkey):
        items = pack.get(key, [])
        return Counter([i.get(subkey, 'Unknown') for i in items])

    a1_counts = count_by_key(p1, 'alerts', 'alert_type')
    a2_counts = count_by_key(p2, 'alerts', 'alert_type')
    
    all_alert_types = set(list(a1_counts.keys()) + list(a2_counts.keys()))
    alert_chart = []
    for t in all_alert_types:
        alert_chart.append({
            "name": t,
            "Case A": a1_counts.get(t, 0),
            "Case B": a2_counts.get(t, 0)
        })

    c1_counts = count_by_key(p1, 'transactions', 'type')
    c2_counts = count_by_key(p2, 'transactions', 'type')
    
    all_channels = set(list(c1_counts.keys()) + list(c2_counts.keys()))
    channel_chart = []
    for c in all_channels:
        channel_chart.append({
            "name": c,
            "Case A": c1_counts.get(c, 0),
            "Case B": c2_counts.get(c, 0)
        })

    return jsonify({
        "forensics": forensics,
        "chart_data": {
            "alerts": alert_chart,
            "channels": channel_chart
        },
        "case1": p1,
        "case2": p2
    })


@analysis_bp.route('/compare/ai-analysis', methods=['POST'])
@handle_errors
def compare_ai_analysis():
    """
    AI-powered case comparison narrative
    """
    data = request.json
    c1 = data.get('case_id_1')
    c2 = data.get('case_id_2')
    model = data.get('model', 'llama3.2')
    
    p1 = services.case_pack_generator.generate_case_pack(c1)
    p2 = services.case_pack_generator.generate_case_pack(c2)
    
    prompt = f"""
You are an expert AML Investigator with 20+ years of experience.
Compare Case {c1} vs Case {c2}.
Provide a risk assessment based on alerts, volume, and typologies.
"""
    res = services.ollama_wrapper.generate(prompt, model=model)
    return jsonify({
        'analysis': res.get('response', 'AI analysis unavailable')
    })


# ============================================================================
# UTILITY ROUTES
# ============================================================================

@analysis_bp.route('/health', methods=['GET'])
def health_check():
    """Health check for analysis services"""
    return jsonify({
        'status': 'healthy',
        'services': {
            'baseline_engine': services.baseline_engine is not None,
            'graph_builder': services.graph_builder is not None,
            'typology_detector': services.typology_detector is not None
        }
    }), 200


# Import datetime for stats endpoint
from datetime import datetime