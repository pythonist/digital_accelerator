"""
Case Facts Routes - FINAL VERSION with Explicit Environment Resolution
"""
from flask import Blueprint, request, jsonify
from api.middleware.auth_middleware import require_auth
from api.services import services
from api.utils import handle_errors
import asyncio
import traceback
import os

case_facts_bp = Blueprint('case_facts', __name__)


def resolve_db(req_obj):
    """
    ✅ ENHANCED: Explicit environment resolution with better error messages
    Priority: Query Param → Header → Global Fallback (with warning)
    """
    tenant_id = req_obj.tenant_id
    
    # 1. Try query parameter first (most explicit)
    env_id = req_obj.args.get('env_id')
    source = "query_param"
    
    # 2. Try header (sent by frontend API client)
    if not env_id:
        env_id = req_obj.headers.get('X-Environment-ID')
        source = "header"
    
    # 3. Fallback to global state (legacy compatibility, but log warning)
    if not env_id:
        env_id = services.metadata_manager.active_env
        source = "global_fallback"
        if env_id:
            print(f"⚠️  WARNING: Using global environment state ({env_id}). Frontend should pass env_id explicitly.")
    
    if not env_id:
        raise ValueError(
            "No Environment ID provided. Frontend must pass env_id via query param (?env_id=X) "
            "or header (X-Environment-ID). Check that AppContext.activeEnv is set."
        )

    print(f"🔍 Environment Resolution: env_id={env_id}, tenant={tenant_id}, source={source}")

    # 2. Get DB Manager (stateless factory)
    try:
        db_manager = services.get_investigation_db(env_id, tenant_id)
        return db_manager, env_id
    except Exception as e:
        print(f"❌ DB Resolution Failed: {e}")
        raise ValueError(f"Failed to access environment '{env_id}': {str(e)}")


# --- PRIORITY INBOX ENDPOINT ---
@case_facts_bp.route('/cases/ranked', methods=['GET'])
@require_auth()
@handle_errors
def get_ranked_cases():
    """
    ✅ FIXED: Get list of cases ranked by risk score with explicit env resolution
    """
    try:
        db_manager, env_id = resolve_db(request)
        
        conn = db_manager.connect(db_manager.db_path)
        cursor = conn.cursor()
        
        # Check if cases table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='cases'")
        if not cursor.fetchone():
            db_manager.close_connection(conn)
            return jsonify({
                'success': True, 
                'cases': [], 
                'message': 'No cases table found. Master data may not be built yet.',
                'env_id': env_id
            })

        # Fetch ranked cases
        query = """
        SELECT 
            case_id, 
            alert_type, 
            created_at as date,
            risk_rating as risk_level,
            customer_name,
            COALESCE(risk_score, 0) as risk_score,
            COALESCE(status, 'NEW') as status
        FROM cases
        ORDER BY 
            CASE 
                WHEN LOWER(risk_rating) = 'critical' THEN 1
                WHEN LOWER(risk_rating) = 'high' THEN 2
                WHEN LOWER(risk_rating) = 'medium' THEN 3
                ELSE 4
            END ASC,
            created_at DESC
        LIMIT 100
        """
        
        try:
            cursor.execute(query)
        except Exception as e:
            print(f"⚠️  Query failed, trying fallback: {e}")
            # Fallback for minimal schema
            cursor.execute("""
                SELECT 
                    case_id, 
                    COALESCE(alert_type, 'General') as alert_type,
                    COALESCE(created_at, datetime('now')) as date,
                    COALESCE(risk_rating, 'Medium') as risk_level,
                    COALESCE(customer_name, 'Unknown') as customer_name,
                    0 as risk_score,
                    'NEW' as status 
                FROM cases 
                LIMIT 100
            """)

        rows = cursor.fetchall()
        
        # Format results
        ranked_cases = []
        for r in rows:
            case_id = r[0]
            alert_type = r[1] if r[1] else 'General'
            date = r[2]
            risk_level = str(r[3]).capitalize() if r[3] else 'Medium'
            customer_name = r[4] if r[4] else 'Unknown'
            risk_score = int(r[5]) if r[5] else 0
            status = r[6] if len(r) > 6 else 'NEW'
            
            # Normalize score if missing
            if risk_score == 0:
                risk_level_lower = risk_level.lower()
                if risk_level_lower == 'critical': 
                    risk_score = 95
                elif risk_level_lower == 'high': 
                    risk_score = 75
                elif risk_level_lower == 'medium': 
                    risk_score = 45
                else: 
                    risk_score = 15

            ranked_cases.append({
                'case_id': case_id,
                'risk_level': risk_level,
                'risk_score': risk_score,
                'alert_count': 1,  # Simplified (would need JOIN with alerts table)
                'critical_alerts': 1 if risk_level.lower() in ['critical', 'high'] else 0,
                'last_alert': date,
                'alert_types': {alert_type: 1},
                'customer_name': customer_name,
                'status': status
            })
            
        db_manager.close_connection(conn)
        
        print(f"✅ Ranked {len(ranked_cases)} cases for env={env_id}")
        
        return jsonify({
            'success': True,
            'cases': ranked_cases,
            'env_id': env_id,
            'count': len(ranked_cases)
        })

    except ValueError as ve:
        # Environment resolution errors
        return jsonify({
            'success': False, 
            'error': str(ve),
            'hint': 'Ensure environment is properly selected and master data is built'
        }), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            'success': False, 
            'error': str(e),
            'hint': 'Check server logs for details'
        }), 500


@case_facts_bp.route('/case/<case_id>/facts', methods=['GET'])
@require_auth()
@handle_errors
def get_case_facts(case_id):
    """Get deterministic case facts"""
    try:
        from case_facts.facts_builder import build_case_facts
        
        db_manager, env_id = resolve_db(request)
        tenant_id = request.tenant_id
        
        case_facts = asyncio.run(
            build_case_facts(
                case_id=case_id,
                env_id=env_id,
                tenant_id=tenant_id,
                db_manager=db_manager
            )
        )
        
        return jsonify({
            "success": True,
            "facts": {
                "case_id": case_facts.case_id,
                "risk": {
                    "risk_score": round(case_facts.overall_risk_score, 1),
                    "risk_level": case_facts.customer_risk_rating.value,
                    "kyc_status": "Verified",
                    "flagged_behaviors": [d.factor for d in case_facts.risk_drivers[:5]]
                },
                "alerts": {
                    "total_alerts": case_facts.previous_alerts_count,
                    "critical_alerts": len([d for d in case_facts.risk_drivers if d.severity.value == "critical"]),
                    "latest_alert": case_facts.alert_date.isoformat()
                },
                "transactions": {
                    "total_volume": round(case_facts.patterns_30d.total_volume, 2),
                    "avg_amount": round(case_facts.patterns_30d.avg_amount, 2),
                    "cash_ratio": round(case_facts.patterns_30d.cash_ratio, 3),
                    "transaction_count": case_facts.patterns_30d.total_count
                },
                "customer": {
                    "id": case_facts.customer_id,
                    "name": case_facts.customer_name,
                    "risk_rating": case_facts.customer_risk_rating.value
                },
                "network": {
                    "total_nodes": case_facts.network.total_nodes,
                    "total_edges": case_facts.network.total_edges,
                    "density": round(case_facts.network.density, 3)
                },
                "drivers": [
                    {"factor": d.factor, "severity": d.severity.value, "explanation": d.explanation}
                    for d in case_facts.risk_drivers
                ]
            },
            "metadata": {
                "generated_at": case_facts.generated_at.isoformat(),
                "env_id": case_facts.env_id
            }
        })
        
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": f"Failed to build case facts: {str(e)}"}), 500


@case_facts_bp.route('/case/<case_id>/copilot', methods=['POST'])
@require_auth()
@handle_errors  
def copilot_assist(case_id):
    """LLM Copilot - narrative assistance only"""
    try:
        from case_facts.facts_builder import build_case_facts
        
        data = request.json
        question = data.get('question', '')
        
        if not question:
            return jsonify({"success": False, "error": "No question provided"}), 400
        
        db_manager, env_id = resolve_db(request)
        tenant_id = request.tenant_id
        
        case_facts = asyncio.run(
            build_case_facts(
                case_id=case_id,
                env_id=env_id,
                tenant_id=tenant_id,
                db_manager=db_manager
            )
        )
        
        # Create concise facts summary for LLM
        facts_summary = f"""Case {case_id} Investigation Summary:

RISK PROFILE:
- Overall Risk Score: {case_facts.overall_risk_score:.1f}/100
- Risk Level: {case_facts.customer_risk_rating.value.upper()}
- Alert Type: {case_facts.alert_type}
- Customer: {case_facts.customer_name} (ID: {case_facts.customer_id})

KEY RISK DRIVERS:
{chr(10).join(f"• {d.factor}: {d.explanation}" for d in case_facts.risk_drivers[:5])}

TRANSACTION ACTIVITY (30 Days):
- Total Volume: ${case_facts.patterns_30d.total_volume:,.2f}
- Transaction Count: {case_facts.patterns_30d.total_count}
- Average Amount: ${case_facts.patterns_30d.avg_amount:,.2f}
- Cash Ratio: {case_facts.patterns_30d.cash_ratio:.1%}

NETWORK ANALYSIS:
- Network Nodes: {case_facts.network.total_nodes}
- Transaction Links: {case_facts.network.total_edges}
- Network Density: {case_facts.network.density:.3f}

INVESTIGATION CONTEXT:
- Previous Alerts: {case_facts.previous_alerts_count}
- Rules Triggered: {', '.join(case_facts.rules_triggered) if case_facts.rules_triggered else 'None'}
- Typologies: {', '.join(case_facts.typologies_detected) if case_facts.typologies_detected else 'None'}

INVESTIGATOR QUESTION: {question}

Provide a clear, professional response based ONLY on these facts. Be concise and actionable."""

        llm_service = getattr(services, "llm_provider", None) or getattr(services, "ollama_wrapper", None)
        if not llm_service or not llm_service.check_connection():
            return jsonify({
                "success": False,
                "error": "LLM service not available. Configure Ollama or GPT4All first."
            }), 500
        
        result = llm_service.generate(
            prompt=facts_summary,
            system_prompt="You are an AML investigation assistant. Provide clear, professional responses based ONLY on the provided case facts. Be concise and focus on actionable insights.",
            temperature=0.7,
            max_tokens=500
        )
        
        if not result.get('success'):
            return jsonify({
                "success": False,
                "error": "LLM generation failed",
                "details": result.get('error')
            }), 500
        
        return jsonify({
            "success": True,
            "response": result['response'],
            "metadata": {
                "case_id": case_id,
                "env_id": env_id,
                "risk_score": round(case_facts.overall_risk_score, 1),
                "question": question
            }
        })
        
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": f"Copilot error: {str(e)}",
            "details": traceback.format_exc() if os.getenv('DEBUG') else None
        }), 500


@case_facts_bp.route('/env/<env_id>/validate', methods=['GET'])
@require_auth()
@handle_errors
def validate_environment(env_id):
    """
    ✅ NEW: Validate that an environment database exists and has master data
    Used by frontend to check readiness before showing Priority Inbox
    """
    try:
        tenant_id = request.tenant_id
        
        # Try to get DB manager
        try:
            db_manager = services.get_investigation_db(env_id, tenant_id)
        except Exception as e:
            return jsonify({
                "success": False,
                "error": f"Environment not found: {str(e)}",
                "env_id": env_id,
                "has_cases_table": False,
                "case_count": 0
            }), 404
        
        if not os.path.exists(db_manager.db_path):
            return jsonify({
                "success": False,
                "error": f"Environment database not found at: {db_manager.db_path}",
                "env_id": env_id,
                "has_cases_table": False,
                "case_count": 0
            }), 404
        
        # Connect and check tables
        conn = db_manager.connect(db_manager.db_path)
        cursor = conn.cursor()
        
        # Get table count
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        table_count = cursor.fetchone()[0]
        
        # Check for cases table
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='cases'")
        has_cases = cursor.fetchone() is not None
        
        # Get case count if table exists
        case_count = 0
        if has_cases:
            try:
                cursor.execute("SELECT COUNT(*) FROM cases")
                case_count = cursor.fetchone()[0]
            except:
                pass
        
        db_manager.close_connection(conn)
        
        return jsonify({
            "success": True,
            "env_id": env_id,
            "db_path": db_manager.db_path,
            "table_count": table_count,
            "has_cases_table": has_cases,
            "case_count": case_count,
            "master_data_ready": has_cases and case_count > 0,
            "message": "Environment is accessible" if has_cases else "Master data not built"
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e),
            "env_id": env_id
        }), 500
