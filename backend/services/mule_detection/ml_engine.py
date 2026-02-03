# backend/services/mule_detection/ml_engine.py
"""
ML Engine: Production-Grade Machine Learning Layer for Mule Detection
Integrates with existing Feature/Pattern/Flow engines to provide learned risk scoring

Key Design Principles:
- Complement pattern detection, don't replace it
- Explainability via SHAP values
- Handles class imbalance and noisy labels
- Production-ready with monitoring and drift detection
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
import lightgbm as lgb
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.preprocessing import StandardScaler, RobustScaler
from sklearn.metrics import (
    precision_recall_curve, roc_auc_score, classification_report,
    confusion_matrix, f1_score, recall_score, precision_score
)
import shap
import joblib
import json
import warnings
from datetime import datetime, timedelta
import os

warnings.filterwarnings('ignore')


class MuleMLEngine:
    """
    Production ML engine for mule detection with full AML compliance features
    """
    
    def __init__(self, model_dir: str = "data/models/mule_detection"):
        """
        Initialize ML Engine
        
        Args:
            model_dir: Directory for model artifacts
        """
        self.model_dir = model_dir
        os.makedirs(model_dir, exist_ok=True)
        
        # Model components
        self.model = None
        self.scaler = None
        self.feature_names = None
        self.explainer = None
        self.numeric_cols = None
        self.categorical_cols = None
        self.scaler_feature_names = None
        
        # Configuration
        self.config = self._default_config()
        
        # Performance tracking
        self.metrics_history = []
        
    def _default_config(self) -> Dict:  
        """Default hyperparameters optimized for mule detection"""
        return {
            # LightGBM parameters
            'boosting_type': 'gbdt',
            'objective': 'binary',
            'metric': 'auc',
            'num_leaves': 31,
            'max_depth': 6,
            'learning_rate': 0.05,
            'n_estimators': 200,
            'subsample': 0.8,
            'colsample_bytree': 0.8,
            'min_child_samples': 20,
            'reg_alpha': 0.1,
            'reg_lambda': 0.1,
            
            # Class imbalance handling (AML bias toward recall)
            'scale_pos_weight': 10.0,  # Mule:Normal ratio
            
            # Training strategy
            'cv_folds': 5,
            'random_state': 42,
            'early_stopping_rounds': 30,
            'verbose': -1,
            
            # Thresholds (configurable via UI later)
            'threshold_high_risk': 0.65,  # 65+ = HIGH RISK
            'threshold_medium_risk': 0.35,  # 35-64 = MEDIUM RISK
            
            # Feature engineering
            'use_robust_scaling': True,  # Better for outliers
            'impute_strategy': 'median'
        }
    
    def update_config(self, new_config: Dict):
        """Update hyperparameters (for UI tuning)"""
        self.config.update(new_config)
    
    # ==================== FEATURE PREPARATION ====================
    
    def prepare_features(self, feature_dict: Dict, account_meta: Optional[Dict] = None) -> pd.Series:
        """
        Prepare feature vector from Feature Engine output
        
        Args:
            feature_dict: Output from FeatureEngine.compute_account_features()
            account_meta: Optional account metadata
            
        Returns:
            Feature vector ready for ML inference
        """
        features = {}
        
        # === CORE FLOW FEATURES (Existing) ===
        features['pass_through_ratio'] = feature_dict.get('pass_through_ratio', 0)
        features['retention_ratio'] = feature_dict.get('retention_ratio', 0)
        features['holding_time_avg'] = feature_dict.get('holding_time_avg', 0)
        features['same_day_pass_through'] = feature_dict.get('same_day_pass_through', 0)
        
        # === NETWORK FEATURES (Existing) ===
        features['unique_senders'] = feature_dict.get('unique_senders', 0)
        features['unique_receivers'] = feature_dict.get('unique_receivers', 0)
        features['fan_in_score'] = feature_dict.get('fan_in_score', 0)
        features['fan_out_score'] = feature_dict.get('fan_out_score', 0)
        features['sender_concentration'] = feature_dict.get('sender_concentration', 0)
        features['receiver_concentration'] = feature_dict.get('receiver_concentration', 0)
        
        # === TEMPORAL FEATURES (Existing) ===
        features['velocity'] = feature_dict.get('velocity', 0)
        features['dormancy_period'] = feature_dict.get('dormancy_period', 0)
        features['activity_spike'] = 1.0 if feature_dict.get('activity_spike', False) else 0.0
        
        # === CHANNEL FEATURES (Existing) ===
        features['channel_entropy'] = feature_dict.get('channel_entropy', 0)
        features['channel_switching'] = feature_dict.get('channel_switching', 0)
        features['unique_channels'] = feature_dict.get('unique_channels', 0)
        
        # === ECONOMIC FEATURES (Existing) ===
        features['turnover_ratio'] = feature_dict.get('turnover_ratio', 0)
        features['turnover_excess'] = feature_dict.get('turnover_excess', 0)
        
        # === ENGINEERED FEATURES (NEW - ML Extensions) ===
        
        # Flow asymmetry: Imbalance between in/out
        total_credit = feature_dict.get('total_credit', 0)
        total_debit = feature_dict.get('total_debit', 0)
        features['flow_asymmetry'] = abs(total_credit - total_debit) / max(total_credit + total_debit, 1)
        
        # Counterparty diversity: Combined sender/receiver uniqueness
        features['counterparty_diversity'] = np.log1p(
            feature_dict.get('unique_senders', 0) + feature_dict.get('unique_receivers', 0)
        )
        
        # Rapid turnover indicator: Combines pass-through + holding time
        holding_time = feature_dict.get('holding_time_avg', 999)
        pass_through = feature_dict.get('pass_through_ratio', 0)
        features['rapid_turnover_score'] = pass_through * (1 / (1 + holding_time/24))
        
        # Network centrality proxy: Fan-in * Fan-out
        features['network_centrality'] = (
            feature_dict.get('fan_in_score', 0) * feature_dict.get('fan_out_score', 0)
        )
        
        # Behavioral consistency: Low entropy + high velocity = automated behavior
        entropy = feature_dict.get('channel_entropy', 0)
        velocity = feature_dict.get('velocity', 0)
        features['automation_score'] = velocity / (1 + entropy)
        
        # === ACCOUNT CONTEXT (if available) ===
        if account_meta:
            # Occupation risk mapping
            occupation_risk = {
                'STUDENT': 0.3,
                'SALARIED': 0.2,
                'SELF_EMP': 0.4,
                'UNEMPLOYED': 0.6,
                'UNKNOWN': 0.5
            }
            features['occupation_risk'] = occupation_risk.get(
                account_meta.get('occupation', 'UNKNOWN'), 0.5
            )
            
            # Account age (days since opening)
            if 'account_open_date' in account_meta:
                open_date = pd.to_datetime(account_meta['account_open_date'])
                account_age_days = (datetime.now() - open_date).days
                features['account_age_days'] = account_age_days
                features['account_age_log'] = np.log1p(account_age_days)
            else:
                features['account_age_days'] = 0
                features['account_age_log'] = 0
        else:
            features['occupation_risk'] = 0.5
            features['account_age_days'] = 0
            features['account_age_log'] = 0
        
        # === RATIO FEATURES (Normalized) ===
        features['sender_receiver_ratio'] = (
            feature_dict.get('unique_senders', 0) / 
            max(feature_dict.get('unique_receivers', 1), 1)
        )
        
        return pd.Series(features)
    
    def prepare_dataset(self, accounts_df: pd.DataFrame, 
                       transactions_df: pd.DataFrame,
                       feature_engine) -> pd.DataFrame:
        """
        Prepare complete training dataset from raw data
        
        Args:
            accounts_df: Account metadata with is_mule label
            transactions_df: Transaction data
            feature_engine: Existing FeatureEngine instance
            
        Returns:
            DataFrame with features and labels
        """
        dataset = []
        
        for _, account in accounts_df.iterrows():
            account_id = account['account_id']
            
            # Compute features using existing engine
            feature_dict = feature_engine.compute_account_features(
                transactions_df, account_id, account.to_dict()
            )
            
            # Prepare ML feature vector
            features = self.prepare_features(feature_dict, account.to_dict())
            
            # Add label
            features['is_mule'] = account.get('is_mule', 0)
            features['account_id'] = account_id
            
            dataset.append(features)
        
        return pd.DataFrame(dataset)
    
    # ==================== PREPROCESSING ====================
    
    def preprocess_features(self, X: pd.DataFrame, fit: bool = False) -> pd.DataFrame:
        """
        Preprocess features for ML model
        
        Args:
            X: Feature dataframe
            fit: Whether to fit scaler (True for training, False for inference)
            
        Returns:
            Scaled feature dataframe
        """
        # Handle missing values (AML-safe imputation)
        X_clean = X.copy()
        
        # Identify column types
        if fit:
            self.numeric_cols = X_clean.select_dtypes(include=['number']).columns.tolist()
            self.categorical_cols = X_clean.select_dtypes(exclude=['number']).columns.tolist()
            self.feature_names = list(X_clean.columns)
        
        # Imputation
        if self.config['impute_strategy'] == 'median':
            # Numeric: median
            num_cols = self.numeric_cols if self.numeric_cols is not None else X_clean.select_dtypes(include=['number']).columns.tolist()
            for col in num_cols:
                if col in X_clean.columns and X_clean[col].isna().any():
                    median_val = X_clean[col].median()
                    if pd.isna(median_val):
                        median_val = 0.0
                    X_clean[col].fillna(median_val, inplace=True)
            
            # Categorical: mode or 'MISSING'
            cat_cols = self.categorical_cols if self.categorical_cols is not None else X_clean.select_dtypes(exclude=['number']).columns.tolist()
            for col in cat_cols:
                if col in X_clean.columns:
                     if X_clean[col].isna().any():
                        mode_val = X_clean[col].mode()[0] if not X_clean[col].mode().empty else 'MISSING'
                        X_clean[col].fillna(mode_val, inplace=True)
        
        # Scaling strategy
        if fit:
            if self.config['use_robust_scaling']:
                self.scaler = RobustScaler()
            else:
                self.scaler = StandardScaler()
            
            if self.numeric_cols:
                self.scaler_feature_names = list(self.numeric_cols)
                X_num = X_clean[self.numeric_cols].copy()
                X_num = X_num.fillna(0.0)
                X_clean[self.numeric_cols] = self.scaler.fit_transform(X_num)
        else:
            if self.scaler is None:
                raise ValueError("Scaler not fitted. Call preprocess_features with fit=True first.")
            
            scaler_cols = getattr(self.scaler, 'feature_names_in_', None)
            if scaler_cols is not None:
                if hasattr(scaler_cols, 'tolist'):
                    expected_num_cols = list(scaler_cols.tolist())
                else:
                    expected_num_cols = list(scaler_cols)
            elif self.scaler_feature_names:
                expected_num_cols = list(self.scaler_feature_names)
            elif self.numeric_cols:
                expected_num_cols = list(self.numeric_cols)
            else:
                expected_num_cols = []
            if expected_num_cols:
                for col in expected_num_cols:
                    if col not in X_clean.columns:
                        X_clean[col] = 0.0
                X_num = X_clean[expected_num_cols].copy()
                X_num = X_num.fillna(0.0)
                X_clean[expected_num_cols] = self.scaler.transform(X_num)
        
        # Convert categoricals to category dtype for LightGBM
        cat_cols = self.categorical_cols if self.categorical_cols is not None else X_clean.select_dtypes(exclude=['number']).columns.tolist()
        for col in cat_cols:
            if col in X_clean.columns:
                if X_clean[col].isna().any():
                    mode_val = X_clean[col].mode()[0] if not X_clean[col].mode().empty else 'MISSING'
                    X_clean[col].fillna(mode_val, inplace=True)
                X_clean[col] = X_clean[col].astype('category')
        
        return X_clean
    
    # ==================== MODEL TRAINING ====================
    
    def train(self, dataset: pd.DataFrame, validation_split: float = 0.2) -> Dict:
        """
        Train ML model with cross-validation and performance tracking
        
        Args:
            dataset: Prepared dataset with features and labels
            validation_split: Holdout validation set size
            
        Returns:
            Training metrics and diagnostics
        """
        # Separate features and labels
        feature_cols = [c for c in dataset.columns if c not in ['is_mule', 'account_id']]
        X = dataset[feature_cols]
        y = dataset['is_mule']
        
        # Time-aware split (AML best practice)
        # Assumption: Dataset is chronologically ordered by account_open_date
        split_idx = int(len(X) * (1 - validation_split))
        X_train, X_val = X.iloc[:split_idx], X.iloc[split_idx:]
        y_train, y_val = y.iloc[:split_idx], y.iloc[split_idx:]
        
        # Preprocess
        X_train_scaled = self.preprocess_features(X_train, fit=True)
        X_val_scaled = self.preprocess_features(X_val, fit=False)
        
        # Train LightGBM with early stopping
        print(f"Training on {len(X_train)} samples, validating on {len(X_val)} samples")
        print(f"Class distribution - Train: {y_train.value_counts().to_dict()}")
        
        self.model = lgb.LGBMClassifier(
            boosting_type=self.config['boosting_type'],
            objective=self.config['objective'],
            num_leaves=self.config['num_leaves'],
            max_depth=self.config['max_depth'],
            learning_rate=self.config['learning_rate'],
            n_estimators=self.config['n_estimators'],
            subsample=self.config['subsample'],
            colsample_bytree=self.config['colsample_bytree'],
            min_child_samples=self.config['min_child_samples'],
            reg_alpha=self.config['reg_alpha'],
            reg_lambda=self.config['reg_lambda'],
            scale_pos_weight=self.config['scale_pos_weight'],
            random_state=self.config['random_state'],
            verbose=self.config['verbose']
        )
        
        self.model.fit(
            X_train_scaled, y_train,
            eval_set=[(X_val_scaled, y_val)],
            eval_metric='auc',
            callbacks=[
                lgb.early_stopping(stopping_rounds=self.config['early_stopping_rounds']),
                lgb.log_evaluation(period=0)
            ]
        )
        
        # Compute metrics
        y_train_pred_proba = self.model.predict_proba(X_train_scaled)[:, 1]
        y_val_pred_proba = self.model.predict_proba(X_val_scaled)[:, 1]
        
        # AML-focused threshold: Optimize for recall
        precision, recall, thresholds = precision_recall_curve(y_val, y_val_pred_proba)
        
        # Find threshold that achieves 90%+ recall
        recall_target = 0.90
        # Note: sklearn returns len(thresholds) = len(precision) - 1
        recall = recall[:-1]
        precision = precision[:-1]

        valid_thresholds = thresholds[recall >= recall_target]
        
        if len(valid_thresholds) > 0:
            optimal_threshold = valid_thresholds[0]
        else:
            # Fallback: Use threshold with highest F2 score (weights recall 2x)
            f2_scores = (5 * precision * recall) / (4 * precision + recall + 1e-10)
            optimal_threshold = thresholds[np.argmax(f2_scores)]
        
        y_val_pred = (y_val_pred_proba >= optimal_threshold).astype(int)
        
        metrics = {
            'train_auc': roc_auc_score(y_train, y_train_pred_proba),
            'val_auc': roc_auc_score(y_val, y_val_pred_proba),
            'val_recall': recall_score(y_val, y_val_pred),
            'val_precision': precision_score(y_val, y_val_pred),
            'val_f1': f1_score(y_val, y_val_pred),
            'optimal_threshold': float(optimal_threshold),
            'confusion_matrix': confusion_matrix(y_val, y_val_pred).tolist(),
            'classification_report': classification_report(y_val, y_val_pred, output_dict=True),
            'feature_importance': self._compute_feature_importance()
        }
        
        # Initialize SHAP explainer
        self.explainer = shap.TreeExplainer(self.model)
        
        # Track metrics
        self.metrics_history.append({
            'timestamp': datetime.now().isoformat(),
            'metrics': metrics
        })
        
        print(f"\n=== Training Complete ===")
        print(f"Validation AUC: {metrics['val_auc']:.3f}")
        print(f"Validation Recall: {metrics['val_recall']:.3f}")
        print(f"Validation Precision: {metrics['val_precision']:.3f}")
        print(f"Optimal Threshold: {metrics['optimal_threshold']:.3f}")
        
        return metrics
    
    def cross_validate(self, dataset: pd.DataFrame) -> Dict:
        """
        Stratified K-Fold cross-validation for robust performance estimate
        """
        feature_cols = [c for c in dataset.columns if c not in ['is_mule', 'account_id']]
        X = dataset[feature_cols]
        y = dataset['is_mule']
        
        skf = StratifiedKFold(
            n_splits=self.config['cv_folds'], 
            shuffle=True, 
            random_state=self.config['random_state']
        )
        
        cv_scores = {
            'auc': [],
            'recall': [],
            'precision': [],
            'f1': []
        }
        
        for fold, (train_idx, val_idx) in enumerate(skf.split(X, y)):
            print(f"Training fold {fold + 1}/{self.config['cv_folds']}")
            
            X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
            y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]
            
            # Preprocess
            X_train_scaled = self.preprocess_features(X_train, fit=True)
            X_val_scaled = self.preprocess_features(X_val, fit=False)
            
            # Train fold model
            fold_model = lgb.LGBMClassifier(
                boosting_type=self.config['boosting_type'],
                num_leaves=self.config['num_leaves'],
                learning_rate=self.config['learning_rate'],
                n_estimators=self.config['n_estimators'],
                scale_pos_weight=self.config['scale_pos_weight'],
                random_state=self.config['random_state'],
                verbose=self.config['verbose']
            )
            
            fold_model.fit(X_train_scaled, y_train)
            
            # Predict
            y_val_pred_proba = fold_model.predict_proba(X_val_scaled)[:, 1]
            y_val_pred = (y_val_pred_proba >= 0.5).astype(int)
            
            # Metrics
            cv_scores['auc'].append(roc_auc_score(y_val, y_val_pred_proba))
            cv_scores['recall'].append(recall_score(y_val, y_val_pred))
            cv_scores['precision'].append(precision_score(y_val, y_val_pred))
            cv_scores['f1'].append(f1_score(y_val, y_val_pred))
        
        # Aggregate
        cv_results = {
            metric: {
                'mean': np.mean(scores),
                'std': np.std(scores),
                'scores': scores
            }
            for metric, scores in cv_scores.items()
        }
        
        print(f"\n=== Cross-Validation Results ===")
        for metric, stats in cv_results.items():
            print(f"{metric.upper()}: {stats['mean']:.3f} (±{stats['std']:.3f})")
        
        return cv_results
    
    def _compute_feature_importance(self) -> Dict:
        """Compute global feature importance"""
        if self.model is None:
            return {}
        
        importances = self.model.feature_importances_
        feature_importance = dict(zip(self.feature_names, importances))
        
        # Sort by importance
        return dict(sorted(feature_importance.items(), key=lambda x: x[1], reverse=True))
    
    # ==================== INFERENCE ====================
    
    def predict(self, feature_dict: Dict, account_meta: Optional[Dict] = None) -> Dict:
        """
        Predict mule risk score for a single account
        
        Args:
            feature_dict: Output from FeatureEngine
            account_meta: Optional account metadata
            
        Returns:
            {
                'mule_risk_score': float (0-100),
                'risk_level': str ('LOW', 'MEDIUM', 'HIGH'),
                'raw_probability': float,
                'confidence': float,
                'top_features': List[Dict],
                'shap_explanation': Dict
            }
        """
        if self.model is None:
            raise ValueError("Model not trained. Call train() first.")
        
        # Prepare features
        features = self.prepare_features(feature_dict, account_meta)
        X = pd.DataFrame([features])
        
        if not self.feature_names:
            raise ValueError("Model metadata missing feature names.")
        
        X_features = X.reindex(columns=self.feature_names)
        
        # Preprocess
        X_scaled = self.preprocess_features(X_features, fit=False)
        
        # Predict probability
        prob = self.model.predict_proba(X_scaled)[0, 1]
        
        # Normalize to 0-100 scale
        mule_risk_score = prob * 100
        
        # Risk level
        if mule_risk_score >= 65:
            risk_level = 'HIGH'
        elif mule_risk_score >= 35:
            risk_level = 'MEDIUM'
        else:
            risk_level = 'LOW'
        
        # SHAP explanation
        shap_values = self.explainer.shap_values(X_scaled)
        
        # Top contributing features
        if isinstance(shap_values, list):
            shap_values = shap_values[1]  # For binary classification
        
        feature_contributions = []
        for idx, feat_name in enumerate(self.feature_names):
            val = X_features.iloc[0].get(feat_name)
            try:
                val = float(val) if val is not None and not (isinstance(val, float) and np.isnan(val)) else 0.0
            except Exception:
                val = 0.0
            feature_contributions.append({
                'feature': feat_name,
                'value': val,
                'shap_value': float(shap_values[0][idx]),
                'contribution': abs(float(shap_values[0][idx]))
            })
        
        # Sort by absolute contribution
        feature_contributions = sorted(
            feature_contributions, 
            key=lambda x: x['contribution'], 
            reverse=True
        )
        
        top_features = feature_contributions[:5]
        
        # Confidence estimate (based on prediction margin)
        # Higher margin = higher confidence
        probs = self.model.predict_proba(X_scaled)[0]
        confidence = abs(probs[1] - probs[0]) * 100  # 0-100 scale
        
        return {
            'mule_risk_score': float(mule_risk_score),
            'risk_level': risk_level,
            'raw_probability': float(prob),
            'confidence': float(confidence),
            'top_features': top_features,
            'shap_explanation': {
                'base_value': float(self.explainer.expected_value[1] if isinstance(self.explainer.expected_value, list) else self.explainer.expected_value),
                'feature_contributions': feature_contributions
            }
        }
    
    def batch_predict(self, feature_dicts: List[Dict], 
                     account_metas: Optional[List[Dict]] = None) -> List[Dict]:
        """Batch inference for all accounts"""
        if account_metas is None:
            account_metas = [None] * len(feature_dicts)
        
        predictions = []
        for feat_dict, acc_meta in zip(feature_dicts, account_metas):
            pred = self.predict(feat_dict, acc_meta)
            predictions.append(pred)
        
        return predictions
    
    # ==================== MODEL PERSISTENCE ====================
    
    def save_model(self, version: str = "v1"):
        """Save model, scaler, and metadata"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        version_dir = os.path.join(self.model_dir, f"{version}_{timestamp}")
        os.makedirs(version_dir, exist_ok=True)
        
        # Save model
        model_path = os.path.join(version_dir, "model.pkl")
        joblib.dump(self.model, model_path)
        
        # Save scaler
        scaler_path = os.path.join(version_dir, "scaler.pkl")
        joblib.dump(self.scaler, scaler_path)
        
        # Save metadata
        metadata = {
            'version': version,
            'timestamp': timestamp,
            'feature_names': self.feature_names,
            'numeric_cols': self.numeric_cols,
            'categorical_cols': self.categorical_cols,
            'config': self.config,
            'metrics_history': self.metrics_history
        }
        
        
        # Convert numpy types to native Python types for JSON serialization
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
        
        metadata = convert_numpy_types(metadata)
        
        metadata_path = os.path.join(version_dir, "metadata.json")
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        print(f"Model saved to {version_dir}")
        
        return version_dir
    
    def load_model(self, version_dir: str):
        """Load model from directory"""
        model_path = os.path.join(version_dir, "model.pkl")
        scaler_path = os.path.join(version_dir, "scaler.pkl")
        metadata_path = os.path.join(version_dir, "metadata.json")
        
        self.model = joblib.load(model_path)
        self.scaler = joblib.load(scaler_path)
        
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
        
        self.feature_names = metadata['feature_names']
        self.numeric_cols = metadata.get('numeric_cols')
        self.categorical_cols = metadata.get('categorical_cols')
        self.config = metadata['config']
        self.metrics_history = metadata['metrics_history']
        
        # Reinitialize explainer
        self.explainer = shap.TreeExplainer(self.model)
        
        print(f"Model loaded from {version_dir}")
    
    # ==================== MONITORING & DIAGNOSTICS ====================
    
    def detect_feature_drift(self, new_data: pd.DataFrame, 
                            reference_data: pd.DataFrame) -> Dict:
        """
        Detect feature distribution drift using KS test
        
        Critical for AML: Mule tactics evolve, features drift
        """
        from scipy.stats import ks_2samp
        
        drift_results = {}
        
        for col in new_data.columns:
            if col in ['is_mule', 'account_id']:
                continue
            
            # KS test
            stat, p_value = ks_2samp(
                reference_data[col].dropna(), 
                new_data[col].dropna()
            )
            
            # Drift detected if p < 0.05
            drift_detected = p_value < 0.05
            
            drift_results[col] = {
                'ks_statistic': float(stat),
                'p_value': float(p_value),
                'drift_detected': drift_detected,
                'severity': 'HIGH' if p_value < 0.01 else 'MEDIUM' if p_value < 0.05 else 'LOW'
            }
        
        # Summary
        drifted_features = [k for k, v in drift_results.items() if v['drift_detected']]
        
        summary = {
            'total_features': len(drift_results),
            'drifted_features_count': len(drifted_features),
            'drifted_features': drifted_features,
            'drift_percentage': len(drifted_features) / len(drift_results) * 100,
            'details': drift_results
        }
        
        return summary
    
    def get_model_health(self) -> Dict:
        """Get model health diagnostics"""
        if not self.metrics_history:
            return {'status': 'NO_HISTORY', 'message': 'Model not trained yet'}
        
        latest_metrics = self.metrics_history[-1]['metrics']
        
        # Health checks
        health_checks = {
            'auc_acceptable': latest_metrics['val_auc'] >= 0.75,
            'recall_acceptable': latest_metrics['val_recall'] >= 0.85,
            'not_overfitting': (latest_metrics['train_auc'] - latest_metrics['val_auc']) < 0.10
        }
        
        overall_health = all(health_checks.values())
        
        return {
            'status': 'HEALTHY' if overall_health else 'DEGRADED',
            'checks': health_checks,
            'latest_metrics': latest_metrics,
            'training_history': self.metrics_history
        }


# ==================== USAGE EXAMPLE ====================

if __name__ == "__main__":
    """
    Example usage demonstrating full ML pipeline
    """
    from feature_engine import MuleFeatureEngine
    
    # Initialize engines
    feature_engine = MuleFeatureEngine()
    ml_engine = MuleMLEngine()
    
    # Load data
    accounts_df = pd.read_csv("data/accounts.csv")
    transactions_df = pd.read_csv("data/transactions.csv")
    
    # Prepare dataset
    print("Preparing dataset...")
    dataset = ml_engine.prepare_dataset(accounts_df, transactions_df, feature_engine)
    
    # Train model
    print("\nTraining model...")
    metrics = ml_engine.train(dataset, validation_split=0.2)
    
    # Cross-validation
    print("\nCross-validating...")
    cv_results = ml_engine.cross_validate(dataset)
    
    # Save model
    model_path = ml_engine.save_model(version="v1.0")
    
    # Inference example
    print("\nTesting inference...")
    test_account = accounts_df.iloc[0]
    feature_dict = feature_engine.compute_account_features(
        transactions_df, 
        test_account['account_id'],
        test_account.to_dict()
    )
    
    prediction = ml_engine.predict(feature_dict, test_account.to_dict())
    
    print(f"\nPrediction for {test_account['account_id']}:")
    print(f"  Mule Risk Score: {prediction['mule_risk_score']:.1f}")
    print(f"  Risk Level: {prediction['risk_level']}")
    print(f"  Confidence: {prediction['confidence']:.1f}%")
    print(f"\n  Top Contributing Features:")
    for feat in prediction['top_features']:
        print(f"    - {feat['feature']}: {feat['shap_value']:.3f}")
