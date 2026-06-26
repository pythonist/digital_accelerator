# llm.py

from flask import Blueprint, request, jsonify
from api.utils import handle_errors
from api.services import services
from case_pack.case_pack_generator import CasePackGenerator
import time
import json
import re
import math
import os
from datetime import datetime

llm_bp = Blueprint('llm', __name__)


def _get_llm_service():
    requested_provider = str(os.getenv("LLM_PROVIDER") or "").strip().lower()
    ollama_fallback_enabled = str(os.getenv("LLM_ENABLE_OLLAMA_FALLBACK") or "").strip().lower() in {"1", "true", "yes", "on"}
    candidates = [
        ("provider", getattr(services, 'llm_provider', None)),
        ("gpt4all", getattr(services, '_gpt4all_wrapper', None)),
    ]
    if requested_provider == "ollama" or ollama_fallback_enabled:
        candidates.append(("ollama", getattr(services, 'ollama_wrapper', None)))
    for _, candidate in candidates:
        if not candidate:
            continue
        try:
            checker = getattr(candidate, 'check_connection', None)
            if callable(checker) and not checker():
                continue
            return candidate
        except Exception:
            continue
    return None


def _default_llm_model(llm_service=None):
    service = llm_service or _get_llm_service()
    return (
        getattr(service, "default_model", None)
        or os.getenv("OPENAI_MODEL")
        or os.getenv("AI_MODEL")
        or os.getenv("LLM_DEFAULT_MODEL")
        or "gpt-4o-mini"
    )


def _resolve_request_model(payload=None, llm_service=None):
    payload = payload if isinstance(payload, dict) else {}
    requested = str(payload.get("model") or "").strip()
    provider_name = str(getattr(llm_service, "provider_name", "") or os.getenv("LLM_PROVIDER") or "").lower()
    default_model = _default_llm_model(llm_service)
    if not requested:
        return default_model
    if requested.lower().startswith(("llama", "nomic")) and "openai" in provider_name:
        return default_model
    return requested


def _safe_float(value, default=0.0):
    try:
        if value in (None, ""):
            return default
        return float(value)
    except Exception:
        return default


def _jaccard_similarity(left, right):
    left_set = {str(item).strip() for item in (left or []) if str(item).strip()}
    right_set = {str(item).strip() for item in (right or []) if str(item).strip()}
    if not left_set and not right_set:
        return 0.0
    union = len(left_set.union(right_set))
    if union == 0:
        return 0.0
    return len(left_set.intersection(right_set)) / union


def _cosine_similarity(left_vector, right_vector):
    if not left_vector or not right_vector or len(left_vector) != len(right_vector):
        return 0.0
    dot = sum((float(a) * float(b)) for a, b in zip(left_vector, right_vector))
    left_norm = math.sqrt(sum(float(a) * float(a) for a in left_vector))
    right_norm = math.sqrt(sum(float(b) * float(b) for b in right_vector))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def _pick_first(record, keys):
    if not isinstance(record, dict):
        return None
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return None


def _extract_case_pack_features(pack):
    alerts = list(pack.get('alerts') or [])
    transactions = list(pack.get('transactions') or [])
    customers = list(pack.get('customers') or [])
    accounts = list(pack.get('accounts') or [])
    financial_profile = pack.get('financial_profile') or {}
    network_profile = pack.get('network_profile') or {}
    network_graph = pack.get('network_graph') or {}

    counterparties = set()
    for item in network_profile.get('top_counterparties', []) or []:
        name = _pick_first(item, ['name', 'counterparty', 'party'])
        if name:
            counterparties.add(str(name))
    for item in network_graph.get('top_hubs', []) or []:
        name = _pick_first(item, ['name', 'id'])
        if name:
            counterparties.add(str(name))
    for txn in transactions:
        for key in ['counterparty', 'beneficiary', 'party', 'beneficiary_account', 'counterparty_account', 'merchant_name']:
            value = txn.get(key)
            if value not in (None, ''):
                counterparties.add(str(value))

    alert_types = {
        str(_pick_first(alert, ['type', 'alert_type', 'RULE_TRIGGERED', 'rule_triggered']) or '').strip()
        for alert in alerts
    }
    alert_types.discard('')

    txn_types = {
        str(_pick_first(txn, ['type', 'txn_type', 'TXN_TYPE', 'transaction_type']) or '').strip()
        for txn in transactions
    }
    txn_types.discard('')

    customer_ids = {
        str(_pick_first(customer, ['customer_id', 'CUSTOMER_ID', 'id', 'name']) or '').strip()
        for customer in customers
    }
    customer_ids.discard('')

    account_ids = {
        str(_pick_first(account, ['account_id', 'ACCOUNT_ID', 'id']) or '').strip()
        for account in accounts
    }
    account_ids.discard('')

    total_volume = _safe_float(financial_profile.get('total_volume'), 0.0)
    max_transaction = _safe_float(financial_profile.get('max_transaction'), 0.0)
    avg_transaction = _safe_float(financial_profile.get('avg_transaction'), 0.0)
    risk_score = _safe_float(pack.get('risk_score'), 0.0)

    if avg_transaction <= 0 and transactions:
      amounts = [_safe_float(_pick_first(txn, ['amount', 'txn_amount', 'transaction_amount', 'amt', 'value']), 0.0) for txn in transactions]
      positive_amounts = [amount for amount in amounts if amount > 0]
      if positive_amounts:
          avg_transaction = sum(positive_amounts) / len(positive_amounts)
          if max_transaction <= 0:
              max_transaction = max(positive_amounts)

    numeric_signature = [
        math.log1p(max(total_volume, 0.0)),
        math.log1p(max(max_transaction, 0.0)),
        math.log1p(max(avg_transaction, 0.0)),
        float(len(alerts)),
        float(len(transactions)),
        float(len(customers)),
        float(len(counterparties)),
        risk_score / 100.0,
    ]

    return {
        'counterparties': counterparties,
        'alert_types': alert_types,
        'txn_types': txn_types,
        'customer_ids': customer_ids,
        'account_ids': account_ids,
        'numeric_signature': numeric_signature,
        'risk_score': risk_score,
        'alert_count': len(alerts),
        'transaction_count': len(transactions),
        'total_volume': total_volume,
    }


def _hybrid_compare_case_packs(case_id_a, pack_a, case_id_b, pack_b):
    features_a = _extract_case_pack_features(pack_a)
    features_b = _extract_case_pack_features(pack_b)

    counterparty_overlap = _jaccard_similarity(features_a['counterparties'], features_b['counterparties'])
    alert_overlap = _jaccard_similarity(features_a['alert_types'], features_b['alert_types'])
    txn_type_overlap = _jaccard_similarity(features_a['txn_types'], features_b['txn_types'])
    customer_overlap = _jaccard_similarity(features_a['customer_ids'], features_b['customer_ids'])
    account_overlap = _jaccard_similarity(features_a['account_ids'], features_b['account_ids'])
    numeric_similarity = _cosine_similarity(features_a['numeric_signature'], features_b['numeric_signature'])

    risk_gap = abs(features_a['risk_score'] - features_b['risk_score'])
    risk_similarity = max(0.0, 1.0 - min(risk_gap / 100.0, 1.0))

    volume_a = max(features_a['total_volume'], 0.0)
    volume_b = max(features_b['total_volume'], 0.0)
    if volume_a == 0 and volume_b == 0:
        volume_similarity = 0.0
    else:
        volume_similarity = min(volume_a, volume_b) / max(volume_a, volume_b)

    weighted_similarity = (
        0.24 * numeric_similarity +
        0.20 * counterparty_overlap +
        0.14 * alert_overlap +
        0.12 * txn_type_overlap +
        0.10 * customer_overlap +
        0.08 * account_overlap +
        0.07 * risk_similarity +
        0.05 * volume_similarity
    )

    drivers = []
    if counterparty_overlap > 0:
        drivers.append(f"counterparty overlap {round(counterparty_overlap * 100)}%")
    if alert_overlap > 0:
        drivers.append(f"alert-pattern overlap {round(alert_overlap * 100)}%")
    if txn_type_overlap > 0:
        drivers.append(f"transaction-channel overlap {round(txn_type_overlap * 100)}%")
    if numeric_similarity > 0:
        drivers.append(f"numeric behavior cosine {round(numeric_similarity * 100)}%")
    if risk_similarity > 0.7:
        drivers.append("risk profile is closely aligned")
    if not drivers:
        drivers.append("limited direct overlap but some profile proximity remains")

    return {
        'case_id': str(case_id_b),
        'similarity': max(0.0, min(1.0, weighted_similarity)),
        'method': 'hybrid_structured_similarity',
        'reasons': drivers,
        'details': {
            'counterparty_overlap': round(counterparty_overlap, 4),
            'alert_type_overlap': round(alert_overlap, 4),
            'transaction_type_overlap': round(txn_type_overlap, 4),
            'customer_overlap': round(customer_overlap, 4),
            'account_overlap': round(account_overlap, 4),
            'numeric_similarity': round(numeric_similarity, 4),
            'risk_similarity': round(risk_similarity, 4),
            'volume_similarity': round(volume_similarity, 4),
        },
    }


def _build_hybrid_batch_compare(case_ids):
    env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID') or getattr(services.metadata_manager, 'active_env', None)
    tenant_id = getattr(request, 'tenant_id', None)
    if not env_id:
        return {'error': 'No active environment selected for hybrid comparison fallback.'}

    db_manager = services.get_investigation_db(env_id, tenant_id)
    generator = CasePackGenerator(db_manager)
    case_packs = {}

    for case_id in case_ids:
        pack = generator.generate_case_pack(case_id)
        if isinstance(pack, dict) and pack.get('error'):
            return {'error': f"Case {case_id}: {pack.get('error')}"}
        case_packs[str(case_id)] = pack

    matrix = []
    for source_id in case_ids:
        row = []
        for target_id in case_ids:
            if str(source_id) == str(target_id):
                row.append({
                    'case_id': str(target_id),
                    'similarity': 1.0,
                    'method': 'hybrid_structured_similarity',
                    'reasons': ['same case'],
                    'details': {},
                })
            else:
                row.append(_hybrid_compare_case_packs(source_id, case_packs[str(source_id)], target_id, case_packs[str(target_id)]))
        matrix.append({
            'case_id': str(source_id),
            'comparisons': row,
        })

    return {
        'comparison_matrix': matrix,
        'methodology': 'hybrid_structured_similarity',
        'methodology_summary': 'Hybrid similarity fallback uses case-pack-derived features including numeric profile cosine similarity, counterparty overlap, alert-pattern overlap, transaction-channel overlap, customer overlap, account overlap, and risk proximity.',
    }

def clean_sql_output(text):
    """
    Extracts purely the SQL query from the LLM response.
    Handles Markdown code blocks (```sql ... ```) and whitespace.
    """
    # Try to find content inside ```sql ... ``` or ``` ... ```
    match = re.search(r'```(?:sql)?\n(.*?)\n```', text, re.DOTALL)
    if match:
        return match.group(1).strip()
    
    # If no markdown blocks, assume the whole text is the query
    clean_text = text.replace('```', '').strip()
    return clean_text

def is_conversational(msg):
    """
    Quick check to skip SQL generation for simple greetings.
    Returns True if the message is likely just chat (Hi, Hello, Thanks).
    """
    greetings = ['hi', 'hello', 'hey', 'greetings', 'thanks', 'thank you', 'bye', 'help', 'what can you do']
    # Clean string: lowercase, remove punctuation
    clean_msg = re.sub(r'[^\w\s]', '', msg.lower()).strip()
    
    if clean_msg in greetings:
        return True
    if len(clean_msg) < 5: # "Hi", "Yo"
        return True
    return False

# --- 1. General LLM Routes ---
@llm_bp.route('/llm/models', methods=['GET'])
def list_models():
    try:
        llm_service = _get_llm_service()
        if not llm_service:
            return jsonify({'success': False, 'available': False, 'models': [], 'error': 'AI provider unavailable'}), 200
        available = bool(llm_service.check_connection())
        return jsonify({
            'success': available,
            'available': available,
            'provider': getattr(llm_service, 'provider_name', 'local_ai'),
            'default_model': getattr(llm_service, 'default_model', None),
            'models': llm_service.list_models(),
            'error': None if available else 'AI provider unavailable',
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# --- 2. CONTEXT-AWARE CHAT ASSISTANT (Text-to-SQL Pipeline) ---
@llm_bp.route('/chat/assistant', methods=['POST'])
@handle_errors
def chat():
    """
    The Core Intelligence Route.
    It connects the User's question -> Database Schema -> SQL Generation -> Data Retrieval -> Final Answer.
    """
    start_time = time.time()
    msg = request.json.get('message', '')
    llm_service = _get_llm_service()
    model = _resolve_request_model(request.json, llm_service)

    if not llm_service or not llm_service.check_connection():
        return jsonify({
            'success': False,
            'error': 'AI provider unavailable. Configure OpenAI, GPT4All, or another enabled provider first.'
        }), 503
    
    # --- STEP 1: IDENTIFY ACTIVE CONTEXT ---
    active_env_name = services.metadata_manager.active_env
    active_tenant_id = getattr(services.metadata_manager, 'active_tenant', None) or getattr(request, 'tenant_id', None) or 'default'
    active_db_path = None
    
    if active_env_name:
        try:
            bound_db = services.bind_environment_context(active_env_name, active_tenant_id)
            active_db_path = getattr(bound_db, 'db_path', None)
        except Exception:
            try:
                paths = services.metadata_manager.activate_environment(active_env_name, active_tenant_id)
                active_db_path = paths['paths']['investigation_db']
            except Exception:
                existing_db = getattr(services, 'investigation_db', None)
                if existing_db and getattr(services.metadata_manager, 'active_env', None) == active_env_name:
                    active_db_path = getattr(existing_db, 'db_path', None)
                else:
                    active_db_path = None
    
    # --- STEP 2: FETCH RICH SCHEMA ---
    schema_context = "No active investigation database found. Please select an environment."
    if active_db_path:
        schema_context = services.investigation_db.get_rich_schema(db_path=active_db_path)

    # --- STEP 3: OPTIONAL CODE DOCS ---
    tool_context = ""
    # Only verify docs if keywords exist (optimization)
    if services.doc_rag_system:
        keywords = ['code', 'function', 'api', 'error', 'class', 'implementation', 'python']
        if any(k in msg.lower() for k in keywords):
            try: 
                full_docs = services.doc_rag_system.search_docs(msg)
                tool_context = full_docs[:1000]
            except: pass

    # --- STEP 4: DECISION & SQL GENERATION AGENT ---
    data_context = ""
    query_executed = False
    generated_sql = "NO_QUERY"

    # CHEAP HACK: Don't use LLM for "Hi"
    if is_conversational(msg):
        print("[LLM] Skipping SQL Gen for conversational message")
        data_context = "User is greeting or asking for general help. No DB query needed."
    else:
        # We ask the LLM: "Given this schema, write the SQL."
        sql_system_prompt = f"""
        You are a Data Expert for an AML system.
        
        DATABASE SCHEMA:
        {schema_context}
        
        INSTRUCTIONS:
        1. If the user asks for data (e.g., "Find CASE900001"), write a valid SQLite SELECT query.
        2. If the user asks a general question (e.g., "Hi", "Explain AML"), output "NO_QUERY".
        3. Use 'LIKE' for flexible text matching.
        4. Output ONLY the SQL query inside ```sql``` blocks. No explanations.
        """
        
        print("[LLM] Generating SQL Plan...")
        sql_response = llm_service.generate(
            prompt=msg, 
            model=model, 
            system_prompt=sql_system_prompt,
            temperature=0.1
        )
        
        generated_sql = clean_sql_output(sql_response['response'])
        
        # --- STEP 5: EXECUTE SQL (If needed) ---
        if "NO_QUERY" not in generated_sql and "SELECT" in generated_sql.upper():
            print(f"[LLM] Executing SQL: {generated_sql}")
            query_executed = True
            
            query_result = services.investigation_db.execute_safe_query(generated_sql, db_path=active_db_path)
            
            if "error" in query_result:
                data_context = f"SQL Error: {query_result['error']}"
            else:
                data_context = json.dumps(query_result['data'], indent=2)
                if query_result.get('truncated'):
                    data_context += "\n...(Result truncated to 50 rows)"
                if query_result['row_count'] == 0:
                    data_context = "Query executed successfully but returned 0 results. The record does not exist."
        else:
            data_context = "No database query was needed."

    # --- STEP 6: FINAL NARRATIVE GENERATION ---
    # CRITICAL FIX: The System Prompt must force the LLM to trust the data.
    
    final_system_prompt = f"""
    You are a Senior AML Investigator Assistant.
    
    CRITICAL INSTRUCTIONS:
    1. You have access to an INTERNAL, AUTHORIZED investigation database.
    2. The data provided below is REAL and you MUST analyze it. 
    3. DO NOT Refuse to answer. DO NOT say "I cannot provide info".
    4. If the data shows risk, state it clearly.
    
    CONTEXT:
    - Active Case: {active_env_name or "None"}
    - Tool Code Context: {tool_context}
    
    DATA RETRIEVED FROM DATABASE:
    {data_context}
    
    USER QUESTION:
    "{msg}"
    
    Answer the user professionally based ONLY on the data above.
    """
    
    print("[LLM] Generating Final Narrative...")
    final_response = llm_service.chat(
        msg, 
        model=model, 
        system_prompt=final_system_prompt
    )
    
    # Append the internal reasoning for the user to see (Transparency)
    if query_executed:
        final_response['response'] += f"\n\n*(Analysis based on query: `{generated_sql}`)*"
    
    return jsonify(final_response)


# ============================================================================
# DOCUMENTATION RAG ROUTES
# ============================================================================

@llm_bp.route('/rag/build-doc-index', methods=['POST'])
@handle_errors
def build_doc_index():
    """Build or rebuild documentation index for code search"""
    if not services.doc_rag_system: 
        return jsonify({'success': False, 'error': 'DocRAG system not loaded'}), 500
    
    services.doc_rag_system.build_documentation_index()
    return jsonify({'success': True, 'message': 'Knowledge base updated'})


# ============================================================================
# VECTOR RAG ROUTES (Enhanced with new endpoints)
# ============================================================================

@llm_bp.route('/rag/build-index', methods=['POST'])
@handle_errors
def build_case_index():
    """
    Build or rebuild the vector index for case embeddings.
    Enhanced to return detailed metrics.
    """
    if not services.rag_system: 
        return jsonify({'success': False, 'error': 'VectorRAG system not loaded.'}), 500
    
    try:
        force = request.json.get('force_rebuild', False)
        
        print("[RAG] Starting index build...")
        result = services.rag_system.build_case_embeddings(force_rebuild=force)
        
        if result.get('success'):
            return jsonify({
                'success': True,
                'case_count': result.get('indexed_cases', len(services.rag_system.case_id_map)),
                'dimension': result.get('embedding_dim', 768),
                'build_time': result.get('build_time', 0),
                'metrics': result.get('metrics', {})
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': result.get('error', 'Unknown error during index build')
            }), 500
            
    except Exception as e:
        print(f"[RAG] Index build error: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Index build failed: {str(e)}'
        }), 500


@llm_bp.route('/rag/similar-cases', methods=['POST'])
@handle_errors
def similar_cases():
    """
    Find cases similar to a given case using vector similarity.
    Enhanced with better response format and error handling.
    """
    if not services.rag_system: 
        return jsonify({'results': [], 'error': 'RAG not ready'}), 400
    
    try:
        case_id = request.json.get('case_id')
        top_k = int(request.json.get('top_k', 5))
        
        if not case_id:
            return jsonify({'error': 'case_id is required'}), 400
        
        # Validate top_k range
        top_k = max(1, min(top_k, 50))  # Limit between 1 and 50
        
        print(f"[RAG] Searching for cases similar to: {case_id} (top_k={top_k})")
        
        results = services.rag_system.search_similar_cases(case_id, top_k=top_k)
        
        return jsonify({
            'status': 'success',
            'query_case_id': case_id,
            'similar_cases': results,
            'count': len(results)
        }), 200
        
    except Exception as e:
        print(f"[RAG] Similar cases error: {str(e)}")
        return jsonify({
            'status': 'error',
            'error': str(e),
            'similar_cases': []
        }), 500


@llm_bp.route('/rag/search-text', methods=['POST'])
@handle_errors
def search_text():
    """
    Search cases using natural language hypothesis/query.
    Enhanced with better validation and error handling.
    """
    if not services.rag_system: 
        return jsonify({'results': [], 'error': 'RAG not ready'}), 400
    
    try:
        query = request.json.get('query', '').strip()
        top_k = int(request.json.get('top_k', 5))
        
        if not query:
            return jsonify({'error': 'query is required and cannot be empty'}), 400
        
        # Validate top_k range
        top_k = max(1, min(top_k, 50))
        
        print(f"[RAG] Hypothesis search: '{query[:100]}...' (top_k={top_k})")
        
        results = services.rag_system.search_by_text(query, top_k=top_k)
        
        return jsonify({
            'status': 'success',
            'query': query,
            'results': results,
            'count': len(results)
        }), 200
        
    except Exception as e:
        print(f"[RAG] Text search error: {str(e)}")
        return jsonify({
            'status': 'error',
            'error': str(e),
            'results': []
        }), 500


@llm_bp.route('/rag/batch-compare', methods=['POST'])
@handle_errors
def batch_compare():
    """
    NEW ENDPOINT: Compare multiple cases in batch mode.
    Returns a similarity matrix showing relationships between all pairs.
    """
    try:
        case_ids = request.json.get('case_ids', [])
        top_k = int(request.json.get('top_k', 5))
        
        # Validation
        if not case_ids or len(case_ids) < 2:
            return jsonify({
                'error': 'At least 2 case_ids required for batch comparison'
            }), 400
        
        if len(case_ids) > 20:
            return jsonify({
                'error': 'Maximum 20 cases allowed in batch comparison'
            }), 400
        
        print(f"[RAG] Batch comparing {len(case_ids)} cases...")

        result = None
        methodology = None
        methodology_summary = None

        if services.rag_system:
            result = services.rag_system.batch_compare_cases(case_ids, top_k=top_k)
            if 'error' not in (result or {}):
                methodology = 'vector_rag_similarity'
                methodology_summary = 'Portfolio compare used vector embeddings and cosine similarity over rich case summaries stored in the local case index.'

        if not result or 'error' in result:
            fallback = _build_hybrid_batch_compare(case_ids)
            if 'error' in fallback:
                root_error = result.get('error') if isinstance(result, dict) else None
                return jsonify({
                    'status': 'error',
                    'error': fallback['error'] if not root_error else f"{root_error}. {fallback['error']}"
                }), 500
            result = fallback
            methodology = fallback.get('methodology') or 'hybrid_structured_similarity'
            methodology_summary = fallback.get('methodology_summary')

        return jsonify({
            'status': 'success',
            'comparison_matrix': result.get('comparison_matrix', []),
            'case_count': len(case_ids),
            'methodology': methodology,
            'methodology_summary': methodology_summary,
            'rag_available': bool(services.rag_system),
        }), 200
        
    except Exception as e:
        print(f"❌ Batch compare error: {str(e)}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


@llm_bp.route('/rag/explain', methods=['POST'])
@handle_errors
def explain_similarity():
    """
    FIXED ENDPOINT: Generate LLM explanation of why two cases are similar.
    
    This endpoint was previously at /rag/explain-similarity and was causing 404 errors.
    It now properly uses the case IDs to fetch summaries and generate explanations.
    
    Request body:
    {
        "case_id_1": "CASE123",
        "case_id_2": "CASE456", 
        "similarity_score": 0.87,
        "model": "gpt-4o-mini"  <-- Optional model override
    }
    """
    try:
        # Get parameters
        case_id_1 = request.json.get('case_id_1')
        case_id_2 = request.json.get('case_id_2')
        raw_score = request.json.get('similarity_score', 0.0)
        try:
            score = float(raw_score)
        except Exception:
            score = 0.0
        llm_service = _get_llm_service()
        model = _resolve_request_model(request.json, llm_service)
        
        # Validation
        if not case_id_1 or not case_id_2:
            return jsonify({
                'status': 'error',
                'error': 'Both case_id_1 and case_id_2 are required'
            }), 400
        
        if not llm_service or not llm_service.check_connection():
            return jsonify({
                'status': 'error',
                'explanation': 'AI service unavailable. No provider is ready.'
            }), 503
        
        # Check RAG system
        if not services.rag_system:
            return jsonify({
                'status': 'error',
                'explanation': 'Vector RAG system not initialized.'
            }), 500
        
        print(f"[LLM] Generating explanation for {case_id_1} vs {case_id_2} (score: {score:.2%}) using {model}")
        
        # Use the new explain_similarity method from VectorRAGSystem
        explanation = services.rag_system.explain_similarity(case_id_1, case_id_2, score, model=model)
        
        return jsonify({
            'status': 'success',
            'case_id_1': case_id_1,
            'case_id_2': case_id_2,
            'similarity_score': score,
            'explanation': explanation
        }), 200
        
    except AttributeError as e:
        # Handle case where explain_similarity method doesn't exist yet
        print(f"[RAG] Method not found: {str(e)}")
        return jsonify({
            'status': 'error',
            'explanation': 'Explanation feature not yet implemented in backend. Please update vector_rag.py with the explain_similarity method.'
        }), 501
        
    except Exception as e:
        print(f"[LLM] Explanation error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'explanation': f'Failed to generate explanation: {str(e)}'
        }), 500


@llm_bp.route('/rag/index-status', methods=['GET'])
@handle_errors
def index_status():
    """
    NEW ENDPOINT: Get current index status and metrics.
    Returns information about the vector index including size, dimensions, and build time.
    """
    try:
        if not services.rag_system:
            return jsonify({
                'index_loaded': False,
                'error': 'RAG system not initialized'
            }), 500
        
        status = services.rag_system.get_index_status()
        
        return jsonify({
            'status': 'success',
            **status
        }), 200
        
    except AttributeError:
        # Fallback if get_index_status doesn't exist
        return jsonify({
            'index_loaded': services.rag_system.index is not None if services.rag_system else False,
            'total_vectors': services.rag_system.index.ntotal if services.rag_system and services.rag_system.index else 0,
            'embedding_dim': services.rag_system.embedding_dim if services.rag_system else None,
            'note': 'Limited status information available. Update vector_rag.py for full metrics.'
        }), 200
        
    except Exception as e:
        print(f"[RAG] Index status error: {str(e)}")
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500


@llm_bp.route('/rag/health', methods=['GET'])
def rag_health_check():
    """
    NEW ENDPOINT: Health check for Vector RAG system.
    Returns system status and configuration information.
    """
    try:
        health = {
            'status': 'healthy',
            'service': 'vector-rag',
            'timestamp': datetime.now().isoformat()
        }
        
        llm_service = _get_llm_service()

        # Check RAG system
        if services.rag_system:
            health['rag_system'] = {
                'initialized': True,
                'index_loaded': services.rag_system.index is not None,
                'vector_count': services.rag_system.index.ntotal if services.rag_system.index else 0,
                'embedding_model': services.rag_system.embedding_model,
                'provider': getattr(llm_service, 'provider_name', 'local_ai'),
            }
        else:
            health['rag_system'] = {'initialized': False}
            health['status'] = 'degraded'
        
        if llm_service:
            health['llm_provider'] = {
                'provider': getattr(llm_service, 'provider_name', 'local_ai'),
                'available': llm_service.check_connection(),
                'base_url': getattr(llm_service, 'base_url', 'unknown'),
            }
        else:
            health['llm_provider'] = {'available': False}
            health['status'] = 'degraded'
        
        status_code = 200 if health['status'] == 'healthy' else 503
        
        return jsonify(health), status_code
        
    except Exception as e:
        print(f"[RAG] Health check error: {str(e)}")
        return jsonify({
            'status': 'unhealthy',
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 503


# ============================================================================
# LEGACY ENDPOINT (For backwards compatibility)
# ============================================================================

@llm_bp.route('/rag/explain-similarity', methods=['POST'])
@handle_errors
def explain_similarity_legacy():
    """
    LEGACY ENDPOINT: Redirects to the new /rag/explain endpoint.
    
    This endpoint is maintained for backwards compatibility but will map
    the old request format to the new one.
    """
    try:
        # Try to extract case IDs from the old format
        case_a_summary = request.json.get('source_summary', '')
        case_b_summary = request.json.get('match_summary', '')
        score = request.json.get('score', 0.0)
        
        # Try to extract case IDs from summaries if they're in the format "Case ID XXX..."
        case_id_1 = request.json.get('case_id_1')
        case_id_2 = request.json.get('case_id_2')
        
        if not case_id_1:
            # Try to parse from summary
            import re
            match = re.search(r'Case\s+(?:ID\s+)?(\w+)', case_a_summary)
            if match:
                case_id_1 = match.group(1)
        
        if not case_id_2:
            match = re.search(r'Case\s+(?:ID\s+)?(\w+)', case_b_summary)
            if match:
                case_id_2 = match.group(1)
        
        if not case_id_1 or not case_id_2:
            return jsonify({
                'explanation': 'Unable to extract case IDs from request. Please use the /rag/explain endpoint with case_id_1 and case_id_2 parameters.'
            }), 400
        
        # Forward to new endpoint
        print(f"[RAG] Using legacy endpoint. Please update to /rag/explain")
        
        explanation = services.rag_system.explain_similarity(case_id_1, case_id_2, score)
        
        return jsonify({
            'status': 'success',
            'explanation': explanation,
            'note': 'This endpoint is deprecated. Please use /rag/explain instead.'
        }), 200
        
    except Exception as e:
        print(f"[RAG] Legacy endpoint error: {str(e)}")
        return jsonify({
            'explanation': f'Could not generate explanation. Error: {str(e)}'
        }), 500


# ============================================================================
# UTILITY ENDPOINTS
# ============================================================================

@llm_bp.route('/rag/stats', methods=['GET'])
@handle_errors
def rag_statistics():
    """
    NEW ENDPOINT: Get usage statistics and performance metrics.
    """
    try:
        if not services.rag_system:
            return jsonify({'error': 'RAG system not initialized'}), 500
        
        stats = {
            'index_info': {
                'total_vectors': services.rag_system.index.ntotal if services.rag_system.index else 0,
                'embedding_dim': services.rag_system.embedding_dim,
                'index_type': 'FAISS-IP (Cosine Similarity)',
                'last_build': services.rag_system.last_build_time
            },
            'system_config': {
                'embedding_model': services.rag_system.embedding_model,
                'provider': getattr(_get_llm_service(), 'provider_name', 'local_ai'),
                'vector_store_path': services.rag_system.base_path
            }
        }
        
        # Add build metrics if available
        if hasattr(services.rag_system, 'build_metrics') and services.rag_system.build_metrics:
            stats['build_metrics'] = services.rag_system.build_metrics
        
        return jsonify(stats), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
# backend/api/routes/llm.py (ADD THESE ENDPOINTS)

from case_pack.case_summary_builder import CaseSummaryBuilder
from llm.explain_case import CaseExplainer
from llm.review_questions import ReviewQuestionsGenerator

# Initialize helpers (add to existing services initialization)
case_summary_builder = None
case_explainer = None
review_questions_gen = None

def init_case_helpers():
    """Initialize case pack AI helpers"""
    global case_summary_builder, case_explainer, review_questions_gen
    llm_service = _get_llm_service()
    
    if not case_summary_builder:
        case_summary_builder = CaseSummaryBuilder(services.investigation_db)
    
    if not case_explainer and llm_service:
        case_explainer = CaseExplainer(llm_service)
    
    if not review_questions_gen and llm_service:
        review_questions_gen = ReviewQuestionsGenerator(llm_service)


# ============================================================================
# NEW CASE ANALYSIS ENDPOINTS (Fixed Routes)
# ============================================================================

@llm_bp.route('/llm/explain-case', methods=['POST', 'OPTIONS'])  # ✅ ADDED /llm/ prefix
@handle_errors
def explain_case_endpoint():
    """
    Generate AI explanation for a case.
    Matches Frontend URL: /api/v2/llm/explain-case
    """
    if request.method == 'OPTIONS':
        return jsonify({'status': 'ok'}), 200

    init_case_helpers()
    
    case_id = request.json.get('case_id')
    llm_service = _get_llm_service()
    model = _resolve_request_model(request.json, llm_service)
    
    if not case_id:
        return jsonify({'error': 'case_id required'}), 400
    
    if not case_summary_builder or not case_explainer:
        return jsonify({'error': 'AI services not initialized'}), 503
    
    try:
        # Step 1: Build deterministic summary
        summary = case_summary_builder.build_case_summary(case_id)
        
        if "error" in summary:
            return jsonify({'success': False, 'error': summary['error']}), 500
        
        # Step 2: Generate explanation
        explanation = case_explainer.explain_case(summary, model=model)
        
        return jsonify({
            'success': True,
            'case_id': case_id,
            'explanation': explanation
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@llm_bp.route('/llm/review-questions', methods=['POST', 'OPTIONS']) # ✅ ADDED /llm/ prefix
@handle_errors
def review_questions_endpoint():
    """
    Generate review questions for a case.
    Matches Frontend URL: /api/v2/llm/review-questions
    """
    if request.method == 'OPTIONS':
        return jsonify({'status': 'ok'}), 200

    init_case_helpers()
    
    case_id = request.json.get('case_id')
    llm_service = _get_llm_service()
    model = _resolve_request_model(request.json, llm_service)
    
    if not case_id:
        return jsonify({'error': 'case_id required'}), 400
    
    if not review_questions_gen:
        return jsonify({'error': 'AI services not initialized'}), 503
    
    try:
        # Step 1: Build deterministic summary
        summary = case_summary_builder.build_case_summary(case_id)
        
        if "error" in summary:
            return jsonify({'success': False, 'error': summary['error']}), 500
        
        # Step 2: Generate questions
        questions = review_questions_gen.generate_review_questions(summary, model=model)
        
        return jsonify({
            'success': True,
            'case_id': case_id,
            'questions': questions
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
