# backend/api/routes/mule_detection/__init__.py
"""
Complete Mule Detection Routes with Enhanced ML Integration
"""
from flask import Blueprint, request, jsonify
from core.optional_imports import safe_import
pd, _PANDAS_OK = safe_import("pandas")
np, _NUMPY_OK = safe_import("numpy")
import os
import traceback
import json
import hashlib
import uuid
from datetime import datetime
from threading import Thread
from typing import Dict, Optional

# Import engines
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))
duckdb, _DUCKDB_OK = safe_import("duckdb")
try:
    from services.mule_detection.feature_engine import MuleFeatureEngine
    from services.mule_detection.pattern_engine import MulePatternEngine
    from services.mule_detection.flow_engine import MuleFlowEngine
    from services.mule_detection.ml_engine import MuleMLEngine
    from services.mule_detection.money_flow import MoneyFlowAnalyzer, MoneyFlowConfig
    from services.mule_detection.flow_graph_workbench import MoneyFlowGraphWorkbench, FlowWorkbenchConfig
    from services.mule_detection.db_service import get_md_db_service
    _MULE_SERVICES_OK = True
    _MULE_IMPORT_ERROR = None
except Exception as e:
    _MULE_SERVICES_OK = False
    _MULE_IMPORT_ERROR = repr(e)

_MULE_AVAILABLE = all([_PANDAS_OK, _NUMPY_OK, _DUCKDB_OK, _MULE_SERVICES_OK])
mule_bp = Blueprint('mule', __name__)


@mule_bp.before_request
def _mule_guard():
    if not _MULE_AVAILABLE:
        return jsonify({
            "error": "Mule detection module not available",
            "available": False,
            "missing": {
                "pandas": _PANDAS_OK,
                "numpy": _NUMPY_OK,
                "duckdb": _DUCKDB_OK,
                "services": _MULE_SERVICES_OK,
            },
            "details": _MULE_IMPORT_ERROR,
        }), 503

# Initialize engines
if _MULE_AVAILABLE:
    feature_engine = MuleFeatureEngine()
    pattern_engine = MulePatternEngine()
    flow_engine = MuleFlowEngine()
    ml_engine = MuleMLEngine()
    md_db = get_md_db_service()
else:
    feature_engine = None
    pattern_engine = None
    flow_engine = None
    ml_engine = None
    md_db = None

# In-memory stores (replace with Redis in production)
training_jobs = {}
model_registry = {}

# Numpy type converter for JSON serialization
def convert_numpy_types(obj):
    if _NUMPY_OK and isinstance(obj, np.generic):
        return obj.item()
    elif _NUMPY_OK and isinstance(obj, np.ndarray):
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
    paths = md_db.init_env_structure(env_id)
    conn = duckdb.connect(str(paths["duckdb"]))
    try:
        df = conn.execute("SELECT * FROM mule_transactions WHERE environment_id = ?", [env_id]).df()
        if len(df) > 0:
            return df
    finally:
        conn.close()
    txn_path = os.path.join(get_mule_dir(env_id), "raw", "transactions.csv")
    return pd.read_csv(txn_path)

def load_accounts(env_id):
    """Load account metadata (optional)"""
    paths = md_db.init_env_structure(env_id)
    conn = duckdb.connect(str(paths["duckdb"]))
    try:
        df = conn.execute("SELECT * FROM mule_accounts WHERE environment_id = ?", [env_id]).df()
        if len(df) > 0:
            return df
    finally:
        conn.close()
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
        
        paths = md_db.init_env_structure(env_id)
        conn = duckdb.connect(str(paths["duckdb"]))
        try:
            conn.execute("UPDATE mule_models SET active = FALSE WHERE environment_id = ?", [env_id])
            conn.execute(
                """
                INSERT INTO mule_models
                VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)
                """,
                [
                    model_version,
                    model_path,
                    model_info['algorithm'],
                    int(model_info['training_samples']),
                    int(model_info['feature_count']),
                    float(model_info['auc']),
                    float(model_info['recall']),
                    float(model_info['precision']),
                    float(model_info['f1']),
                    env_id
                ]
            )
        finally:
            conn.close()
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
        if not _MULE_AVAILABLE:
            return jsonify({'error': 'Mule services unavailable', 'details': _MULE_IMPORT_ERROR}), 503
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'Environment ID required'}), 400
        
        if 'transactions' not in request.files:
            return jsonify({'error': 'transactions.csv required'}), 400
        
        txn_file = request.files['transactions']
        acc_file = request.files.get('accounts')

        transactions_required = [
            'txn_id',
            'account_id',
            'txn_timestamp',
            'amount',
            'direction',
            'counterparty_account',
            'counterparty_bank',
            'channel',
            'txn_type',
            'is_suspicious',
            'mule_pattern',
            'hour',
            'day_of_week',
            'is_weekend',
            'is_night',
            'device_id',
            'ip_address',
            'geo_location',
            'balance_after',
        ]
        accounts_required = [
            'account_id',
            'customer_id',
            'account_open_date',
            'customer_type',
            'risk_rating',
            'occupation',
            'expected_turnover',
            'is_mule',
        ]

        def _read_csv(file_obj):
            try:
                return pd.read_csv(file_obj, encoding="utf-8-sig")
            except Exception:
                return pd.read_csv(file_obj, encoding="latin-1")

        def _checksum(file_obj):
            if file_obj is None:
                return None
            try:
                file_obj.stream.seek(0)
                data = file_obj.stream.read()
                file_obj.stream.seek(0)
            except Exception:
                data = file_obj.read()
                file_obj.seek(0)
            return hashlib.md5(data or b"").hexdigest()

        checksum_txn = _checksum(txn_file)
        checksum_acc = _checksum(acc_file) if acc_file is not None else None

        txn_df = _read_csv(txn_file)
        acc_df = _read_csv(acc_file) if acc_file is not None else None

        txn_cols = [c.strip().lower() for c in txn_df.columns.tolist()]
        txn_df.columns = txn_cols
        if acc_df is not None:
            acc_cols = [c.strip().lower() for c in acc_df.columns.tolist()]
            acc_df.columns = acc_cols

        missing_txn = [c for c in transactions_required if c not in txn_df.columns]
        missing_acc = [c for c in accounts_required if acc_df is not None and c not in acc_df.columns]

        if missing_txn or missing_acc:
            return jsonify({
                'error': 'Invalid CSV schema',
                'missing': {
                    'transactions': missing_txn,
                    'accounts': missing_acc
                },
            }), 400

        txn_df = txn_df[transactions_required].copy()
        if acc_df is None:
            account_ids = txn_df['account_id'].dropna().astype(str).unique().tolist()
            acc_df = pd.DataFrame({
                'account_id': account_ids,
                'customer_id': None,
                'account_open_date': None,
                'customer_type': None,
                'risk_rating': None,
                'occupation': None,
                'expected_turnover': None,
                'is_mule': None,
            })
        acc_df = acc_df[accounts_required].copy()

        txn_df['txn_timestamp'] = pd.to_datetime(txn_df['txn_timestamp'], errors='coerce')
        acc_df['account_open_date'] = pd.to_datetime(acc_df['account_open_date'], errors='coerce')

        def _to_bool_series(s: pd.Series) -> pd.Series:
            if s.dtype == bool:
                return s
            return s.map(lambda x: True if str(x).strip().lower() in ['1', 'true', 't', 'yes', 'y'] else False if str(x).strip().lower() in ['0', 'false', 'f', 'no', 'n'] else None)

        txn_df['is_suspicious'] = _to_bool_series(txn_df['is_suspicious'])
        txn_df['is_weekend'] = _to_bool_series(txn_df['is_weekend'])
        txn_df['is_night'] = _to_bool_series(txn_df['is_night'])
        acc_df['is_mule'] = _to_bool_series(acc_df['is_mule'])

        invalid_ts = int(txn_df['txn_timestamp'].isna().sum())
        if invalid_ts > 0:
            return jsonify({'error': f'Invalid txn_timestamp values: {invalid_ts} rows could not be parsed'}), 400

        txn_df['environment_id'] = env_id
        acc_df['environment_id'] = env_id

        paths = md_db.init_env_structure(env_id)
        conn = duckdb.connect(str(paths["duckdb"]))
        try:
            conn.execute("DELETE FROM mule_transactions_raw WHERE environment_id = ?", [env_id])
            conn.execute("DELETE FROM mule_accounts_raw WHERE environment_id = ?", [env_id])

            conn.register("tx", txn_df)
            conn.execute("""
                INSERT INTO mule_transactions_raw
                SELECT txn_id, account_id, txn_timestamp, amount, direction, counterparty_account, counterparty_bank,
                       channel, txn_type, is_suspicious, mule_pattern, hour, day_of_week, is_weekend, is_night,
                       device_id, ip_address, geo_location, balance_after, environment_id, CURRENT_TIMESTAMP
                FROM tx
            """)

            conn.register("acc", acc_df)
            conn.execute("""
                INSERT INTO mule_accounts_raw
                SELECT account_id, customer_id, account_open_date, customer_type, risk_rating, occupation,
                       expected_turnover, is_mule, environment_id, CURRENT_TIMESTAMP
                FROM acc
            """)

            upload_id = str(uuid.uuid4())
            dataset_version = f"{env_id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{(checksum_txn or 'na')[:8]}"
            uploader = request.headers.get("X-User") or request.headers.get("X-Username") or request.headers.get("X-User-Id") or "unknown"
            source_ip = request.headers.get("X-Forwarded-For") or request.remote_addr
            txn_schema_json = json.dumps({c: str(txn_df[c].dtype) for c in transactions_required}, indent=2)
            acc_schema_json = json.dumps({c: str(acc_df[c].dtype) for c in accounts_required}, indent=2)
            conn.execute(
                """
                INSERT INTO mule_uploads (
                    upload_id, environment_id, uploaded_at,
                    txn_file_name, accounts_file_name, txn_row_count, accounts_row_count,
                    txn_schema_json, accounts_schema_json,
                    dataset_version, uploader, source_ip, checksum_txn, checksum_acc
                )
                VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    upload_id,
                    env_id,
                    getattr(txn_file, "filename", "transactions.csv"),
                    getattr(acc_file, "filename", "accounts.csv") if acc_file is not None else None,
                    int(len(txn_df)),
                    int(len(acc_df)),
                    txn_schema_json,
                    acc_schema_json,
                    dataset_version,
                    uploader,
                    source_ip,
                    checksum_txn,
                    checksum_acc,
                ],
            )
        finally:
            conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Data uploaded successfully',
            'stats': {
                'txn_count': int(len(txn_df)),
                'account_count': int(acc_df['account_id'].nunique())
            }
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
        
        paths = md_db.init_env_structure(env_id)
        conn = duckdb.connect(str(paths["duckdb"]))
        try:
            txn_count = int(conn.execute("SELECT COUNT(*) FROM mule_transactions_raw WHERE environment_id = ?", [env_id]).fetchone()[0])
            acc_count = int(conn.execute("SELECT COUNT(*) FROM mule_accounts_raw WHERE environment_id = ?", [env_id]).fetchone()[0])
            if txn_count == 0 or acc_count == 0:
                return jsonify({'has_data': False, 'message': 'No data available'})
            registry = {'status': 'ACTIVE', 'txn_count': txn_count, 'account_count': acc_count}
        finally:
            conn.close()
        conn = duckdb.connect(str(paths["duckdb"]))
        try:
            has_ml_model = int(conn.execute("SELECT COUNT(*) FROM mule_models WHERE environment_id = ?", [env_id]).fetchone()[0]) > 0
        finally:
            conn.close()
        
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

        transactions_df = load_transactions(env_id)
        if transactions_df is None or len(transactions_df) == 0:
            return jsonify({'error': 'No data available'}), 400
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
        window_hours = float(request.args.get('window_hours', 48))
        max_hops = int(request.args.get('max_hops', 4))
        amount_tolerance = float(request.args.get('amount_tolerance', 0.12))
        max_edges = int(request.args.get('max_edges', 350))
        max_paths = int(request.args.get('max_paths', 25))
        pass_through_window_hours = float(request.args.get('pass_through_window_hours', 1.0))
        start_ts = request.args.get('start_ts')
        end_ts = request.args.get('end_ts')

        analyzer = MoneyFlowAnalyzer(
            MoneyFlowConfig(
                window_hours=window_hours,
                max_hops=max_hops,
                amount_tolerance=amount_tolerance,
                max_edges=max_edges,
                max_paths=max_paths,
                pass_through_window_hours=pass_through_window_hours,
            )
        )

        result = analyzer.build_account_flow_graph(df, str(account_id), start_ts=start_ts, end_ts=end_ts)
        return jsonify(convert_numpy_types(result))
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@mule_bp.route('/accounts/<account_id>/flow-graph', methods=['GET'])
def get_flow_graph_workbench(account_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        df = load_transactions(env_id)
        accounts_df = load_accounts(env_id)

        start_ts = request.args.get('start_ts')
        end_ts = request.args.get('end_ts')
        window_hours = float(request.args.get('window_hours', 48))
        max_hops = int(request.args.get('max_hops', 4))
        amount_tolerance = float(request.args.get('amount_tolerance', 0.12))
        max_paths = int(request.args.get('max_paths', 25))
        pass_through_window_minutes = float(request.args.get('pass_through_window_minutes', 60))
        circular_only = str(request.args.get('circular_only', 'false')).strip().lower() in {'1', 'true', 'yes', 'y'}

        builder = MoneyFlowGraphWorkbench(
            FlowWorkbenchConfig(
                window_hours=window_hours,
                max_hops=max_hops,
                amount_tolerance=amount_tolerance,
                max_paths=max_paths,
                pass_through_window_minutes=pass_through_window_minutes,
                circular_only=circular_only,
            )
        )

        result = builder.build_graph_json(df, accounts_df, str(account_id), start_ts=start_ts, end_ts=end_ts)
        return jsonify(convert_numpy_types(result))
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@mule_bp.route('/accounts/flow-context', methods=['POST'])
def get_flow_graph_context():
    try:
        env_id = request.headers.get('X-Environment-ID')
        df = load_transactions(env_id)
        accounts_df = load_accounts(env_id)
        payload = request.get_json() or {}

        account_ids = payload.get('account_ids') or []
        if not isinstance(account_ids, list):
            return jsonify({'error': 'account_ids must be a list'}), 400

        start_ts = payload.get('start_ts')
        end_ts = payload.get('end_ts')
        window_hours = float(payload.get('window_hours', 48))
        max_hops = int(payload.get('max_hops', 4))
        amount_tolerance = float(payload.get('amount_tolerance', 0.12))
        max_paths = int(payload.get('max_paths', 25))
        pass_through_window_minutes = float(payload.get('pass_through_window_minutes', 60))
        circular_only = bool(payload.get('circular_only', False))

        builder = MoneyFlowGraphWorkbench(
            FlowWorkbenchConfig(
                window_hours=window_hours,
                max_hops=max_hops,
                amount_tolerance=amount_tolerance,
                max_paths=max_paths,
                pass_through_window_minutes=pass_through_window_minutes,
                circular_only=circular_only,
            )
        )

        results = []
        for aid in [str(a) for a in account_ids if a is not None and str(a).strip() != ""]:
            res = builder.build_context_json(df, accounts_df, str(aid), start_ts=start_ts, end_ts=end_ts)
            results.append(res)
        return jsonify(convert_numpy_types({"success": True, "results": results}))
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@mule_bp.route('/accounts/<account_id>/flow-graph/expand', methods=['POST'])
def expand_flow_graph_workbench(account_id):
    try:
        env_id = request.headers.get('X-Environment-ID')
        df = load_transactions(env_id)
        accounts_df = load_accounts(env_id)
        payload = request.get_json() or {}

        node_id = payload.get('node_id') or account_id
        direction = str(payload.get('direction') or 'outbound').strip().lower()
        start_ts = payload.get('start_ts')
        end_ts = payload.get('end_ts')

        window_hours = float(payload.get('window_hours', 48))
        max_hops = int(payload.get('max_hops', 4))
        amount_tolerance = float(payload.get('amount_tolerance', 0.12))
        max_paths = int(payload.get('max_paths', 25))
        pass_through_window_minutes = float(payload.get('pass_through_window_minutes', 60))
        circular_only = bool(payload.get('circular_only', False))

        builder = MoneyFlowGraphWorkbench(
            FlowWorkbenchConfig(
                window_hours=window_hours,
                max_hops=max_hops,
                amount_tolerance=amount_tolerance,
                max_paths=max_paths,
                pass_through_window_minutes=pass_through_window_minutes,
                circular_only=circular_only,
            )
        )

        result = builder.build_graph_json(df, accounts_df, str(node_id), start_ts=start_ts, end_ts=end_ts)
        result['expanded_from'] = {'account_id': str(account_id), 'node_id': str(node_id), 'direction': direction}
        return jsonify(convert_numpy_types(result))
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
        analyzer = MoneyFlowAnalyzer()
        edges, colmap = analyzer.build_directed_edges(df)
        if not edges:
            return jsonify({"success": False, "error": "transactions dataset missing required columns for money flow patterns", "colmap": colmap}), 200

        account_ids = [str(a) for a in df["account_id"].dropna().astype(str).unique().tolist()]
        patterns_out = []
        pass_through_accounts = []
        circular_accounts = []
        multi_hop_accounts = []
        burst_accounts = []

        for aid in account_ids:
            p = analyzer.compute_account_patterns(edges, aid)
            row = {
                "account_id": aid,
                "flow_score": float(p.get("flow_score", 0.0)),
                "risk_level": p.get("risk_level"),
                "pass_through": p.get("pass_through", {}),
                "circular_chains": p.get("circular_chains", {}),
                "multi_hop_chains": p.get("multi_hop_chains", {}),
                "velocity_bursts_in_chains": p.get("velocity_bursts_in_chains", {}),
            }
            patterns_out.append(row)

            if float(row["pass_through"].get("rate", 0) or 0) >= 0.15:
                pass_through_accounts.append(row)
            if int(row["circular_chains"].get("count", 0) or 0) > 0:
                circular_accounts.append(row)
            if int(row["multi_hop_chains"].get("count", 0) or 0) > 0:
                multi_hop_accounts.append(row)
            if int(row["velocity_bursts_in_chains"].get("count", 0) or 0) > 0:
                burst_accounts.append(row)

        patterns_out.sort(key=lambda r: float(r.get("flow_score") or 0), reverse=True)

        def top(rows, n=25):
            xs = rows[:]
            xs.sort(key=lambda r: float(r.get("flow_score") or 0), reverse=True)
            return xs[:n]

        return jsonify(
            {
                "success": True,
                "patterns": patterns_out,
                "summary": {
                    "total_accounts": int(len(patterns_out)),
                    "flagged_accounts": int(sum(1 for r in patterns_out if (r.get("risk_level") or "LOW") != "LOW")),
                    "pass_through_accounts": int(len(pass_through_accounts)),
                    "circular_chain_accounts": int(len(circular_accounts)),
                    "multi_hop_chain_accounts": int(len(multi_hop_accounts)),
                    "velocity_burst_accounts": int(len(burst_accounts)),
                },
                "top": {
                    "overall": patterns_out[:10],
                    "pass_through": top(pass_through_accounts, 10),
                    "circular": top(circular_accounts, 10),
                    "multi_hop": top(multi_hop_accounts, 10),
                    "velocity_burst": top(burst_accounts, 10),
                },
                "methodology": [
                    "Build directed edges from transactions: outbound account→counterparty, inbound counterparty→account.",
                    "Detect pass-through when funds exit within 1 hour after entry (amount-tolerant).",
                    "Detect multi-hop and circular chains via time-ordered traversal of edges.",
                    "Detect velocity bursts when multiple hops occur within 10 minutes in a chain.",
                ],
            }
        )
        
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
        paths = md_db.init_env_structure(env_id)
        conn = duckdb.connect(str(paths["duckdb"]))
        try:
            conn.execute(
                """
                INSERT INTO mule_risk_scores
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [
                    int(uuid.uuid4().int % (10**9)),
                    account_id,
                    float(hybrid_risk_score),
                    str(final_risk_level),
                    float(ml_prediction.get('mule_risk_score', 0)) if ml_prediction else None,
                    float(pattern_risk.get('risk_score', 0)),
                    float(ml_prediction.get('confidence', 0)) if ml_prediction else None,
                    str(response['decision']['decision_logic']) if response.get('decision') else 'PATTERN ONLY',
                    env_id
                ]
            )
        finally:
            conn.close()
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
        paths = md_db.init_env_structure(env_id)
        conn = duckdb.connect(str(paths["duckdb"]))
        try:
            conn.execute("DELETE FROM mule_risk_scores WHERE environment_id = ?", [env_id])
            rows = []
            for p in all_predictions:
                rows.append((
                    int(uuid.uuid4().int % (10**9)),
                    str(p['account_id']),
                    float(p['final_risk_score']),
                    str(p['final_risk_level']),
                    float(p['ml_risk_score']) if p['ml_risk_score'] is not None else None,
                    float(p['pattern_risk_score']),
                    float(p['confidence']) if p['confidence'] is not None else None,
                    str(p['decision_logic']),
                    env_id
                ))
            conn.register("rs", pd.DataFrame(rows, columns=[
                "id","account_id","hybrid_score","risk_level","ml_risk_score",
                "pattern_risk_score","confidence","decision_logic","environment_id"
            ]))
            conn.execute("""
                INSERT INTO mule_risk_scores
                SELECT id, account_id, hybrid_score, risk_level, ml_risk_score, pattern_risk_score,
                       confidence, decision_logic, environment_id, CURRENT_TIMESTAMP
                FROM rs
            """)
        finally:
            conn.close()
        return jsonify(convert_numpy_types(response))
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

from .intelligence_routes import intelligence_bp
mule_bp.register_blueprint(intelligence_bp)

from .platform_routes import platform_bp
mule_bp.register_blueprint(platform_bp)

print("Mule detection routes with enhanced ML loaded successfully")
