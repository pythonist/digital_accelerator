# backend/api/routes/mule_detection/__init__.py
"""
Complete Mule Detection Routes with Enhanced ML Integration
"""
from flask import Blueprint, request, jsonify
import pandas as pd
import numpy as np
import os
import traceback
import json
import uuid
from datetime import datetime
from threading import Thread
from typing import Dict, Optional

# Import engines
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))
from services.mule_detection.feature_engine import MuleFeatureEngine
from services.mule_detection.pattern_engine import MulePatternEngine
from services.mule_detection.flow_engine import MuleFlowEngine
from services.mule_detection.ml_engine import MuleMLEngine

mule_bp = Blueprint('mule', __name__)

# Initialize engines
feature_engine = MuleFeatureEngine()
pattern_engine = MulePatternEngine()
flow_engine = MuleFlowEngine()
ml_engine = MuleMLEngine()

# In-memory stores (replace with Redis in production)
training_jobs = {}
model_registry = {}

# Numpy type converter for JSON serialization
def convert_numpy_types(obj):
    if isinstance(obj, np.generic):
        return obj.item()
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {key: convert_numpy_types(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_types(item) for item in obj]
    return obj


def get_mule_dir(env_id):
    """Get mule detection directory for environment"""
    return f"data/environments/{env_id}/mule_detection"

def get_models_dir(env_id):
    """Get models directory"""
    models_dir = os.path.join(get_mule_dir(env_id), "ml_models")
    os.makedirs(models_dir, exist_ok=True)
    return models_dir

def get_model_registry_path(env_id: str) -> str:
    return os.path.join(get_models_dir(env_id), "model_registry.json")

def load_model_registry(env_id: str) -> Dict:
    registry_path = get_model_registry_path(env_id)
    if not os.path.exists(registry_path):
        return {}
    try:
        with open(registry_path, 'r') as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception:
        return {}
    return {}

def save_model_registry(env_id: str, registry: Dict) -> None:
    registry_path = get_model_registry_path(env_id)
    with open(registry_path, 'w') as f:
        json.dump(convert_numpy_types(registry), f, indent=2)

def get_active_model_info(registry: Dict) -> Optional[Dict]:
    for _, info in (registry or {}).items():
        if info.get('status') == 'ACTIVE' or info.get('active') is True:
            return info
    return None

def risk_bucket(score: float) -> str:
    s = float(score or 0)
    if s >= 75:
        return 'CRITICAL'
    if s >= 50:
        return 'HIGH'
    if s >= 25:
        return 'MEDIUM'
    return 'LOW'

def load_transactions(env_id):
    """Load transaction data"""
    txn_path = os.path.join(get_mule_dir(env_id), "raw", "transactions.csv")
    return pd.read_csv(txn_path)

def load_accounts(env_id):
    """Load account metadata (optional)"""
    acc_path = os.path.join(get_mule_dir(env_id), "raw", "accounts.csv")
    if os.path.exists(acc_path):
        return pd.read_csv(acc_path)
    return None


# ==================== DECISION ENGINE ====================

class DecisionEngine:
    """Hybrid Decision Engine: Combines ML + Patterns"""
    
    def __init__(self):
        self.config = {
            'ml_weight': 0.6,
            'pattern_weight': 0.4,
            'confidence_threshold': 0.5,
        }
    
    def decide(self, ml_score: float, ml_confidence: float, 
               pattern_score: float, patterns: list) -> Dict:
        """Make final mule risk decision"""
        
        high_severity_patterns = [p for p in patterns if p.get('severity') == 'HIGH']
        pattern_override = len(high_severity_patterns) >= 2
        
        if pattern_override:
            final_score = max(pattern_score, 75)
            decision_logic = f"PATTERN OVERRIDE: {len(high_severity_patterns)} HIGH-severity patterns"
            ml_trusted = False
        elif ml_confidence < self.config['confidence_threshold'] * 100:
            final_score = pattern_score * 0.7 + ml_score * 0.3
            decision_logic = f"LOW ML CONFIDENCE ({ml_confidence:.1f}%)"
            ml_trusted = False
        else:
            ml_weight = self.config['ml_weight']
            pattern_weight = self.config['pattern_weight']
            final_score = (ml_score * ml_weight) + (pattern_score * pattern_weight)
            
            agreement = abs(ml_score - pattern_score) < 20
            if agreement and final_score > 50:
                final_score = min(final_score * 1.1, 100)
                decision_logic = "ML + PATTERNS ALIGNED"
            else:
                decision_logic = f"HYBRID: ML ({ml_weight*100:.0f}%) + Patterns ({pattern_weight*100:.0f}%)"
            
            ml_trusted = True
        
        risk_level = risk_bucket(final_score)
        
        return {
            'final_risk_score': float(final_score),
            'final_risk_level': risk_level,
            'decision_logic': decision_logic,
            'ml_trusted': ml_trusted,
            'pattern_override': pattern_override,
            'ml_contribution': ml_score,
            'pattern_contribution': pattern_score
        }
    
    def update_config(self, new_config: Dict):
        """Update decision engine configuration"""
        self.config.update(new_config)


decision_engine = DecisionEngine()


# ==================== ASYNC TRAINING ====================

def run_training_job(job_id: str, env_id: str, config: Dict):
    """Background training worker"""
    try:
        training_jobs[job_id]['status'] = 'RUNNING'
        training_jobs[job_id]['progress'] = 10
        
        transactions_df = load_transactions(env_id)
        accounts_df = load_accounts(env_id)
        
        if accounts_df is None or 'is_mule' not in accounts_df.columns:
            training_jobs[job_id]['status'] = 'FAILED'
            training_jobs[job_id]['error'] = "accounts.csv must include 'is_mule' column"
            return
        
        training_jobs[job_id]['status'] = 'RUNNING'
        training_jobs[job_id]['progress'] = 30
        
        dataset = []
        for _, account_row in accounts_df.iterrows():
            account_id = str(account_row['account_id'])
            account_meta = account_row.to_dict()
            
            features = feature_engine.compute_account_features(
                transactions_df, account_id, account_meta
            )
            
            features['is_mule'] = int(account_row['is_mule'])
            features['account_id'] = account_id
            dataset.append(features)
        
        dataset_df = pd.DataFrame(dataset)
        
        training_jobs[job_id]['status'] = 'RUNNING'
        training_jobs[job_id]['progress'] = 60
        
        metrics = ml_engine.train(dataset_df, validation_split=config.get('validation_split', 0.2))
        
        training_jobs[job_id]['progress'] = 90
        
        model_version = f"model_v{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        models_dir = get_models_dir(env_id)
        ml_engine.model_dir = models_dir
        model_path = ml_engine.save_model(version=model_version)
        
        model_info = {
            'model_version': model_version,
            'model_path': model_path,
            'trained_at': datetime.now().isoformat(),
            'algorithm': 'gradient_boosting',
            'training_samples': len(dataset_df),
            'feature_count': len(ml_engine.feature_names or []),
            'validation_split': config.get('validation_split', 0.2),
            'auc': float(metrics['val_auc']),
            'recall': float(metrics['val_recall']),
            'precision': float(metrics['val_precision']),
            'f1': float(metrics['val_f1']),
            'status': 'READY',
            'active': False,
            'metrics': {
                'val_auc': float(metrics['val_auc']),
                'recall': float(metrics['val_recall']),
                'precision': float(metrics['val_precision']),
                'f1': float(metrics['val_f1']),
                'optimal_threshold': float(metrics.get('optimal_threshold', 0))
            },
            'metrics_full': convert_numpy_types(metrics)
        }
        disk_registry = load_model_registry(env_id)
        for v in disk_registry:
            disk_registry[v]['status'] = 'READY'
            disk_registry[v]['active'] = False
        model_info['status'] = 'ACTIVE'
        model_info['active'] = True
        disk_registry[model_version] = model_info
        save_model_registry(env_id, disk_registry)
        model_registry[env_id] = disk_registry
        
        training_jobs[job_id]['status'] = 'COMPLETED'
        training_jobs[job_id]['progress'] = 100
        training_jobs[job_id]['result'] = model_info
        
    except Exception as e:
        training_jobs[job_id]['status'] = 'FAILED'
        training_jobs[job_id]['error'] = str(e)
        traceback.print_exc()


# ==================== DATA UPLOAD ====================
@mule_bp.route('/upload', methods=['POST'])
def upload_mule_data():
    """Upload transaction/account data"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'Environment ID required'}), 400
        
        if 'transactions' not in request.files:
            return jsonify({'error': 'transactions.csv required'}), 400
        
        txn_file = request.files['transactions']
        acc_file = request.files.get('accounts')
        
        mule_dir = get_mule_dir(env_id)
        raw_dir = os.path.join(mule_dir, "raw")
        os.makedirs(raw_dir, exist_ok=True)
        
        txn_path = os.path.join(raw_dir, "transactions.csv")
        txn_file.save(txn_path)
        
        if acc_file:
            acc_path = os.path.join(raw_dir, "accounts.csv")
            acc_file.save(acc_path)
        
        txn_df = pd.read_csv(txn_path)
        
        registry = {
            'status': 'ACTIVE',
            'txn_count': len(txn_df),
            'account_count': txn_df['account_id'].nunique()
        }
        
        registry_path = os.path.join(mule_dir, "dataset_registry.json")
        with open(registry_path, 'w') as f:
            json.dump(registry, f, indent=2)
        
        return jsonify({
            'success': True,
            'message': 'Data uploaded successfully',
            'stats': registry
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== DATA STATUS ====================
@mule_bp.route('/status', methods=['GET'])
def get_data_status():
    """Check data status"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'Environment ID required'}), 400
        
        registry_path = os.path.join(get_mule_dir(env_id), "dataset_registry.json")
        
        if not os.path.exists(registry_path):
            return jsonify({'has_data': False, 'message': 'No data uploaded'})
        
        with open(registry_path, 'r') as f:
            registry = json.load(f)
        disk_registry = load_model_registry(env_id)
        if disk_registry:
            model_registry[env_id] = disk_registry
        has_ml_model = bool(disk_registry)
        
        return jsonify({
            'has_data': True, 
            'stats': registry,
            'has_ml_model': has_ml_model
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== ACCOUNTS ====================
@mule_bp.route('/accounts', methods=['GET'])
def get_accounts():
    """Get account list with account-only risk scoring"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'Environment ID required'}), 400
        
        txn_path = os.path.join(get_mule_dir(env_id), "raw", "transactions.csv")
        if not os.path.exists(txn_path):
            return jsonify({'error': 'No data uploaded'}), 400
        
        transactions_df = pd.read_csv(txn_path)
        accounts_df = load_accounts(env_id)
        account_ids = [str(a) for a in transactions_df['account_id'].unique().tolist()]

        disk_registry = load_model_registry(env_id)
        if disk_registry:
            model_registry[env_id] = disk_registry
        active_model = get_active_model_info(disk_registry)
        if active_model:
            ml_engine.load_model(active_model['model_path'])

        accounts_out = []
        for account_id in account_ids:
            account_meta = None
            if accounts_df is not None:
                row = accounts_df[accounts_df['account_id'] == account_id]
                if len(row) > 0:
                    account_meta = row.iloc[0].to_dict()

            features = feature_engine.compute_account_features(transactions_df, account_id, account_meta)
            patterns = pattern_engine.detect_patterns(features)
            pattern_risk = pattern_engine.calculate_risk_score(patterns)

            ml_pred = None
            decision = None
            final_score = float(pattern_risk.get('risk_score', 0))
            if active_model:
                ml_pred = ml_engine.predict(features, account_meta)
                decision = decision_engine.decide(
                    ml_score=ml_pred['mule_risk_score'],
                    ml_confidence=ml_pred['confidence'],
                    pattern_score=pattern_risk['risk_score'],
                    patterns=patterns
                )
                final_score = float(decision.get('final_risk_score', final_score))

            accounts_out.append({
                'account_id': account_id,
                'total_credit': float(features.get('total_credit', 0) or 0),
                'total_debit': float(features.get('total_debit', 0) or 0),
                'pass_through_ratio': float(features.get('pass_through_ratio', 0) or 0),
                'risk_score': float(final_score),
                'risk_level': risk_bucket(final_score),
                'has_ml_model': bool(active_model)
            })

        return jsonify(convert_numpy_types({
            'success': True,
            'accounts': accounts_out,
            'total_accounts': len(accounts_out)
        }))
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== ACCOUNT DETAIL ====================
@mule_bp.route('/accounts/<account_id>', methods=['GET'])
def get_account_detail(account_id):
    """Get detailed account analysis"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        df = load_transactions(env_id)
        accounts_meta = load_accounts(env_id)
        
        meta = None
        if accounts_meta is not None:
            meta_row = accounts_meta[accounts_meta['account_id'] == account_id]
            if len(meta_row) > 0:
                meta = meta_row.iloc[0].to_dict()
        
        features = feature_engine.compute_account_features(df, account_id, meta)
        patterns = pattern_engine.detect_patterns(features)
        risk = pattern_engine.calculate_risk_score(patterns)
        risk['risk_level'] = risk_bucket(risk.get('risk_score', 0))
        timeline = flow_engine.build_flow_timeline(df, account_id)

        disk_registry = load_model_registry(env_id)
        if disk_registry:
            model_registry[env_id] = disk_registry
        active_model = get_active_model_info(disk_registry)
        ml_pred = None
        decision = None
        final_score = float(risk.get('risk_score', 0))
        if active_model:
            ml_engine.load_model(active_model['model_path'])
            ml_pred = ml_engine.predict(features, meta)
            decision = decision_engine.decide(
                ml_score=ml_pred['mule_risk_score'],
                ml_confidence=ml_pred['confidence'],
                pattern_score=risk['risk_score'],
                patterns=patterns
            )
            final_score = float(decision.get('final_risk_score', final_score))

        reasons = []
        if features.get('unique_receivers', 0) >= 15:
            reasons.append(f"High outward dispersion to {int(features.get('unique_receivers', 0))} accounts")
        if features.get('holding_time_avg', 0) and float(features.get('holding_time_avg')) < 6:
            reasons.append("Rapid credit-debit velocity")
        if features.get('pass_through_ratio', 0) and float(features.get('pass_through_ratio')) >= 0.85:
            reasons.append("High pass-through ratio")
        if not reasons and patterns:
            reasons.append(f"{len(patterns)} behavioral patterns detected")
        
        return jsonify({
            'success': True,
            'account_id': account_id,
            'features': features,
            'patterns': patterns,
            'risk': risk,
            'account_risk_score': final_score,
            'account_risk_bucket': risk_bucket(final_score),
            'ml_prediction': ml_pred,
            'decision': decision,
            'explainability': {
                'summary': f"Given current data + rules + ML, this ACCOUNT is {risk_bucket(final_score)} risk.",
                'reasons': reasons
            },
            'timeline': timeline,
            'metadata': meta
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== FLOW ANALYSIS ====================
@mule_bp.route('/accounts/<account_id>/flows', methods=['GET'])
def analyze_flows(account_id):
    """Analyze credit->debit flows"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        df = load_transactions(env_id)
        
        flows = flow_engine.detect_rapid_flows(df, account_id)
        
        return jsonify({
            'success': True,
            'account_id': account_id,
            'flows': flows,
            'total_flows': len(flows)
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== MONEY FLOW GRAPH ====================
@mule_bp.route('/accounts/<account_id>/graph', methods=['GET'])
def get_account_graph(account_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        df = load_transactions(env_id)

        counterparty_col = None
        for c in ['counterparty_account', 'counterparty', 'to_account', 'to_acct', 'receiver_account', 'beneficiary_account']:
            if c in df.columns:
                counterparty_col = c
                break

        ts_col = None
        for c in ['txn_timestamp', 'timestamp', 'txn_time', 'transaction_time', 'transaction_datetime']:
            if c in df.columns:
                ts_col = c
                break

        if counterparty_col is None or ts_col is None or 'direction' not in df.columns or 'amount' not in df.columns:
            return jsonify({
                'success': False,
                'error': 'transactions dataset missing required columns for graph',
                'required': ['direction', 'amount', 'txn_timestamp', 'counterparty_account']
            }), 200

        window_hours = float(request.args.get('window_hours', 48))
        max_hops = int(request.args.get('max_hops', 4))
        amount_tolerance = float(request.args.get('amount_tolerance', 0.12))
        max_edges = int(request.args.get('max_edges', 250))

        df = df.copy()
        df[ts_col] = pd.to_datetime(df[ts_col], errors='coerce')
        df = df.dropna(subset=[ts_col])

        txns = []
        for _, r in df.iterrows():
            acc = str(r.get('account_id'))
            cp = r.get(counterparty_col)
            if cp is None or (isinstance(cp, float) and np.isnan(cp)):
                continue
            cp = str(cp)
            direction = str(r.get('direction') or '').lower()
            amt = r.get('amount')
            try:
                amt = float(amt)
            except Exception:
                continue
            ts = r.get(ts_col)
            if pd.isna(ts):
                continue

            if direction == 'debit':
                src, dst = acc, cp
            elif direction == 'credit':
                src, dst = cp, acc
            else:
                src, dst = acc, cp

            if not src or not dst:
                continue

            txns.append({'src': src, 'dst': dst, 'amount': amt, 'ts': ts})

        txns.sort(key=lambda x: x['ts'])

        def within_tol(a, b):
            denom = max(abs(b), 1.0)
            return abs(a - b) / denom <= amount_tolerance

        adj = {}
        for i, t in enumerate(txns):
            adj.setdefault(t['src'], []).append(i)

        def detect_cycles(start: str):
            cycles = []
            if start not in adj:
                return cycles

            for idx0 in adj.get(start, []):
                t0 = txns[idx0]
                base_amount = float(t0['amount'])
                start_ts = t0['ts']
                stack = [([idx0], [start, t0['dst']])]

                while stack:
                    path_idx, nodes = stack.pop()
                    last_idx = path_idx[-1]
                    last_t = txns[last_idx]
                    if len(path_idx) >= 3 and nodes[-1] == start:
                        cycles.append({
                            'path': nodes,
                            'hops': len(path_idx),
                            'start_time': start_ts.isoformat(),
                            'end_time': last_t['ts'].isoformat(),
                            'amount': base_amount
                        })
                        continue

                    if len(path_idx) >= max_hops:
                        continue

                    next_src = nodes[-1]
                    for nxt_idx in adj.get(next_src, []):
                        if nxt_idx in path_idx:
                            continue
                        nxt = txns[nxt_idx]
                        if nxt['ts'] < last_t['ts']:
                            continue
                        dt_hours = (nxt['ts'] - start_ts).total_seconds() / 3600.0
                        if dt_hours > window_hours:
                            continue
                        if not within_tol(float(nxt['amount']), base_amount):
                            continue
                        stack.append((path_idx + [nxt_idx], nodes + [nxt['dst']]))

            uniq = []
            seen = set()
            for c in cycles:
                key = tuple(c['path'])
                if key in seen:
                    continue
                seen.add(key)
                uniq.append(c)
            return uniq[:5]

        def detect_near_cycles(start: str):
            candidates = []
            if start not in adj:
                return candidates

            for idx0 in adj.get(start, []):
                t0 = txns[idx0]
                base_amount = float(t0['amount'])
                start_ts = t0['ts']
                stack = [([idx0], [start, t0['dst']])]

                while stack:
                    path_idx, nodes = stack.pop()
                    if len(path_idx) >= max_hops:
                        continue
                    last_idx = path_idx[-1]
                    last_t = txns[last_idx]
                    next_src = nodes[-1]
                    for nxt_idx in adj.get(next_src, []):
                        if nxt_idx in path_idx:
                            continue
                        nxt = txns[nxt_idx]
                        if nxt['ts'] < last_t['ts']:
                            continue
                        dt_hours = (nxt['ts'] - start_ts).total_seconds() / 3600.0
                        if dt_hours > window_hours * 2:
                            continue
                        ok_amt = within_tol(float(nxt['amount']), base_amount)
                        new_nodes = nodes + [nxt['dst']]
                        new_path = path_idx + [nxt_idx]

                        if len(new_path) >= 3 and new_nodes[-1] != start:
                            back_edges = adj.get(new_nodes[-1], [])
                            has_back = any(txns[b]['dst'] == start for b in back_edges)
                            if has_back:
                                candidates.append({
                                    'path': new_nodes,
                                    'hops': len(new_path),
                                    'start_time': start_ts.isoformat(),
                                    'end_time': nxt['ts'].isoformat(),
                                    'amount': base_amount,
                                    'reason': 'Near-cycle: final hop exists but constraints may differ' if ok_amt else 'Near-cycle: similar path but amount tolerance fails'
                                })

                        stack.append((new_path, new_nodes))

            uniq = []
            seen = set()
            for c in candidates:
                key = tuple(c['path'])
                if key in seen:
                    continue
                seen.add(key)
                uniq.append(c)
            uniq.sort(key=lambda x: (x['hops'], x['start_time']))
            return uniq[:5]

        cycles = detect_cycles(str(account_id))
        near_cycles = [] if cycles else detect_near_cycles(str(account_id))

        neighborhood = set([str(account_id)])
        for t in txns:
            if t['src'] == str(account_id) or t['dst'] == str(account_id):
                neighborhood.add(t['src'])
                neighborhood.add(t['dst'])

        edge_map = {}
        for t in txns:
            if t['src'] in neighborhood and t['dst'] in neighborhood:
                k = (t['src'], t['dst'])
                cur = edge_map.get(k)
                if not cur:
                    edge_map[k] = {
                        'source': t['src'],
                        'target': t['dst'],
                        'txn_count': 1,
                        'total_amount': float(t['amount']),
                        'first_ts': t['ts'],
                        'last_ts': t['ts']
                    }
                else:
                    cur['txn_count'] += 1
                    cur['total_amount'] += float(t['amount'])
                    if t['ts'] < cur['first_ts']:
                        cur['first_ts'] = t['ts']
                    if t['ts'] > cur['last_ts']:
                        cur['last_ts'] = t['ts']

        edges = list(edge_map.values())
        edges.sort(key=lambda e: e['total_amount'], reverse=True)
        edges = edges[:max_edges]

        nodes = sorted(set([n for e in edges for n in (e['source'], e['target'])]))
        nodes_out = [{'id': n, 'label': n, 'type': 'account' if n == str(account_id) else 'counterparty'} for n in nodes]
        edges_out = [{
            'source': e['source'],
            'target': e['target'],
            'txn_count': int(e['txn_count']),
            'total_amount': float(e['total_amount']),
            'first_ts': e['first_ts'].isoformat(),
            'last_ts': e['last_ts'].isoformat()
        } for e in edges]

        return jsonify(convert_numpy_types({
            'success': True,
            'account_id': str(account_id),
            'graph': {
                'nodes': nodes_out,
                'edges': edges_out
            },
            'circular': {
                'cycles': cycles,
                'near_cycles': near_cycles,
                'parameters': {
                    'window_hours': window_hours,
                    'max_hops': max_hops,
                    'amount_tolerance': amount_tolerance
                }
            }
        }))
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== PATTERN DETECTION ====================
@mule_bp.route('/patterns', methods=['GET'])
def detect_patterns():
    """Detect patterns across all accounts"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        df = load_transactions(env_id)
        accounts_meta = load_accounts(env_id)
        
        all_patterns = {}
        pattern_summary = []
        
        for account_id in df['account_id'].unique():
            meta = None
            if accounts_meta is not None:
                meta_row = accounts_meta[accounts_meta['account_id'] == account_id]
                if len(meta_row) > 0:
                    meta = meta_row.iloc[0].to_dict()
            
            features = feature_engine.compute_account_features(df, str(account_id), meta)
            patterns = pattern_engine.detect_patterns(features)
            
            if patterns:
                all_patterns[str(account_id)] = patterns
                
                for pattern in patterns:
                    pattern_summary.append({
                        'account_id': str(account_id),
                        **pattern
                    })
        
        overlap = pattern_engine.get_pattern_overlap(all_patterns)
        
        return jsonify({
            'success': True,
            'patterns': pattern_summary,
            'total_flagged': len(all_patterns),
            'pattern_overlap': overlap
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== INTROSPECTION ====================
@mule_bp.route('/introspect', methods=['GET'])
def introspect_dataset():
    """Analyze dataset characteristics"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        df = load_transactions(env_id)
        
        df['txn_timestamp'] = pd.to_datetime(df['txn_timestamp'])
        
        introspection = {
            'total_transactions': len(df),
            'total_accounts': df['account_id'].nunique(),
            'date_range': {
                'start': df['txn_timestamp'].min().isoformat(),
                'end': df['txn_timestamp'].max().isoformat(),
                'days': (df['txn_timestamp'].max() - df['txn_timestamp'].min()).days
            },
            'columns': list(df.columns),
            'credit_debit_split': {
                'credit_count': len(df[df['direction'] == 'credit']),
                'debit_count': len(df[df['direction'] == 'debit']),
                'credit_amount': float(df[df['direction'] == 'credit']['amount'].sum()),
                'debit_amount': float(df[df['direction'] == 'debit']['amount'].sum())
            },
            'channel_distribution': df['channel'].value_counts().to_dict() if 'channel' in df.columns else {},
            'missing_data': {
                col: int(df[col].isna().sum()) 
                for col in df.columns
            }
        }
        
        return jsonify({
            'success': True,
            'introspection': introspection
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==================== ML TRAINING (ASYNC) ====================
@mule_bp.route('/ml/train', methods=['POST'])
def train_ml_model_async():
    """Start ML training job"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'Environment ID required'}), 400
        
        config = request.get_json() or {}
        
        job_id = "local_sync_completed"
        training_jobs[job_id] = {
            'job_id': job_id,
            'env_id': env_id,
            'status': 'QUEUED',
            'progress': 0,
            'created_at': datetime.now().isoformat()
        }
        run_training_job(job_id, env_id, config)
        
        return jsonify({
            'success': True,
            'job_id': job_id,
            'message': 'Training completed'
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@mule_bp.route('/ml/train/<job_id>/status', methods=['GET'])
def get_training_status(job_id):
    """Get training job status"""
    try:
        if job_id not in training_jobs:
            env_id = request.headers.get('X-Environment-ID')
            if job_id == 'local_sync_completed' and env_id:
                disk_registry = load_model_registry(env_id)
                active_model = get_active_model_info(disk_registry)
                if active_model:
                    return jsonify({
                        'success': True,
                        'job_id': job_id,
                        'status': 'COMPLETED',
                        'progress': 100,
                        'created_at': active_model.get('trained_at'),
                        'error': None
                    })
                return jsonify({
                    'success': True,
                    'job_id': job_id,
                    'status': 'FAILED',
                    'progress': 0,
                    'created_at': None,
                    'error': 'No model available'
                })
            return jsonify({'error': 'Job not found'}), 404
        
        job = training_jobs[job_id]
        
        return jsonify({
            'success': True,
            'job_id': job_id,
            'status': job['status'],
            'progress': job['progress'],
            'created_at': job['created_at'],
            'error': job.get('error')
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@mule_bp.route('/ml/train/<job_id>/result', methods=['GET'])
def get_training_result(job_id):
    """Get training job result"""
    try:
        if job_id not in training_jobs:
            env_id = request.headers.get('X-Environment-ID')
            if job_id == 'local_sync_completed' and env_id:
                disk_registry = load_model_registry(env_id)
                active_model = get_active_model_info(disk_registry)
                if active_model:
                    return jsonify({
                        'success': True,
                        'job_id': job_id,
                        'result': active_model
                    })
                return jsonify({'error': 'Job not found'}), 404
            return jsonify({'error': 'Job not found'}), 404
        
        job = training_jobs[job_id]
        
        if job['status'] != 'COMPLETED':
            return jsonify({
                'error': 'Training not completed',
                'status': job['status']
            }), 400
        
        return jsonify({
            'success': True,
            'job_id': job_id,
            'result': job['result']
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== MODEL MANAGEMENT ====================
@mule_bp.route('/ml/models', methods=['GET'])
def list_models():
    """List all trained models"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'Environment ID required'}), 400
        disk_registry = load_model_registry(env_id)
        model_registry[env_id] = disk_registry
        models_list = list((disk_registry or {}).values())
        models_list.sort(key=lambda x: x.get('trained_at') or '', reverse=True)
        
        return jsonify({
            'success': True,
            'models': models_list,
            'total': len(models_list)
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@mule_bp.route('/ml/models/activate', methods=['POST'])
def activate_model():
    """Activate a specific model version"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'Environment ID required'}), 400
        
        data = request.get_json()
        model_version = data.get('model_version')
        
        if not model_version:
            return jsonify({'error': 'model_version required'}), 400

        disk_registry = load_model_registry(env_id)
        if model_version not in disk_registry:
            return jsonify({'error': 'Model not found'}), 404
        
        for version in disk_registry:
            disk_registry[version]['status'] = 'READY'
            disk_registry[version]['active'] = False
        disk_registry[model_version]['status'] = 'ACTIVE'
        disk_registry[model_version]['active'] = True
        save_model_registry(env_id, disk_registry)
        model_registry[env_id] = disk_registry
        
        return jsonify({
            'success': True,
            'message': f'Model {model_version} activated',
            'active_model': disk_registry[model_version]
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@mule_bp.route('/ml/models/<model_version>', methods=['GET'])
def get_model_details(model_version):
    """Get detailed info for specific model"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'Environment ID required'}), 400
        disk_registry = load_model_registry(env_id)
        model_registry[env_id] = disk_registry
        if model_version not in disk_registry:
            return jsonify({'error': 'Model not found'}), 404
        model_info = disk_registry[model_version]
        
        return jsonify({
            'success': True,
            'model': model_info
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== ML PREDICTION ====================
@mule_bp.route('/ml/predict/<account_id>', methods=['GET'])
def predict_ml_score(account_id):
    """Get ML + hybrid risk score"""
    try:
        env_id = request.headers.get('X-Environment-ID')

        disk_registry = load_model_registry(env_id)
        if disk_registry:
            model_registry[env_id] = disk_registry
        active_model = get_active_model_info(disk_registry)
        if not active_model:
            return jsonify({
                'success': False,
                'has_model': False,
                'message': 'No active ML model. Train a model to enable ML predictions.'
            }), 200
        
        ml_engine.load_model(active_model['model_path'])
        
        transactions_df = load_transactions(env_id)
        accounts_df = load_accounts(env_id)
        
        account_meta = None
        if accounts_df is not None:
            account_row = accounts_df[accounts_df['account_id'] == account_id]
            if len(account_row) > 0:
                account_meta = account_row.iloc[0].to_dict()
        
        feature_dict = feature_engine.compute_account_features(
            transactions_df, account_id, account_meta
        )
        
        ml_prediction = ml_engine.predict(feature_dict, account_meta)
        patterns = pattern_engine.detect_patterns(feature_dict)
        pattern_risk = pattern_engine.calculate_risk_score(patterns)
        
        decision = decision_engine.decide(
            ml_score=ml_prediction['mule_risk_score'],
            ml_confidence=ml_prediction['confidence'],
            pattern_score=pattern_risk['risk_score'],
            patterns=patterns
        )
        hybrid_risk_score = float(decision.get('final_risk_score', 0))
        final_risk_level = decision.get('final_risk_level')
        agreement = abs(float(ml_prediction.get('mule_risk_score', 0)) - float(pattern_risk.get('risk_score', 0))) < 20
        primary_signal = 'ML' if float(ml_prediction.get('mule_risk_score', 0)) >= float(pattern_risk.get('risk_score', 0)) else 'PATTERN'

        response = {
            'success': True,
            'account_id': account_id,
            'has_model': True,
            'hybrid_risk_score': hybrid_risk_score,
            'final_risk_level': final_risk_level,
            'agreement': agreement,
            'explanation': {
                'primary_signal': primary_signal,
                'ml_confidence': float(ml_prediction.get('confidence', 0)),
                'pattern_count': len(patterns),
                'high_severity_patterns': len([p for p in patterns if p.get('severity') == 'HIGH'])
            },
            'decision': decision,
            'ml_prediction': ml_prediction,
            'pattern_risk': pattern_risk,
            'patterns': patterns
        }
        return jsonify(convert_numpy_types(response))
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== DECISION ENGINE CONFIG ====================
@mule_bp.route('/ml/decision-engine/config', methods=['GET', 'POST'])
def decision_engine_config():
    """Get or update decision engine configuration"""
    try:
        if request.method == 'GET':
            return jsonify({
                'success': True,
                'config': decision_engine.config
            })
        
        elif request.method == 'POST':
            new_config = request.get_json()
            decision_engine.update_config(new_config)
            
            return jsonify({
                'success': True,
                'message': 'Configuration updated',
                'config': decision_engine.config
            })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@mule_bp.route('/ml/decision-engine/simulate', methods=['POST'])
def simulate_decision_engine():
    """Simulate decision engine with test inputs"""
    try:
        data = request.get_json()
        
        ml_score = data.get('ml_score', 50)
        ml_confidence = data.get('ml_confidence', 80)
        pattern_score = data.get('pattern_score', 60)
        patterns = data.get('patterns', [])
        
        decision = decision_engine.decide(
            ml_score=ml_score,
            ml_confidence=ml_confidence,
            pattern_score=pattern_score,
            patterns=patterns
        )
        
        return jsonify({
            'success': True,
            'decision': decision,
            'inputs': {
                'ml_score': ml_score,
                'ml_confidence': ml_confidence,
                'pattern_score': pattern_score,
                'pattern_count': len(patterns)
            }
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ==================== BATCH PREDICTION ====================
@mule_bp.route('/ml/batch-predict', methods=['POST'])
def batch_predict():
    """Batch ML scoring for all accounts"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        disk_registry = load_model_registry(env_id)
        if disk_registry:
            model_registry[env_id] = disk_registry
        active_model = get_active_model_info(disk_registry)
        if active_model:
            ml_engine.load_model(active_model['model_path'])
        
        transactions_df = load_transactions(env_id)
        accounts_df = load_accounts(env_id)
        
        all_predictions = []
        
        for account_id in transactions_df['account_id'].unique():
            account_meta = None
            if accounts_df is not None:
                account_row = accounts_df[accounts_df['account_id'] == account_id]
                if len(account_row) > 0:
                    account_meta = account_row.iloc[0].to_dict()
            
            feature_dict = feature_engine.compute_account_features(
                transactions_df, str(account_id), account_meta
            )
            
            patterns = pattern_engine.detect_patterns(feature_dict)
            pattern_risk = pattern_engine.calculate_risk_score(patterns)
            ml_pred = None
            decision = None
            final_score = float(pattern_risk.get('risk_score', 0))
            if active_model:
                ml_pred = ml_engine.predict(feature_dict, account_meta)
                decision = decision_engine.decide(
                    ml_score=ml_pred['mule_risk_score'],
                    ml_confidence=ml_pred['confidence'],
                    pattern_score=pattern_risk['risk_score'],
                    patterns=patterns
                )
                final_score = float(decision.get('final_risk_score', final_score))
            
            all_predictions.append({
                'account_id': str(account_id),
                'final_risk_score': float(final_score),
                'final_risk_level': risk_bucket(final_score),
                'ml_risk_score': float(ml_pred['mule_risk_score']) if ml_pred else None,
                'pattern_risk_score': pattern_risk['risk_score'],
                'confidence': ml_pred['confidence'] if ml_pred else None,
                'decision_logic': decision['decision_logic'] if decision else 'PATTERN ONLY',
                'has_model': bool(active_model)
            })
        
        risk_distribution = {
            'CRITICAL': sum(1 for p in all_predictions if p['final_risk_level'] == 'CRITICAL'),
            'HIGH': sum(1 for p in all_predictions if p['final_risk_level'] == 'HIGH'),
            'MEDIUM': sum(1 for p in all_predictions if p['final_risk_level'] == 'MEDIUM'),
            'LOW': sum(1 for p in all_predictions if p['final_risk_level'] == 'LOW')
        }
        
        response = {
            'success': True,
            'total_accounts': len(all_predictions),
            'risk_distribution': risk_distribution,
            'predictions': all_predictions
        }
        return jsonify(convert_numpy_types(response))
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

print("✓ Mule detection routes with enhanced ML loaded successfully")
