# backend/api/routes/mule_detection/ml_routes_complete.py
"""
Complete ML API Routes with:
- Support for both uploaded CSV and synthetic data
- XGBoost and LightGBM training
- Async job management
- Feature store integration
- Model versioning
"""

from flask import Blueprint, request, jsonify
import pandas as pd
import numpy as np
import traceback
import json
import os
import uuid
from datetime import datetime
from threading import Thread
from typing import Dict, Optional, List
import joblib

# Import ML components
try:
    from services.mule_detection.ml_engine import MuleMLEngine
    from services.mule_detection.feature_engine import MuleFeatureEngine
    from services.mule_detection.pattern_engine import MulePatternEngine
    import lightgbm as lgb
    import xgboost as xgb
    _XGB_AVAILABLE = True
except ImportError:
    xgb = None
    _XGB_AVAILABLE = False

ml_bp = Blueprint('mule_ml_complete', __name__)

# In-memory stores (use Redis in production)
training_jobs = {}
model_registry = {}
feature_importance_cache = {}


def get_mule_dir(env_id):
    """Get mule detection directory for environment"""
    return f"data/environments/{env_id}/mule_detection"


def get_models_dir(env_id):
    """Get models directory"""
    models_dir = os.path.join(get_mule_dir(env_id), "ml_models")
    os.makedirs(models_dir, exist_ok=True)
    return models_dir


def load_data(env_id: str) -> tuple:
    """
    Load data from either uploaded CSV or synthetic generation
    Returns: (transactions_df, accounts_df, data_source)
    """
    mule_dir = get_mule_dir(env_id)
    
    # Try to load transactions and accounts
    transactions_path = os.path.join(mule_dir, 'transactions.csv')
    accounts_path = os.path.join(mule_dir, 'accounts.csv')
    
    if not os.path.exists(transactions_path) or not os.path.exists(accounts_path):
        raise FileNotFoundError("No data found. Please upload data or generate synthetic data first.")
    
    transactions_df = pd.read_csv(transactions_path)
    accounts_df = pd.read_csv(accounts_path)
    
    # Determine data source
    data_source = 'synthetic' if 'mule_pattern' in transactions_df.columns else 'uploaded'
    
    return transactions_df, accounts_df, data_source


# ==================== ASYNC TRAINING ====================

def train_model_async(config: Dict, env_id: str, job_id: str):
    """
    Async training function that runs in background thread
    """
    try:
        # Update job status
        training_jobs[job_id]['status'] = 'RUNNING'
        training_jobs[job_id]['progress'] = 20
        training_jobs[job_id]['message'] = 'Loading data...'
        
        # Load data
        transactions_df, accounts_df, data_source = load_data(env_id)
        
        training_jobs[job_id]['progress'] = 30
        training_jobs[job_id]['message'] = 'Preparing features...'
        
        # Initialize engines
        feature_engine = MuleFeatureEngine()
        ml_engine = MuleMLEngine()
        
        # Update ML engine config with user parameters
        algorithm = config.get('algorithm', 'lightgbm')
        hyperparams = config.get('hyperparameters', {})
        
        # Prepare dataset
        dataset = ml_engine.prepare_dataset(accounts_df, transactions_df, feature_engine)
        
        training_jobs[job_id]['progress'] = 50
        training_jobs[job_id]['message'] = f'Training {algorithm.upper()} model...'
        
        # Configure model based on algorithm
        if algorithm == 'xgboost' and _XGB_AVAILABLE:
            ml_config = {
                'algorithm': 'xgboost',
                'max_depth': hyperparams.get('max_depth', 6),
                'learning_rate': hyperparams.get('learning_rate', 0.05),
                'n_estimators': hyperparams.get('n_estimators', 300),
                'scale_pos_weight': hyperparams.get('scale_pos_weight', 8),
                'subsample': hyperparams.get('subsample', 0.8),
                'colsample_bytree': hyperparams.get('colsample_bytree', 0.8),
                'gamma': hyperparams.get('gamma', 0),
                'min_child_weight': hyperparams.get('min_child_weight', 1),
                'random_state': config.get('random_seed', 42)
            }
        else:
            # LightGBM (default)
            ml_config = {
                'algorithm': 'lightgbm',
                'max_depth': hyperparams.get('max_depth', 6),
                'num_leaves': hyperparams.get('num_leaves', 31),
                'learning_rate': hyperparams.get('learning_rate', 0.05),
                'n_estimators': hyperparams.get('n_estimators', 300),
                'scale_pos_weight': hyperparams.get('scale_pos_weight', 8),
                'random_state': config.get('random_seed', 42)
            }
        
        ml_engine.update_config(ml_config)
        
        # Train with validation split
        data_split = config.get('data_split', {})
        val_split = data_split.get('validation', 0.2)
        
        training_jobs[job_id]['progress'] = 70
        
        metrics = ml_engine.train(dataset, validation_split=val_split)
        
        training_jobs[job_id]['progress'] = 90
        training_jobs[job_id]['message'] = 'Saving model...'
        
        # Generate model version
        model_count = len([k for k in model_registry.keys() if k.startswith(env_id)]) + 1
        model_version = f"v{model_count}"
        
        # Save model
        model_dir = ml_engine.save_model(version=model_version)
        
        # Register model
        model_key = f"{env_id}_{model_version}"
        model_registry[model_key] = {
            'env_id': env_id,
            'model_version': model_version,
            'algorithm': algorithm,
            'model_dir': model_dir,
            'trained_at': datetime.now().isoformat(),
            'training_samples': len(dataset),
            'feature_count': len(ml_engine.feature_names),
            'data_source': data_source,
            'status': 'TRAINED',
            'metrics': metrics,
            'auc': metrics.get('val_auc', 0),
            'precision': metrics.get('val_precision', 0),
            'recall': metrics.get('val_recall', 0),
            'f1_score': metrics.get('val_f1', 0)
        }
        
        # Store feature importance
        if hasattr(ml_engine.model, 'feature_importances_'):
            feature_imp = dict(zip(
                ml_engine.feature_names,
                ml_engine.model.feature_importances_
            ))
            feature_importance_cache[model_key] = feature_imp
        
        # Complete job
        training_jobs[job_id]['status'] = 'COMPLETED'
        training_jobs[job_id]['progress'] = 100
        training_jobs[job_id]['message'] = 'Training complete!'
        training_jobs[job_id]['result'] = {
            'model_version': model_version,
            'model_key': model_key,
            'metrics': metrics,
            'data_source': data_source
        }
        
    except Exception as e:
        print(f"Training error: {str(e)}")
        traceback.print_exc()
        training_jobs[job_id]['status'] = 'FAILED'
        training_jobs[job_id]['error'] = str(e)
        training_jobs[job_id]['traceback'] = traceback.format_exc()


@ml_bp.route('/api/v2/mule/ml/train', methods=['POST'])
def start_training():
    """
    Start async model training
    
    Request body:
    {
        "algorithm": "xgboost" | "lightgbm",
        "data_split": {
            "train": 0.7,
            "validation": 0.2,
            "test": 0.1
        },
        "hyperparameters": {...},
        "objective": "recall",
        "recall_target": 0.90,
        "random_seed": 42
    }
    """
    try:
        env_id = request.headers.get('X-Environment-ID', 'fcip_env')
        config = request.get_json() or {}
        
        # Validate data exists
        try:
            load_data(env_id)
        except FileNotFoundError as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 400
        
        # Create training job
        job_id = str(uuid.uuid4())
        training_jobs[job_id] = {
            'job_id': job_id,
            'env_id': env_id,
            'status': 'QUEUED',
            'progress': 0,
            'message': 'Queued for training...',
            'created_at': datetime.now().isoformat(),
            'config': config
        }
        
        # Start training in background thread
        thread = Thread(target=train_model_async, args=(config, env_id, job_id))
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'job_id': job_id,
            'status': 'QUEUED'
        })
    
    except Exception as e:
        print(f"Failed to start training: {str(e)}")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@ml_bp.route('/api/v2/mule/ml/train/<job_id>/status', methods=['GET'])
def get_training_status(job_id):
    """Get training job status"""
    job = training_jobs.get(job_id)
    
    if not job:
        return jsonify({
            'success': False,
            'error': 'Job not found'
        }), 404
    
    return jsonify({
        'success': True,
        'job_id': job_id,
        'status': job['status'],
        'progress': job.get('progress', 0),
        'message': job.get('message', ''),
        'error': job.get('error')
    })


@ml_bp.route('/api/v2/mule/ml/train/<job_id>/result', methods=['GET'])
def get_training_result(job_id):
    """Get final training result"""
    job = training_jobs.get(job_id)
    
    if not job:
        return jsonify({
            'success': False,
            'error': 'Job not found'
        }), 404
    
    if job['status'] != 'COMPLETED':
        return jsonify({
            'success': False,
            'error': f'Job status is {job["status"]}, not COMPLETED'
        }), 400
    
    return jsonify({
        'success': True,
        'result': job.get('result', {})
    })


# ==================== MODEL MANAGEMENT ====================

@ml_bp.route('/api/v2/mule/ml/models', methods=['GET'])
def list_models():
    """List all trained models for environment"""
    env_id = request.headers.get('X-Environment-ID', 'fcip_env')
    
    # Filter models for this environment
    env_models = [
        model_info for key, model_info in model_registry.items()
        if model_info['env_id'] == env_id
    ]
    
    # Sort by trained_at descending
    env_models.sort(key=lambda x: x['trained_at'], reverse=True)
    
    return jsonify({
        'success': True,
        'models': env_models
    })


@ml_bp.route('/api/v2/mule/ml/models/<model_version>', methods=['GET'])
def get_model_details(model_version):
    """Get specific model details"""
    env_id = request.headers.get('X-Environment-ID', 'fcip_env')
    model_key = f"{env_id}_{model_version}"
    
    model_info = model_registry.get(model_key)
    
    if not model_info:
        return jsonify({
            'success': False,
            'error': 'Model not found'
        }), 404
    
    return jsonify({
        'success': True,
        'model': model_info
    })


@ml_bp.route('/api/v2/mule/ml/models/activate', methods=['POST'])
def activate_model():
    """Activate a specific model version for inference"""
    env_id = request.headers.get('X-Environment-ID', 'fcip_env')
    data = request.get_json() or {}
    model_version = data.get('model_version')
    
    if not model_version:
        return jsonify({
            'success': False,
            'error': 'model_version required'
        }), 400
    
    model_key = f"{env_id}_{model_version}"
    
    if model_key not in model_registry:
        return jsonify({
            'success': False,
            'error': 'Model not found'
        }), 404
    
    # Deactivate all other models for this env
    for key, info in model_registry.items():
        if info['env_id'] == env_id:
            info['status'] = 'TRAINED' if key != model_key else 'ACTIVE'
    
    # Activate this model
    model_registry[model_key]['status'] = 'ACTIVE'
    
    return jsonify({
        'success': True,
        'model_version': model_version,
        'status': 'ACTIVE'
    })


# ==================== FEATURE IMPORTANCE ====================

@ml_bp.route('/api/v2/mule/ml/feature-importance', methods=['GET'])
def get_feature_importance():
    """Get feature importance for active model"""
    env_id = request.headers.get('X-Environment-ID', 'fcip_env')
    
    # Find active model
    active_model = None
    for key, info in model_registry.items():
        if info['env_id'] == env_id and info['status'] == 'ACTIVE':
            active_model = key
            break
    
    if not active_model:
        return jsonify({
            'success': False,
            'error': 'No active model found'
        }), 404
    
    feature_imp = feature_importance_cache.get(active_model, {})
    
    return jsonify({
        'success': True,
        'feature_importance': feature_imp
    })


# ==================== INFERENCE ====================

@ml_bp.route('/api/v2/mule/ml/predict/<account_id>', methods=['GET'])
def predict_account(account_id):
    """Get ML prediction for specific account"""
    try:
        env_id = request.headers.get('X-Environment-ID', 'fcip_env')
        
        # Load active model
        active_model_key = None
        for key, info in model_registry.items():
            if info['env_id'] == env_id and info['status'] == 'ACTIVE':
                active_model_key = key
                break
        
        if not active_model_key:
            return jsonify({
                'success': False,
                'error': 'No active model found'
            }), 404
        
        model_info = model_registry[active_model_key]
        
        # Load model
        ml_engine = MuleMLEngine()
        ml_engine.load_model(model_info['model_dir'])
        
        # Load data
        transactions_df, accounts_df, _ = load_data(env_id)
        
        # Get account
        account = accounts_df[accounts_df['account_id'] == account_id]
        if account.empty:
            return jsonify({
                'success': False,
                'error': 'Account not found'
            }), 404
        
        account = account.iloc[0].to_dict()
        
        # Compute features
        feature_engine = MuleFeatureEngine()
        feature_dict = feature_engine.compute_account_features(
            transactions_df,
            account_id,
            account
        )
        
        # Predict
        prediction = ml_engine.predict(feature_dict, account)
        
        return jsonify({
            'success': True,
            'account_id': account_id,
            'prediction': prediction,
            'model_version': model_info['model_version']
        })
    
    except Exception as e:
        print(f"Prediction error: {str(e)}")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@ml_bp.route('/api/v2/mule/ml/batch-predict', methods=['POST'])
def batch_predict():
    """Batch predict all accounts"""
    try:
        env_id = request.headers.get('X-Environment-ID', 'fcip_env')
        
        # Load active model
        active_model_key = None
        for key, info in model_registry.items():
            if info['env_id'] == env_id and info['status'] == 'ACTIVE':
                active_model_key = key
                break
        
        if not active_model_key:
            return jsonify({
                'success': False,
                'error': 'No active model found'
            }), 404
        
        model_info = model_registry[active_model_key]
        
        # Load model
        ml_engine = MuleMLEngine()
        ml_engine.load_model(model_info['model_dir'])
        
        # Load data
        transactions_df, accounts_df, _ = load_data(env_id)
        
        # Compute features for all accounts
        feature_engine = MuleFeatureEngine()
        
        predictions = []
        for _, account in accounts_df.iterrows():
            account_id = account['account_id']
            
            try:
                feature_dict = feature_engine.compute_account_features(
                    transactions_df,
                    account_id,
                    account.to_dict()
                )
                
                prediction = ml_engine.predict(feature_dict, account.to_dict())
                
                predictions.append({
                    'account_id': account_id,
                    'ml_risk_score': prediction['mule_risk_score'],
                    'risk_level': prediction['risk_level'],
                    'confidence': prediction['confidence']
                })
            except Exception as e:
                print(f"Error predicting {account_id}: {str(e)}")
                continue
        
        # Calculate distribution
        risk_dist = {
            'HIGH': len([p for p in predictions if p['risk_level'] == 'HIGH']),
            'MEDIUM': len([p for p in predictions if p['risk_level'] == 'MEDIUM']),
            'LOW': len([p for p in predictions if p['risk_level'] == 'LOW'])
        }
        
        return jsonify({
            'success': True,
            'total_accounts': len(accounts_df),
            'predictions': predictions,
            'risk_distribution': risk_dist
        })
    
    except Exception as e:
        print(f"Batch prediction error: {str(e)}")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ==================== DATA STATUS ====================

@ml_bp.route('/api/v2/mule/status', methods=['GET'])
def get_data_status():
    """Get current data status"""
    try:
        env_id = request.headers.get('X-Environment-ID', 'fcip_env')
        
        transactions_df, accounts_df, data_source = load_data(env_id)
        
        # Calculate statistics
        if 'is_mule' in accounts_df.columns:
            mule_accounts = int(accounts_df['is_mule'].sum())
            legitimate_accounts = len(accounts_df) - mule_accounts
            mule_percentage = (mule_accounts / len(accounts_df) * 100) if len(accounts_df) > 0 else 0
        else:
            mule_accounts = 0
            legitimate_accounts = len(accounts_df)
            mule_percentage = 0
        
        # Calculate avg tx count
        tx_per_account = transactions_df.groupby('account_id').size()
        avg_tx_count_24h = float(tx_per_account.mean()) if len(tx_per_account) > 0 else 0
        
        return jsonify({
            'success': True,
            'has_data': True,
            'data_source': data_source,
            'num_transactions': len(transactions_df),
            'num_accounts': len(accounts_df),
            'mule_accounts': mule_accounts,
            'legitimate_accounts': legitimate_accounts,
            'mule_percentage': mule_percentage,
            'avg_tx_count_24h': avg_tx_count_24h
        })
    
    except FileNotFoundError:
        return jsonify({
            'success': True,
            'has_data': False
        })
    except Exception as e:
        print(f"Status error: {str(e)}")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500