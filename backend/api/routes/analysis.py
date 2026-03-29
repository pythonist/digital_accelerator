# analysis.py - Enhanced API Routes for AML Analysis

from collections import Counter
from flask import Blueprint, request, jsonify
from api.utils import handle_errors
from api.services import services
import traceback
from datetime import datetime
import pandas as pd

from case_pack.case_pack_generator import CasePackGenerator
from services.mule_detection.money_flow import MoneyFlowAnalyzer, MoneyFlowConfig
from services.network_intelligence_service import NetworkIntelligenceService
from services.network_report_adapter_service import NetworkReportAdapterService

analysis_bp = Blueprint('analysis', __name__)

def _get_env_db():
    env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or services.metadata_manager.active_env
    tenant_id = getattr(request, 'tenant_id', None)
    if not env_id:
        return None, None
    try:
        db = services.get_investigation_db(env_id, tenant_id)
        return env_id, db
    except Exception:
        return env_id, None


def _pick_col(df: pd.DataFrame, candidates):
    for c in candidates:
        if c in df.columns:
            return c
    return None


def _canonicalize_transactions(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()

    out = df.copy()
    out.columns = [str(c) for c in out.columns]

    mappings = [
        ("account_id", ["account_id", "acct_id", "accountid", "account_no", "account"]),
        (
            "counterparty_account",
            [
                "counterparty_account",
                "counterparty_account_id",
                "counterparty",
                "cp_account",
                "to_account",
                "to_acct",
                "receiver_account",
                "beneficiary_account",
                "destination_account",
                "dst_account",
            ],
        ),
        ("txn_timestamp", ["txn_timestamp", "timestamp", "txn_time", "transaction_time", "transaction_datetime", "created_at", "date", "time"]),
        ("amount", ["amount", "txn_amount", "transaction_amount", "amt", "value", "rule_metric"]),
        ("direction", ["direction", "dr_cr", "debit_credit", "txn_direction", "type", "transaction_type"]),
    ]

    for target, candidates in mappings:
        if target in out.columns:
            continue
        src = _pick_col(out, candidates)
        if src:
            out[target] = out[src]

    if "txn_timestamp" in out.columns:
        out["txn_timestamp"] = pd.to_datetime(out["txn_timestamp"], errors="coerce")
    if "amount" in out.columns:
        out["amount"] = pd.to_numeric(out["amount"], errors="coerce")

    def _norm_dir(v):
        if v is None:
            return None
        s = str(v).strip().lower()
        if s in {"outbound", "out", "debit", "dr"}:
            return "outbound"
        if s in {"inbound", "in", "credit", "cr"}:
            return "inbound"
        return s

    if "direction" in out.columns:
        out["direction"] = out["direction"].apply(_norm_dir)

    return out

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

@analysis_bp.route('/network-intelligence/<case_id>', methods=['GET'])
@handle_errors
def get_saved_network_intelligence(case_id):
    env_id, db = _get_env_db()
    if not db:
        return jsonify({'error': 'DB not ready', 'env_id': env_id}), 503
    conn = db.connect()
    try:
        adapter = NetworkReportAdapterService()
        saved = adapter.load_case_result(conn.cursor(), case_id)
        if not saved:
            return jsonify({'success': True, 'case_id': case_id, 'saved': None})
        return jsonify({'success': True, 'case_id': case_id, 'saved': saved})
    finally:
        db.close_connection(conn)


@analysis_bp.route('/network-intelligence/analyze', methods=['POST'])
@handle_errors
def analyze_network_intelligence():
    req = request.get_json(silent=True) or {}
    case_id = str(req.get('case_id') or '').strip()
    if not case_id:
        return jsonify({'error': 'Case ID is required'}), 400

    env_id, db = _get_env_db()
    if not db:
        return jsonify({'error': 'DB not ready', 'env_id': env_id}), 503

    service = NetworkIntelligenceService(db)
    result = service.analyze(case_id, filters=req.get('filters') or {})
    return jsonify({'success': True, **result})


@analysis_bp.route('/network-intelligence/save', methods=['POST'])
@handle_errors
def save_network_intelligence():
    req = request.get_json(silent=True) or {}
    case_id = str(req.get('case_id') or '').strip()
    payload = req.get('payload') if isinstance(req.get('payload'), dict) else {}
    if not case_id or not payload:
        return jsonify({'error': 'case_id and payload are required'}), 400

    env_id, db = _get_env_db()
    if not db:
        return jsonify({'error': 'DB not ready', 'env_id': env_id}), 503

    conn = db.connect()
    try:
        adapter = NetworkReportAdapterService()
        saved = adapter.save_case_result(
            conn.cursor(),
            case_id,
            payload,
            include_in_report=bool(req.get('include_in_report', True)),
        )
        conn.commit()
        return jsonify({'success': True, 'saved': saved})
    finally:
        db.close_connection(conn)

@analysis_bp.route('/graph/build-full-case', methods=['POST'])
@handle_errors
def build_full_case():
    """
    Builds a Quantexa-style money flow graph:
    - Nodes: account_id (+ score/rule nodes)
    - Edges: txn_id, time-ordered, direction-aware
    - Includes propagation paths + circular path flags
    - Includes pattern detection for mule behavior
    """
    case_id = request.json.get('case_id')
    if not case_id:
        return jsonify({'error': 'Case ID is required'}), 400

    env_id, db = _get_env_db()
    if not db:
        return jsonify({'error': 'DB not ready', 'env_id': env_id}), 503

    req = request.json or {}
    focal_account_id = req.get("account_id")

    cfg = MoneyFlowConfig(
        window_hours=float(req.get("window_hours", 48.0)),
        max_hops=int(req.get("max_hops", 4)),
        amount_tolerance=float(req.get("amount_tolerance", 0.12)),
        max_edges=int(req.get("max_edges", 350)),
        max_paths=int(req.get("max_paths", 25)),
        pass_through_window_hours=float(req.get("pass_through_window_hours", 1.0)),
    )
    start_ts = req.get("start_ts")
    end_ts = req.get("end_ts")

    generator = CasePackGenerator(db)
    pack = generator.generate_case_pack(case_id)
    if not pack or pack.get("error"):
        return jsonify({'success': False, 'error': pack.get("error") if pack else 'Failed to build case pack'}), 404

    txns = pack.get("transactions") or []

    df = _canonicalize_transactions(pd.DataFrame(txns))
    if df.empty:
        try:
            alerts = pack.get("alerts") or []
            if alerts:
                adf = pd.DataFrame(alerts)
                acc_col = _pick_col(adf, ["account_id", "acct_id", "accountid", "account_no", "account", "ACCOUNT_ID"])
                id_col = _pick_col(adf, ["alert_id", "id", "ALERT_ID", "ref"])
                amt_col = _pick_col(adf, ["amount", "amt", "value", "rule_metric"])
                ts_col = _pick_col(adf, ["txn_timestamp", "timestamp", "transaction_date", "txn_date", "date", "time", "created_at", "ALERT_DATE"])
                accounts = []
                nodes = []
                links = []
                seen_acc = set()
                for _, r in adf.iterrows():
                    a = r.get(acc_col)
                    if a not in [None, ""]:
                        aid = str(a)
                        if aid not in seen_acc:
                            nodes.append({"id": aid, "label": aid, "type": "account", "risk_score": 0, "volume": 0.0, "val": 6})
                            seen_acc.add(aid)
                        accounts.append(aid)
                    alid = r.get(id_col)
                    alnode = None
                    if alid not in [None, ""]:
                        alnode = f"ALERT_{str(alid)}"
                        nodes.append({"id": alnode, "label": str(alid), "type": "alert", "risk_score": 50, "volume": 0.0, "val": 6})
                    if a not in [None, ""] and alnode:
                        amt = float(r.get(amt_col) or 0.0)
                        ts = r.get(ts_col)
                        links.append(
                            {
                                "id": None,
                                "source": str(a),
                                "target": alnode,
                                "amount": amt,
                                "ts": ts,
                                "channel": None,
                                "txn_type": None,
                                "device_id": None,
                                "ip_address": None,
                                "geo_location": None,
                                "counterparty_bank": None,
                                "relation": "txn",
                                "width": 1.0,
                                "volume": amt,
                            }
                        )
                        for i in range(len(nodes)):
                            if str(nodes[i].get("id") or "") == str(a):
                                nodes[i]["volume"] = float(nodes[i].get("volume") or 0.0) + amt
                accounts = list(dict.fromkeys([x for x in accounts if x not in [None, ""]]))
                focal = str(focal_account_id or (accounts[0] if accounts else "") or "")
                graph = {"nodes": nodes, "links": links, "paths": [], "patterns": {}, "case_id": case_id, "account_id": focal, "parameters": {}}
                narrative = f"Case {case_id} alert-derived minimal network with {len(nodes)} entities and {len(links)} links."
                return jsonify({"success": True, "graph": graph, "narrative": narrative, "accounts": accounts})
            if services.graph_builder:
                services.graph_builder.build_full_case_network(case_id)
                exported = services.graph_builder.export_graph_data() or {}
                nodes = exported.get("nodes") or []
                raw_links = exported.get("links") or []
                links = []
                def _norm_id(x):
                    s = str(x or "")
                    if s.startswith("ACC_"):
                        return s[len("ACC_"):]
                    if s.startswith("CP_"):
                        return s[len("CP_"):]
                    if s.startswith("CASE_"):
                        return s[len("CASE_"):]
                    if s.startswith("CUST_"):
                        return s[len("CUST_"):]
                    if s.startswith("ALERT_"):
                        return s[len("ALERT_"):]
                    return s
                for l in raw_links:
                    links.append(
                        {
                            "id": None,
                            "source": _norm_id(l.get("source")),
                            "target": _norm_id(l.get("target")),
                            "amount": float(l.get("volume") or 0.0),
                            "ts": (
                                (l.get("transactions") or [{}])[0].get("date")
                                if isinstance(l.get("transactions"), list) and len(l.get("transactions")) > 0
                                else None
                            ),
                            "channel": None,
                            "txn_type": None,
                            "device_id": None,
                            "ip_address": None,
                            "geo_location": None,
                            "counterparty_bank": None,
                            "relation": "txn",
                            "width": float(l.get("width") or 1.0),
                            "volume": float(l.get("volume") or 0.0),
                        }
                    )
                norm_nodes = []
                for n in nodes:
                    nid = _norm_id(n.get("id"))
                    lbl = n.get("label") or nid
                    norm_nodes.append({**n, "id": nid, "label": lbl})
                volmap = {}
                for e in links:
                    volmap[e["source"]] = volmap.get(e["source"], 0.0) + float(e.get("volume") or 0.0)
                    volmap[e["target"]] = volmap.get(e["target"], 0.0) + 0.0
                for i in range(len(norm_nodes)):
                    nid = str(norm_nodes[i].get("id") or "")
                    norm_nodes[i]["volume"] = float(volmap.get(nid) or 0.0)
                acct_nodes = [n for n in norm_nodes if str(n.get("type")).lower() == "account"]
                accounts = []
                for n in acct_nodes:
                    nid = str(n.get("id") or "")
                    if nid:
                        accounts.append(nid)
                focal = str(focal_account_id or (accounts[0] if accounts else "") or "")
                graph = {"nodes": norm_nodes, "links": links, "paths": [], "patterns": {}, "case_id": case_id, "account_id": focal, "parameters": {}}
                narrative = f"Case {case_id} alert-based network with {len(nodes)} entities and {len(links)} relationships."
                return jsonify({"success": True, "graph": graph, "narrative": narrative, "accounts": accounts})
        except Exception:
            pass
        return jsonify({'success': False, 'error': 'No usable transactions rows for flow graph'}), 200

    if not focal_account_id:
        acct_col = "account_id" if "account_id" in df.columns else None
        if acct_col:
            counts = df[acct_col].dropna().astype(str).value_counts()
            focal_account_id = str(counts.index[0]) if len(counts.index) > 0 else None

    if not focal_account_id:
        return jsonify({'success': False, 'error': 'Unable to resolve a focal account for this case'}), 200

    analyzer = MoneyFlowAnalyzer(cfg)
    flow = analyzer.build_account_flow_graph(df, str(focal_account_id), start_ts=start_ts, end_ts=end_ts)
    if not flow.get("success"):
        # Fallback: Use alert-based graph and adapt for UI expectations
        try:
            if services.graph_builder:
                services.graph_builder.build_full_case_network(case_id)
                exported = services.graph_builder.export_graph_data() or {}
                nodes = exported.get("nodes") or []
                raw_links = exported.get("links") or []
                def _norm_id(x):
                    s = str(x or "")
                    if s.startswith("ACC_"):
                        return s[len("ACC_"):]
                    if s.startswith("CP_"):
                        return s[len("CP_"):]
                    if s.startswith("CASE_"):
                        return s[len("CASE_"):]
                    if s.startswith("CUST_"):
                        return s[len("CUST_"):]
                    if s.startswith("ALERT_"):
                        return s[len("ALERT_"):]
                    return s
                links = []
                for l in raw_links:
                    links.append(
                        {
                            "id": None,
                            "source": _norm_id(l.get("source")),
                            "target": _norm_id(l.get("target")),
                            "amount": float(l.get("volume") or 0.0),
                            "ts": (
                                (l.get("transactions") or [{}])[0].get("date")
                                if isinstance(l.get("transactions"), list) and len(l.get("transactions")) > 0
                                else None
                            ),
                            "channel": None,
                            "txn_type": None,
                            "device_id": None,
                            "ip_address": None,
                            "geo_location": None,
                            "counterparty_bank": None,
                            "relation": "txn",
                            "width": float(l.get("width") or 1.0),
                            "volume": float(l.get("volume") or 0.0),
                        }
                    )
                norm_nodes = []
                for n in nodes:
                    t = str(n.get("type") or "").lower()
                    nid = _norm_id(n.get("id"))
                    lbl = n.get("label") or nid
                    norm_nodes.append({**n, "id": nid, "label": lbl})
                volmap = {}
                for e in links:
                    volmap[e["source"]] = volmap.get(e["source"], 0.0) + float(e.get("volume") or 0.0)
                    volmap[e["target"]] = volmap.get(e["target"], 0.0) + 0.0
                for i in range(len(norm_nodes)):
                    nid = str(norm_nodes[i].get("id") or "")
                    norm_nodes[i]["volume"] = float(volmap.get(nid) or 0.0)
                acct_nodes = [n for n in norm_nodes if str(n.get("type")).lower() == "account"]
                accounts = []
                for n in acct_nodes:
                    nid = str(n.get("id") or "")
                    if nid:
                        accounts.append(nid)
                focal = str(focal_account_id or (accounts[0] if accounts else "") or "")
                graph = {
                    "nodes": norm_nodes,
                    "links": links,
                    "paths": [],
                    "patterns": {},
                    "case_id": case_id,
                    "account_id": focal,
                    "parameters": {},
                }
                narrative = f"Case {case_id} alert-based network with {len(norm_nodes)} entities and {len(links)} relationships."
                return jsonify({"success": True, "graph": graph, "narrative": narrative, "accounts": accounts})
        except Exception:
            pass
        return jsonify(flow), 200

    nodes = [dict(n) for n in (flow.get("graph") or {}).get("nodes", [])]
    links = []
    for e in (flow.get("graph") or {}).get("edges", []):
        links.append(
            {
                "id": e.get("id"),
                "source": e.get("source"),
                "target": e.get("target"),
                "amount": e.get("amount"),
                "volume": e.get("amount"),
                "ts": e.get("ts"),
                "channel": e.get("channel"),
                "txn_type": e.get("txn_type"),
                "device_id": e.get("device_id"),
                "ip_address": e.get("ip_address"),
                "geo_location": e.get("geo_location"),
                "counterparty_bank": e.get("counterparty_bank"),
                "relation": "txn",
                "width": min(max(float(e.get("amount") or 0) / 1000.0, 0.5), 6.0),
            }
        )

    score_nodes = []
    score_links = []

    patterns = flow.get("patterns") or {}
    flow_score = float(flow.get("flow_score") or patterns.get("flow_score") or 0.0)
    flow_node_id = f"{focal_account_id}::FLOW"
    score_nodes.append({"id": flow_node_id, "label": f"Network Score\n{flow_score:.3f}", "type": "score", "kind": "network"})
    score_links.append({"source": str(focal_account_id), "target": flow_node_id, "relation": "score"})

    ml_score = None
    try:
        conn = db.connect()
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        tables = [r[0] for r in cur.fetchall()]
        acc_table = next((t for t in tables if str(t).lower() == "accounts" or "account" in str(t).lower()), None)
        if acc_table:
            cur.execute(f'SELECT * FROM "{acc_table}" LIMIT 1')
            cols = [d[0] for d in cur.description]
            acc_id_col = next((c for c in cols if str(c).lower() in {"account_id", "acct_id", "accountid", "account_no"}), None)
            ml_col = next((c for c in cols if str(c).lower() in {"ml_score", "mule_score", "model_score"}), None)
            is_mule_col = next((c for c in cols if str(c).lower() in {"is_mule", "mule"}), None)
            risk_col = next((c for c in cols if "risk" in str(c).lower() and "rating" in str(c).lower()), None)
            if acc_id_col:
                cur.execute(f'SELECT * FROM "{acc_table}" WHERE "{acc_id_col}" = ? LIMIT 1', (str(focal_account_id),))
                row = cur.fetchone()
                if row:
                    rec = dict(zip(cols, row))
                    if ml_col and rec.get(ml_col) not in [None, ""]:
                        try:
                            ml_score = float(rec.get(ml_col))
                        except Exception:
                            ml_score = None
                    elif is_mule_col and rec.get(is_mule_col) not in [None, ""]:
                        v = str(rec.get(is_mule_col)).strip().lower()
                        ml_score = 1.0 if v in {"1", "true", "yes", "y"} else 0.0
                    elif risk_col and rec.get(risk_col) not in [None, ""]:
                        try:
                            rv = float(rec.get(risk_col))
                            ml_score = max(0.0, min(rv / 100.0, 1.0))
                        except Exception:
                            ml_score = None
    except Exception:
        ml_score = None
    finally:
        try:
            db.close_connection(conn)
        except Exception:
            pass

    if ml_score is not None:
        ml_node_id = f"{focal_account_id}::ML"
        score_nodes.append({"id": ml_node_id, "label": f"ML Score\n{float(ml_score):.3f}", "type": "score", "kind": "ml"})
        score_links.append({"source": str(focal_account_id), "target": ml_node_id, "relation": "score"})

    trigger_nodes = []
    trigger_links = []
    alerts = pack.get("alerts") or []
    trigger_keys = ["rule", "rule_id", "rule_name", "alert_type", "typology", "scenario"]
    triggers = []
    for a in alerts:
        for k in trigger_keys:
            if k in a and a.get(k) not in [None, ""]:
                triggers.append(str(a.get(k)))
                break
    uniq = []
    seen = set()
    for t in triggers:
        if t in seen:
            continue
        seen.add(t)
        uniq.append(t)
    uniq = uniq[:12]
    if uniq:
        rules_node_id = f"{focal_account_id}::RULES"
        score_nodes.append({"id": rules_node_id, "label": f"Rule Triggers\n{len(uniq)}", "type": "score", "kind": "rules"})
        score_links.append({"source": str(focal_account_id), "target": rules_node_id, "relation": "score"})
        for r in uniq:
            rid = f"{focal_account_id}::RULE::{r}"
            trigger_nodes.append({"id": rid, "label": r, "type": "rule"})
            trigger_links.append({"source": rules_node_id, "target": rid, "relation": "trigger"})

    graph = {
        "nodes": nodes + score_nodes + trigger_nodes,
        "links": links + score_links + trigger_links,
        "paths": flow.get("paths") or [],
        "patterns": patterns,
        "case_id": case_id,
        "account_id": str(focal_account_id),
        "parameters": flow.get("parameters") or {},
    }

    narrative = f"Case {case_id} money flow graph centered on account {focal_account_id} with {len(nodes)} accounts and {len(links)} transactions."
    if int(patterns.get("circular_chains", {}).get("count", 0) or 0) > 0:
        narrative += " Circular paths detected."
    if float(patterns.get("pass_through", {}).get("rate", 0) or 0) > 0:
        narrative += " Pass-through behavior detected."

    accounts = []
    try:
        if "account_id" in df.columns:
            accounts = [str(a) for a in df["account_id"].dropna().astype(str).unique().tolist()]
    except Exception:
        accounts = []

    return jsonify({"success": True, "graph": graph, "narrative": narrative, "accounts": accounts})


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
    """Typology intelligence assessment alias."""
    from services.typology_intelligence_service import TypologyIntelligenceService

    req = request.get_json(silent=True) or {}
    case_id = str(req.get('case_id') or '').strip()
    if not case_id:
        return jsonify({'error': 'Case ID is required'}), 400

    service = TypologyIntelligenceService(services.investigation_db)
    result = service.analyze(case_id, options=req.get('options') or {})
    return jsonify({'success': True, **result})


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
