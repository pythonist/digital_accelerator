# backend/api/routes/mule_detection/ml_routes.py
"""
ML-specific API routes for Mule Detection Platform
Extends existing mule_detection routes with ML capabilities
"""

from flask import Blueprint, request, jsonify
import pandas as pd
import traceback
import json
import os

# Import existing engines
from services.mule_detection.feature_engine import MuleFeatureEngine
from services.mule_detection.pattern_engine import MulePatternEngine
from services.mule_detection.flow_engine import MuleFlowEngine

# Import new ML engine
try:
    from services.mule_detection.ml_engine import MuleMLEngine
except Exception:
    MuleMLEngine = None

ml_bp = Blueprint('mule_ml', __name__)

# Initialize engines
feature_engine = MuleFeatureEngine()
pattern_engine = MulePatternEngine()
flow_engine = MuleFlowEngine()
ml_engine = MuleMLEngine() if MuleMLEngine else None

def get_mule_dir(env_id):
    """Get mule detection directory for environment"""
    return f"data/environments/{env_id}/mule_detection"

def load_transactions(env_id):
    """Load transaction data"""
    txn_path = os.path.join(get_mule_dir(env_id), "raw", "transactions.csv")
    return pd.read_csv(txn_path)

def load_accounts(env_id):
    """Load account metadata"""
    acc_path = os.path.join(get_mule_dir(env_id), "raw", "accounts.csv")
    if os.path.exists(acc_path):
        return pd.read_csv(acc_path)
    return None


# ==================== ML MODEL TRAINING ====================

@ml_bp.route('/train', methods=['POST'])
def train_ml_model():
    """
    Train ML model on uploaded data
    
    Request Body:
    {
        "validation_split": 0.2,  # optional
        "hyperparameters": {...}  # optional config overrides
    }
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'Environment ID required'}), 400
        
        # Load data
        transactions_df = load_transactions(env_id)
        accounts_df = load_accounts(env_id)
        
        if accounts_df is None:
            return jsonify({'error': 'Account metadata required for ML training'}), 400
        
        if 'is_mule' not in accounts_df.columns:
            return jsonify({'error': 'Training labels (is_mule) required in accounts.csv'}), 400
        
        # Get request parameters
        req_data = request.get_json() or {}
        validation_split = req_data.get('validation_split', 0.2)
        hyperparameters = req_data.get('hyperparameters', {})
        
        # Update config if provided
        if hyperparameters:
            ml_engine.update_config(hyperparameters)
        
        # Prepare dataset
        dataset = ml_engine.prepare_dataset(accounts_df, transactions_df, feature_engine)
        
        # Train model
        metrics = ml_engine.train(dataset, validation_split=validation_split)
        
        # Save model
        model_path = ml_engine.save_model(version=f"env_{env_id}")
        
        # Store model reference in environment
        registry_path = os.path.join(get_mule_dir(env_id), "ml_registry.json")
        registry = {
            'model_path': model_path,
            'trained_at': pd.Timestamp.now().isoformat(),
            'metrics': metrics,
            'feature_count': len(ml_engine.feature_names),
            'training_samples': len(dataset)
        }
        
        with open(registry_path, 'w') as f:
            json.dump(registry, f, indent=2)
        
        return jsonify({
            'success': True,
            'message': 'Model trained successfully',
            'model_path': model_path,
            'metrics': metrics
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@ml_bp.route('/cross-validate', methods=['POST'])
def cross_validate_model():
    """
    Perform K-fold cross-validation for robust performance estimate
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        transactions_df = load_transactions(env_id)
        accounts_df = load_accounts(env_id)
        
        # Prepare dataset
        dataset = ml_engine.prepare_dataset(accounts_df, transactions_df, feature_engine)
        
        # Cross-validate
        cv_results = ml_engine.cross_validate(dataset)
        
        return jsonify({
            'success': True,
            'cv_results': cv_results
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==================== ML INFERENCE ====================

@ml_bp.route('/predict/<account_id>', methods=['GET'])
def predict_ml_score(account_id):
    """
    Get ML risk score for single account
    
    Returns hybrid prediction: ML + Pattern scores
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        
        # Load model
        registry_path = os.path.join(get_mule_dir(env_id), "ml_registry.json")
        if os.path.exists(registry_path):
            with open(registry_path, 'r') as f:
                registry = json.load(f)
            ml_engine.load_model(registry['model_path'])
        else:
            return jsonify({
                'error': 'ML model not trained. Train model first.',
                'has_model': False
            }), 400
        
        # Get data
        transactions_df = load_transactions(env_id)
        accounts_df = load_accounts(env_id)
        
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
        
        # Get pattern-based risk (existing system)
        patterns = pattern_engine.detect_patterns(feature_dict)
        pattern_risk = pattern_engine.calculate_risk_score(patterns)
        
        # === HYBRID DECISIONING ===
        # Take maximum of ML and Pattern scores with overrides
        
        # Base hybrid score: max(ML, Pattern)
        hybrid_score = max(
            ml_prediction['mule_risk_score'],
            pattern_risk['risk_score']
        )
        
        # Pattern override: If HIGH pattern severity detected, elevate score
        high_severity_patterns = [p for p in patterns if p['severity'] == 'HIGH']
        if len(high_severity_patterns) >= 2:
            hybrid_score = max(hybrid_score, 75)  # Boost to HIGH risk
        
        # Determine final risk level
        if hybrid_score >= 65:
            final_risk_level = 'HIGH'
        elif hybrid_score >= 35:
            final_risk_level = 'MEDIUM'
        else:
            final_risk_level = 'LOW'
        
        # Explanation alignment: Do ML and patterns agree?
        agreement = abs(ml_prediction['mule_risk_score'] - pattern_risk['risk_score']) < 20
        
        return jsonify({
            'success': True,
            'account_id': account_id,
            
            # Hybrid output
            'hybrid_risk_score': float(hybrid_score),
            'final_risk_level': final_risk_level,
            'agreement': agreement,
            
            # ML component
            'ml_prediction': ml_prediction,
            
            # Pattern component
            'pattern_risk': pattern_risk,
            'patterns': patterns,
            
            # Metadata
            'explanation': {
                'primary_signal': 'ML' if ml_prediction['mule_risk_score'] > pattern_risk['risk_score'] else 'PATTERN',
                'ml_confidence': ml_prediction['confidence'],
                'pattern_count': len(patterns),
                'high_severity_patterns': len(high_severity_patterns)
            }
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@ml_bp.route('/batch-predict', methods=['POST'])
def batch_predict():
    """
    Batch ML scoring for all accounts (daily batch job)
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        
        # Load model
        registry_path = os.path.join(get_mule_dir(env_id), "ml_registry.json")
        if not os.path.exists(registry_path):
            return jsonify({'error': 'ML model not trained'}), 400
        
        with open(registry_path, 'r') as f:
            registry = json.load(f)
        ml_engine.load_model(registry['model_path'])
        
        # Load data
        transactions_df = load_transactions(env_id)
        accounts_df = load_accounts(env_id)
        
        # Batch predict
        all_predictions = []
        
        for account_id in transactions_df['account_id'].unique():
            # Get metadata
            account_meta = None
            if accounts_df is not None:
                account_row = accounts_df[accounts_df['account_id'] == account_id]
                if len(account_row) > 0:
                    account_meta = account_row.iloc[0].to_dict()
            
            # Features
            feature_dict = feature_engine.compute_account_features(
                transactions_df, str(account_id), account_meta
            )
            
            # ML prediction
            ml_pred = ml_engine.predict(feature_dict, account_meta)
            
            # Pattern risk
            patterns = pattern_engine.detect_patterns(feature_dict)
            pattern_risk = pattern_engine.calculate_risk_score(patterns)
            
            # Hybrid score
            hybrid_score = max(ml_pred['mule_risk_score'], pattern_risk['risk_score'])
            
            all_predictions.append({
                'account_id': str(account_id),
                'hybrid_risk_score': float(hybrid_score),
                'ml_risk_score': float(ml_pred['mule_risk_score']),
                'pattern_risk_score': pattern_risk['risk_score'],
                'risk_level': ml_pred['risk_level'],
                'confidence': ml_pred['confidence']
            })
        
        # Save predictions
        predictions_path = os.path.join(get_mule_dir(env_id), "ml_predictions.json")
        with open(predictions_path, 'w') as f:
            json.dump(all_predictions, f, indent=2)
        
        # Summary statistics
        risk_distribution = {
            'HIGH': sum(1 for p in all_predictions if p['hybrid_risk_score'] >= 65),
            'MEDIUM': sum(1 for p in all_predictions if 35 <= p['hybrid_risk_score'] < 65),
            'LOW': sum(1 for p in all_predictions if p['hybrid_risk_score'] < 35)
        }
        
        return jsonify({
            'success': True,
            'total_accounts': len(all_predictions),
            'risk_distribution': risk_distribution,
            'predictions': all_predictions[:10],  # Sample
            'saved_to': predictions_path
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==================== MODEL MANAGEMENT ====================

@ml_bp.route('/model/info', methods=['GET'])
def get_model_info():
    """Get current model information and metrics"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        registry_path = os.path.join(get_mule_dir(env_id), "ml_registry.json")
        
        if not os.path.exists(registry_path):
            return jsonify({
                'has_model': False,
                'message': 'No ML model trained for this environment'
            })
        
        with open(registry_path, 'r') as f:
            registry = json.load(f)
        
        # Load model to get health
        ml_engine.load_model(registry['model_path'])
        health = ml_engine.get_model_health()
        
        return jsonify({
            'success': True,
            'has_model': True,
            'model_info': registry,
            'health': health,
            'feature_importance': ml_engine._compute_feature_importance()
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@ml_bp.route('/model/drift', methods=['POST'])
def detect_drift():
    """
    Detect feature drift between training and new data
    
    Critical for AML monitoring
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        
        # Load current data
        transactions_df = load_transactions(env_id)
        accounts_df = load_accounts(env_id)
        
        # Prepare current dataset
        current_dataset = ml_engine.prepare_dataset(
            accounts_df, transactions_df, feature_engine
        )
        
        # TODO: Load reference (training) dataset
        # For now, compare current to itself (placeholder)
        reference_dataset = current_dataset.iloc[:int(len(current_dataset)*0.5)]
        new_dataset = current_dataset.iloc[int(len(current_dataset)*0.5):]
        
        # Detect drift
        drift_report = ml_engine.detect_feature_drift(new_dataset, reference_dataset)
        
        return jsonify({
            'success': True,
            'drift_report': drift_report
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@ml_bp.route('/model/feature-importance', methods=['GET'])
def get_feature_importance():
    """Get global feature importance for model transparency"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        registry_path = os.path.join(get_mule_dir(env_id), "ml_registry.json")
        
        if not os.path.exists(registry_path):
            return jsonify({'error': 'No model trained'}), 400
        
        with open(registry_path, 'r') as f:
            registry = json.load(f)
        
        ml_engine.load_model(registry['model_path'])
        
        feature_importance = ml_engine._compute_feature_importance()
        
        # Format for frontend
        importance_list = [
            {'feature': k, 'importance': v}
            for k, v in feature_importance.items()
        ]
        
        return jsonify({
            'success': True,
            'feature_importance': importance_list
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==================== THRESHOLD TUNING ====================

@ml_bp.route('/threshold/simulate', methods=['POST'])
def simulate_threshold():
    """
    Simulate impact of changing decision threshold
    
    Request Body:
    {
        "threshold": 0.65,  # New threshold
        "metric": "recall"  # What to optimize
    }
    
    Returns alert volume and performance at different thresholds
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        req_data = request.get_json()
        
        test_threshold = req_data.get('threshold', 0.5)
        
        # Load predictions
        predictions_path = os.path.join(get_mule_dir(env_id), "ml_predictions.json")
        
        if not os.path.exists(predictions_path):
            return jsonify({'error': 'Run batch-predict first'}), 400
        
        with open(predictions_path, 'r') as f:
            predictions = json.load(f)
        
        # Simulate threshold change
        alert_counts = {
            'HIGH': sum(1 for p in predictions if p['ml_risk_score'] >= test_threshold * 100),
            'MEDIUM': sum(1 for p in predictions if test_threshold * 50 <= p['ml_risk_score'] < test_threshold * 100),
            'LOW': sum(1 for p in predictions if p['ml_risk_score'] < test_threshold * 50)
        }
        
        # Estimate workload
        estimated_hours = alert_counts['HIGH'] * 2 + alert_counts['MEDIUM'] * 0.5
        
        return jsonify({
            'success': True,
            'threshold': test_threshold,
            'alert_distribution': alert_counts,
            'total_alerts': sum(alert_counts.values()),
            'estimated_analyst_hours': estimated_hours,
            'alert_rate': alert_counts['HIGH'] / len(predictions) * 100
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==================== EXPLAINABILITY ====================

@ml_bp.route('/explain/<account_id>', methods=['GET'])
def explain_prediction(account_id):
    """
    Get detailed explanation for why an account was scored high/low
    
    Combines ML (SHAP) and Pattern explanations
    """
    try:
        env_id = request.headers.get('X-Environment-ID')
        
        # Get ML prediction (already has SHAP values)
        ml_response = predict_ml_score(account_id)
        ml_data = ml_response.get_json()
        
        if not ml_data.get('success'):
            return ml_response
        
        # Enhanced explanation
        explanation = {
            'account_id': account_id,
            'final_risk_score': ml_data['hybrid_risk_score'],
            'risk_level': ml_data['final_risk_level'],
            
            # ML explanation
            'ml_explanation': {
                'risk_score': ml_data['ml_prediction']['mule_risk_score'],
                'confidence': ml_data['ml_prediction']['confidence'],
                'top_features': ml_data['ml_prediction']['top_features'],
                'interpretation': _interpret_ml_features(ml_data['ml_prediction']['top_features'])
            },
            
            # Pattern explanation
            'pattern_explanation': {
                'risk_score': ml_data['pattern_risk']['risk_score'],
                'patterns_detected': ml_data['patterns'],
                'interpretation': _interpret_patterns(ml_data['patterns'])
            },
            
            # Agreement analysis
            'agreement_analysis': {
                'ml_pattern_agree': ml_data['agreement'],
                'primary_signal': ml_data['explanation']['primary_signal'],
                'message': _generate_agreement_message(ml_data)
            }
        }
        
        return jsonify({
            'success': True,
            'explanation': explanation
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def _interpret_ml_features(top_features):
    """Generate human-readable interpretation of top ML features"""
    interpretations = []
    
    for feat in top_features[:3]:
        feature_name = feat['feature']
        shap_value = feat['shap_value']
        
        if 'pass_through' in feature_name and shap_value > 0:
            interpretations.append("Account rapidly transfers out received funds (high pass-through)")
        elif 'holding_time' in feature_name and shap_value > 0:
            interpretations.append("Funds are moved very quickly after receipt")
        elif 'fan_in' in feature_name and shap_value > 0:
            interpretations.append("Multiple accounts sending funds to this account (aggregation)")
        elif 'fan_out' in feature_name and shap_value > 0:
            interpretations.append("Account distributes funds to many recipients")
    
    return interpretations


def _interpret_patterns(patterns):
    """Generate human-readable pattern summary"""
    if not patterns:
        return ["No suspicious patterns detected"]
    
    interpretations = []
    for pattern in patterns:
        interpretations.append(f"{pattern['pattern_name']}: {pattern['evidence']}")
    
    return interpretations


def _generate_agreement_message(ml_data):
    """Generate message about ML-Pattern agreement"""
    if ml_data['agreement']:
        return "ML model and pattern detection agree on risk assessment"
    else:
        primary = ml_data['explanation']['primary_signal']
        if primary == 'ML':
            return "ML model detected additional risk factors beyond coded patterns"
        else:
            return "Pattern detection identified specific rule violations"


