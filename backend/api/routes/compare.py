import pandas as pd
from flask import Blueprint, request, jsonify
from api.utils import handle_errors
from api.services import services
import traceback
from case_pack.case_pack_generator import CasePackGenerator

compare_bp = Blueprint('compare', __name__)

@compare_bp.route('/run-analysis', methods=['POST'])
def compare_cases():
    """
    Compares two cases side-by-side with granular detail (Alerts, Txns, Entities).
    """
    try:
        # 0. Validate Inputs
        if not request.is_json: return jsonify({"error": "Missing JSON body"}), 400
        data = request.get_json()
        case_a_id, case_b_id = data.get('case_a'), data.get('case_b')

        if not case_a_id or not case_b_id:
            return jsonify({"error": "Both Case IDs are required"}), 400

        env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
        tenant_id = getattr(request, 'tenant_id', None)
        if not env_id:
            return jsonify({"error": "No active environment selected"}), 400
        db_manager = services.get_investigation_db(env_id, tenant_id)
        generator = CasePackGenerator(db_manager)

        pack_a = generator.generate_case_pack(case_a_id)
        pack_b = generator.generate_case_pack(case_b_id)

        if pack_a.get('error') or pack_b.get('error'):
            return jsonify({"error": "One or both cases not found."}), 404

        # 2. Extract & Calculate Overlaps
        def get_names(pack):
            return {cp['name'] for cp in pack.get('network_profile', {}).get('top_counterparties', [])}

        def get_alert_types(pack):
            return {a.get('type', 'Unknown') for a in pack.get('alerts', [])}

        common_entities = list(get_names(pack_a).intersection(get_names(pack_b)))
        common_alerts = list(get_alert_types(pack_a).intersection(get_alert_types(pack_b)))

        # 3. Generate AI Narrative
        ai_insight = "AI Analysis unavailable."
        try:
            if services.ollama_wrapper:
                prompt = f"Compare Case {case_a_id} and {case_b_id}. Case A has {len(pack_a['alerts'])} alerts. Case B has {len(pack_b['alerts'])} alerts. Common links: {common_entities}. Which is riskier?"
                res = services.ollama_wrapper.generate(prompt)
                if res.get('success'): ai_insight = res['response']
            else:
                ai_insight = f"Case {case_a_id if pack_a['risk_score'] > pack_b['risk_score'] else case_b_id} has a higher risk score. They share {len(common_entities)} counterparty connections."
        except: pass

        # 4. HELPER: Format Lists for Frontend
        def _amt_value(txn):
            for k in ['amount', 'txn_amount', 'transaction_amount', 'amt', 'value', 'rule_metric']:
                v = txn.get(k)
                if v is None or v == "":
                    continue
                try:
                    return float(v)
                except Exception:
                    pass
            return 0.0

        def _sum_volume(txns):
            if not txns:
                return 0.0
            try:
                return float(sum(_amt_value(t) for t in txns))
            except Exception:
                return 0.0

        def format_txns(txns):
            # Sort by amount desc and take top 10
            sorted_tx = sorted(txns, key=lambda x: _amt_value(x), reverse=True)
            return sorted_tx[:10]

        # 5. Structure Response (NOW WITH DETAILED LISTS)
        comparison = {
            "case_a": {
                "id": case_a_id,
                "risk_score": pack_a.get('risk_score', 0),
                "volume": pack_a.get('financial_profile', {}).get('total_volume', _sum_volume(pack_a.get('transactions', []))),
                "alert_count": len(pack_a.get('alerts', [])),
                "alerts": pack_a.get('alerts', []),           # <--- NEW
                "transactions": format_txns(pack_a.get('transactions', [])), # <--- NEW
                "customers": pack_a.get('customers', [])      # <--- NEW
            },
            "case_b": {
                "id": case_b_id,
                "risk_score": pack_b.get('risk_score', 0),
                "volume": pack_b.get('financial_profile', {}).get('total_volume', _sum_volume(pack_b.get('transactions', []))),
                "alert_count": len(pack_b.get('alerts', [])),
                "alerts": pack_b.get('alerts', []),           # <--- NEW
                "transactions": format_txns(pack_b.get('transactions', [])), # <--- NEW
                "customers": pack_b.get('customers', [])      # <--- NEW
            },
            "analysis": {
                "common_counterparties": common_entities,
                "common_typologies": common_alerts,
                "overlap_score": _calculate_overlap_score(get_names(pack_a), get_names(pack_b)),
                "ai_narrative": ai_insight
            }
        }

        return jsonify(comparison)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

def _calculate_overlap_score(set_a, set_b):
    if not set_a and not set_b: return 0
    union = len(set_a.union(set_b))
    if union == 0: return 0
    return round((len(set_a.intersection(set_b)) / union) * 100, 1)
