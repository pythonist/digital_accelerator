# backend/api/routes/mule_detection/ml_routes_enhanced.py
"""
ENHANCED ML API Routes with:
- Asynchronous training with job tracking
- Model versioning and management
- Decision Engine integration
- Full explainability
"""

from flask import Blueprint, request, jsonify
import pandas as pd
import traceback
import json
import os
import uuid
from datetime import datetime
from threading import Thread
from typing import Dict, Optional

# Import existing engines
from services.mule_detection.feature_engine import MuleFeatureEngine
from services.mule_detection.pattern_engine import MulePatternEngine
from services.mule_detection.ml_engine import MuleMLEngine

ml_bp = Blueprint('mule_ml_enhanced', __name__)

# Engine instances
feature_engine = MuleFeatureEngine()
pattern_engine = MulePatternEngine()
ml_engine = MuleMLEngine()

# In-memory job store (replace with Redis in production)
training_jobs = {}
model_registry = {}


def get_mule_dir(env_id):
    """Get mule detection directory for environment"""
    return f"data/environments/{env_id}/mule_detection"


def get_models_dir(env_id):
    """Get models directory"""
    models_dir = os.path.join(get_mule_dir(env_id), "ml_models")
    os.makedirs(models_dir, exist_ok=True)
    return models_dir


# ==================== DECISION ENGINE ====================

class DecisionEngine:
    """
    Hybrid Decision Engine: Combines ML + Patterns with explainable logic
    
    Core Principle: Never rely on ML alone. Pattern overrides apply.
    """
    
    def __init__(self):
        self.config = {
            'ml_weight': 0.6,          # ML contributes 60%
            'pattern_weight': 0.4,      # Patterns contribute 40%
            'confidence_threshold': 0.5, # Discount ML below this confidence
            'high_threshold': 65,       # 65+ = HIGH RISK
            'medium_threshold': 35,     # 35-64 = MEDIUM RISK
        }
    
    def decide(self, ml_score: float, ml_confidence: float, 
               pattern_score: float, patterns: list) -> Dict:
        """
        Make final mule risk decision
        
        Args:
            ml_score: ML risk score (0-100)
            ml_confidence: ML confidence (0-100)
            pattern_score: Pattern-based risk score (0-100)
            patterns: List of detected patterns
        
        Returns:
            {
                'final_risk_score': float,
                'final_risk_level': str,
                'decision_logic': str,
                'ml_trusted': bool,
                'pattern_override': bool
            }
        """
        
        # 1. Check for pattern overrides (HIGH severity patterns)
        high_severity_patterns = [p for p in patterns if p.get('severity') == 'HIGH']
        pattern_override = len(high_severity_patterns) >= 2
        
        if pattern_override:
            final_score = max(pattern_score, 75)  # Force HIGH risk
            decision_logic = f"PATTERN OVERRIDE: {len(high_severity_patterns)} HIGH-severity patterns detected"
            ml_trusted = False
        
        # 2. Check ML confidence
        elif ml_confidence < self.config['confidence_threshold'] * 100:
            # Low ML confidence - rely more on patterns
            final_score = pattern_score * 0.7 + ml_score * 0.3
            decision_logic = f"LOW ML CONFIDENCE ({ml_confidence:.1f}%) - Pattern score weighted higher"
            ml_trusted = False
        
        # 3. Normal case: Weighted combination
        else:
            ml_weight = self.config['ml_weight']
            pattern_weight = self.config['pattern_weight']
            
            final_score = (ml_score * ml_weight) + (pattern_score * pattern_weight)
            
            # Alignment bonus: If ML and patterns agree, boost confidence
            agreement = abs(ml_score - pattern_score) < 20
            if agreement and final_score > 50:
                final_score = min(final_score * 1.1, 100)
                decision_logic = "ML + PATTERNS ALIGNED - High confidence decision"
            else:
                decision_logic = f"HYBRID: ML ({ml_weight*100:.0f}%) + Patterns ({pattern_weight*100:.0f}%)"
            
            ml_trusted = True
        
        # 4. Determine risk level
        if final_score >= self.config['high_threshold']:
            risk_level = 'HIGH'
        elif final_score >= self.config['medium_threshold']:
            risk_level = 'MEDIUM'
        else:
            risk_level = 'LOW'
        
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
    """
    Background training job
    
    Updates job status in training_jobs dict
    """
    try:
        # Update status
        training_jobs[job_id]['status'] = 'RUNNING'
        training_jobs[job_id]['stage'] = 'Loading data...'
        training_jobs[job_id]['progress'] = 10
        
        # Load data
        txn_path = os.path.join(get_mule_dir(env_id), "raw", "transactions.csv")
        acc_path = os.path.join(get_mule_dir(env_id), "raw", "accounts.csv")
        
        transactions_df = pd.read_csv(txn_path)
        accounts_df = pd.read_csv(acc_path)
        
        # Update status
        training_jobs[job_id]['stage'] = 'Preparing features...'
        training_jobs[job_id]['progress'] = 20
        
        # Prepare dataset
        dataset = ml_engine.prepare_dataset(accounts_df, transactions_df, feature_engine)
        
        # Update config
        if config.get('hyperparameters'):
            ml_engine.update_config(config['hyperparameters'])
        
        # Update status
        training_jobs[job_id]['stage'] = 'Training model...'
        training_jobs[job_id]['progress'] = 40
        
        # Train
        validation_split = config.get('data_split', {}).get('validation', 0.2)
        metrics = ml_engine.train(dataset, validation_split=validation_split)
        
        # Update live metrics
        training_jobs[job_id]['metrics_live'] = {
            'train_auc': metrics.get('train_auc', 0),
            'val_auc': metrics.get('val_auc', 0),
            'val_recall': metrics.get('val_recall', 0)
        }
        training_jobs[job_id]['progress'] = 80
        
        # Save model
        training_jobs[job_id]['stage'] = 'Saving model...'
        model_version = f"ml_v{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        model_path = ml_engine.save_model(version=model_version)
        
        # Register model
        model_info = {
            'model_version': model_version,
            'algorithm': config.get('algorithm', 'lightgbm'),
            'trained_at': datetime.now().isoformat(),
            'metrics': metrics,
            'feature_count': len(ml_engine.feature_names),
            'training_samples': len(dataset),
            'config': config,
            'status': 'TRAINED',  # Not active yet
            'model_path': model_path
        }
        
        # Save to registry
        registry_path = os.path.join(get_models_dir(env_id), "model_registry.json")
        registry = {}
        if os.path.exists(registry_path):
            with open(registry_path, 'r') as f:
                registry = json.load(f)
        
        registry[model_version] = model_info
        
        with open(registry_path, 'w') as f:
            json.dump(registry, f, indent=2)
        
        # Complete
        training_jobs[job_id]['status'] = 'COMPLETED'
        training_jobs[job_id]['stage'] = 'Training complete!'
        training_jobs[job_id]['progress'] = 100
        training_jobs[job_id]['result'] = model_info
        
    except Exception as e:
        training_jobs[job_id]['status'] = 'FAILED'
        training_jobs[job_id]['error'] = str(e)
        traceback.print_exc()


@ml_bp.route('/train', methods=['POST'])
def train_ml_model():
    """
    Start async ML training job
    
    Request Body:
    {
        "algorithm": "lightgbm",
        "data_split": {
            "train": 0.7,
            "validation": 0.2,
            "test": 0.1
        },
        "hyperparameters": {
            "max_depth": 6,
            "num_leaves": 31,
            "learning_rate": 0.05,
            "n_estimators": 300
        },
        "objective": "recall",
        "recall_target": 0.9
    }
    
    Returns:
    {
        "job_id": "ml_job_xxx",
        "status": "QUEUED"
    }
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'Environment ID required'}), 400
        
        config = request.get_json() or {}
        
        # Generate job ID
        job_id = f"ml_job_{uuid.uuid4().hex[:8]}"
        
        # Initialize job
        training_jobs[job_id] = {
            'job_id': job_id,
            'env_id': env_id,
            'status': 'QUEUED',
            'stage': 'Initializing...',
            'progress': 0,
            'started_at': datetime.now().isoformat(),
            'config': config
        }
        
        # Start background thread
        thread = Thread(target=run_training_job, args=(job_id, env_id, config))
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'job_id': job_id,
            'status': 'QUEUED'
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@ml_bp.route('/train/<job_id>/status', methods=['GET'])
def get_training_status(job_id):
    """
    Get live training status
    
    Returns:
    {
        "status": "RUNNING",
        "stage": "Training iteration 120/300",
        "progress": 63,
        "metrics_live": {
            "train_auc": 0.91,
            "val_auc": 0.87,
            "val_recall": 0.92
        }
    }
    """
    if job_id not in training_jobs:
        return jsonify({'error': 'Job not found'}), 404
    
    job = training_jobs[job_id]
    
    return jsonify({
        'success': True,
        'job_id': job_id,
        'status': job['status'],
        'stage': job.get('stage', ''),
        'progress': job.get('progress', 0),
        'metrics_live': job.get('metrics_live', {}),
        'error': job.get('error')
    })


@ml_bp.route('/train/<job_id>/result', methods=['GET'])
def get_training_result(job_id):
    """
    Get final training result
    
    Returns:
    {
        "model_version": "ml_v7",
        "metrics": {...},
        "confusion_matrix": {...}
    }
    """
    if job_id not in training_jobs:
        return jsonify({'error': 'Job not found'}), 404
    
    job = training_jobs[job_id]
    
    if job['status'] != 'COMPLETED':
        return jsonify({
            'success': False,
            'status': job['status'],
            'error': job.get('error')
        })
    
    return jsonify({
        'success': True,
        'result': job['result']
    })


# ==================== MODEL MANAGEMENT ====================

@ml_bp.route('/models', methods=['GET'])
def list_models():
    """
    List all trained models
    
    Returns:
    [
        {
            "model_version": "ml_v7",
            "algorithm": "lightgbm",
            "status": "ACTIVE",
            "recall": 0.91,
            "precision": 0.34,
            "trained_at": "2026-01-29T..."
        }
    ]
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        registry_path = os.path.join(get_models_dir(env_id), "model_registry.json")
        
        if not os.path.exists(registry_path):
            return jsonify({
                'success': True,
                'models': []
            })
        
        with open(registry_path, 'r') as f:
            registry = json.load(f)
        
        # Format for UI
        models = []
        for version, info in registry.items():
            models.append({
                'model_version': version,
                'algorithm': info.get('algorithm', 'lightgbm'),
                'status': info.get('status', 'TRAINED'),
                'recall': info['metrics'].get('val_recall', 0),
                'precision': info['metrics'].get('val_precision', 0),
                'auc': info['metrics'].get('val_auc', 0),
                'trained_at': info['trained_at'],
                'training_samples': info.get('training_samples', 0)
            })
        
        # Sort by date, newest first
        models.sort(key=lambda x: x['trained_at'], reverse=True)
        
        return jsonify({
            'success': True,
            'models': models
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@ml_bp.route('/models/activate', methods=['POST'])
def activate_model():
    """
    Activate a specific model version
    
    Request Body:
    {
        "model_version": "ml_v7"
    }
    
    This is the DEPLOYMENT step (separate from training)
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        req_data = request.get_json()
        model_version = req_data.get('model_version')
        
        if not model_version:
            return jsonify({'error': 'model_version required'}), 400
        
        registry_path = os.path.join(get_models_dir(env_id), "model_registry.json")
        
        with open(registry_path, 'r') as f:
            registry = json.load(f)
        
        if model_version not in registry:
            return jsonify({'error': 'Model version not found'}), 404
        
        # Deactivate all other models
        for version in registry:
            registry[version]['status'] = 'ARCHIVED' if version != model_version else 'ACTIVE'
        
        with open(registry_path, 'w') as f:
            json.dump(registry, f, indent=2)
        
        # Load model into ml_engine
        model_path = registry[model_version]['model_path']
        ml_engine.load_model(model_path)
        
        return jsonify({
            'success': True,
            'message': f'Model {model_version} activated',
            'active_model': registry[model_version]
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@ml_bp.route('/models/<model_version>', methods=['GET'])
def get_model_details(model_version):
    """Get detailed info about a specific model"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        registry_path = os.path.join(get_models_dir(env_id), "model_registry.json")
        
        with open(registry_path, 'r') as f:
            registry = json.load(f)
        
        if model_version not in registry:
            return jsonify({'error': 'Model not found'}), 404
        
        return jsonify({
            'success': True,
            'model': registry[model_version]
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==================== DECISION ENGINE ENDPOINTS ====================

@ml_bp.route('/predict/<account_id>', methods=['GET'])
def predict_with_decision_engine(account_id):
    """
    Get hybrid prediction using Decision Engine
    
    Returns ML + Pattern fusion with full explainability
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        
        # Load active model
        registry_path = os.path.join(get_models_dir(env_id), "model_registry.json")
        
        if not os.path.exists(registry_path):
            return jsonify({
                'error': 'No models trained',
                'has_model': False
            }), 400
        
        with open(registry_path, 'r') as f:
            registry = json.load(f)
        
        # Find active model
        active_model = None
        for version, info in registry.items():
            if info.get('status') == 'ACTIVE':
                active_model = info
                break
        
        if not active_model:
            return jsonify({
                'error': 'No active model. Activate a model first.',
                'has_model': False
            }), 400
        
        # Load model
        ml_engine.load_model(active_model['model_path'])
        
        # Get data
        txn_path = os.path.join(get_mule_dir(env_id), "raw", "transactions.csv")
        acc_path = os.path.join(get_mule_dir(env_id), "raw", "accounts.csv")
        
        transactions_df = pd.read_csv(txn_path)
        accounts_df = pd.read_csv(acc_path) if os.path.exists(acc_path) else None
        
        # Get account metadata
        account_meta = None
        if accounts_df is not None:
            account_row = accounts_df[accounts_df['account_id'] == account_id]
            if len(account_row) > 0:
                account_meta = account_row.iloc[0].to_dict()
        
        # Compute features
        feature_dict = feature_engine.compute_account_features(
            transactions_df, account_id, account_meta
        )
        
        # Get ML prediction
        ml_prediction = ml_engine.predict(feature_dict, account_meta)
        
        # Get pattern-based risk
        patterns = pattern_engine.detect_patterns(feature_dict)
        pattern_risk = pattern_engine.calculate_risk_score(patterns)
        
        # === DECISION ENGINE ===
        decision = decision_engine.decide(
            ml_score=ml_prediction['mule_risk_score'],
            ml_confidence=ml_prediction['confidence'],
            pattern_score=pattern_risk['risk_score'],
            patterns=patterns
        )
        
        return jsonify({
            'success': True,
            'account_id': account_id,
            
            # Final decision (from Decision Engine)
            'final_risk_score': decision['final_risk_score'],
            'final_risk_level': decision['final_risk_level'],
            'decision_logic': decision['decision_logic'],
            
            # Component scores
            'ml': {
                'score': ml_prediction['mule_risk_score'],
                'confidence': ml_prediction['confidence'],
                'top_features': ml_prediction['top_features'],
                'trusted': decision['ml_trusted']
            },
            
            'pattern': {
                'score': pattern_risk['risk_score'],
                'patterns': patterns,
                'override_applied': decision['pattern_override']
            },
            
            # Model metadata
            'model_version': active_model['model_version']
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@ml_bp.route('/decision-engine/config', methods=['GET', 'POST'])
def decision_engine_config():
    """
    Get or update Decision Engine configuration
    
    GET: Returns current config
    POST: Updates config
    {
        "ml_weight": 0.6,
        "pattern_weight": 0.4,
        "confidence_threshold": 0.5
    }
    """
    if request.method == 'GET':
        return jsonify({
            'success': True,
            'config': decision_engine.config
        })
    
    try:
        new_config = request.get_json()
        decision_engine.update_config(new_config)
        
        return jsonify({
            'success': True,
            'config': decision_engine.config,
            'message': 'Decision engine config updated'
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@ml_bp.route('/decision-engine/simulate', methods=['POST'])
def simulate_decision_engine():
    """
    Simulate Decision Engine with different configurations
    
    Request Body:
    {
        "config": {
            "ml_weight": 0.7,
            "pattern_weight": 0.3
        },
        "ml_score": 75,
        "ml_confidence": 85,
        "pattern_score": 45,
        "patterns": [...]
    }
    
    Returns decision without applying changes
    """
    try:
        req_data = request.get_json()
        
        # Create temporary decision engine
        temp_engine = DecisionEngine()
        if 'config' in req_data:
            temp_engine.update_config(req_data['config'])
        
        decision = temp_engine.decide(
            ml_score=req_data['ml_score'],
            ml_confidence=req_data['ml_confidence'],
            pattern_score=req_data['pattern_score'],
            patterns=req_data.get('patterns', [])
        )
        
        return jsonify({
            'success': True,
            'decision': decision
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==================== BATCH OPERATIONS ====================

@ml_bp.route('/batch-predict', methods=['POST'])
def batch_predict():
    """
    Run predictions on all accounts using Decision Engine
    
    Returns summary + stores results
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        
        # Load active model
        registry_path = os.path.join(get_models_dir(env_id), "model_registry.json")
        
        with open(registry_path, 'r') as f:
            registry = json.load(f)
        
        active_model = None
        for version, info in registry.items():
            if info.get('status') == 'ACTIVE':
                active_model = info
                break
        
        if not active_model:
            return jsonify({'error': 'No active model'}), 400
        
        ml_engine.load_model(active_model['model_path'])
        
        # Get data
        txn_path = os.path.join(get_mule_dir(env_id), "raw", "transactions.csv")
        acc_path = os.path.join(get_mule_dir(env_id), "raw", "accounts.csv")
        
        transactions_df = pd.read_csv(txn_path)
        accounts_df = pd.read_csv(acc_path) if os.path.exists(acc_path) else None
        
        # Get all accounts
        account_ids = transactions_df['account_id'].unique()
        
        results = []
        risk_distribution = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}
        
        for account_id in account_ids:
            # Get metadata
            account_meta = None
            if accounts_df is not None:
                account_row = accounts_df[accounts_df['account_id'] == account_id]
                if len(account_row) > 0:
                    account_meta = account_row.iloc[0].to_dict()
            
            # Compute features
            feature_dict = feature_engine.compute_account_features(
                transactions_df, account_id, account_meta
            )
            
            # ML prediction
            ml_pred = ml_engine.predict(feature_dict, account_meta)
            
            # Pattern detection
            patterns = pattern_engine.detect_patterns(feature_dict)
            pattern_risk = pattern_engine.calculate_risk_score(patterns)
            
            # Decision Engine
            decision = decision_engine.decide(
                ml_score=ml_pred['mule_risk_score'],
                ml_confidence=ml_pred['confidence'],
                pattern_score=pattern_risk['risk_score'],
                patterns=patterns
            )
            
            results.append({
                'account_id': account_id,
                'final_risk_score': decision['final_risk_score'],
                'final_risk_level': decision['final_risk_level'],
                'ml_score': ml_pred['mule_risk_score'],
                'pattern_score': pattern_risk['risk_score']
            })
            
            risk_distribution[decision['final_risk_level']] += 1
        
        # Save results
        results_path = os.path.join(get_mule_dir(env_id), "batch_predictions.json")
        with open(results_path, 'w') as f:
            json.dump(results, f, indent=2)
        
        return jsonify({
            'success': True,
            'total_accounts': len(results),
            'risk_distribution': risk_distribution,
            'model_version': active_model['model_version'],
            'results_preview': results[:10]
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500