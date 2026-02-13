import pandas as pd
import numpy as np
import pickle
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional
import warnings
warnings.filterwarnings('ignore')

# ML Libraries
from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import (accuracy_score, precision_score, recall_score, 
                            f1_score, roc_auc_score, roc_curve, confusion_matrix,
                            classification_report)
from sklearn.feature_selection import SelectFromModel
from services.mule_detection.model_training.trainers import get_trainer

try:
    from imblearn.over_sampling import SMOTE
except Exception:
    SMOTE = None

try:
    import shap
except Exception:
    shap = None

class ModelPipeline:
    def __init__(self, model_dir='models/trained_models'):
        self.model_dir = Path(model_dir)
        self.model_dir.mkdir(parents=True, exist_ok=True)
        
        self.current_model = None
        self.model_version = None
        self.feature_columns = None
        self.scaler = StandardScaler()
        self.label_encoder = LabelEncoder()
        self.last_correlated_dropped = []
        self.last_corr_threshold = None
        self.last_corr_heatmap = None
        
        # Experiment tracking
        self.experiment_log = self._load_experiment_log()
    
    def train(
        self,
        data: pd.DataFrame,
        model_type: str = 'xgboost',
        test_size: float = 0.2,
        use_smote: bool = True,
        model_params: Optional[Dict[str, Any]] = None,
        cv_folds: int = 5,
        random_state: int = 42,
    ) -> Dict:
        """Train money mule detection model"""
        
        print(f"Training {model_type} model...")
        
        # Prepare data
        X, y, feature_names = self._prepare_data(data)

        model_type = str(model_type or '').strip().lower()
        y_unique = np.unique(y)
        if model_type in ['xgboost', 'randomforest', 'logistic', 'lightgbm', 'lgbm'] and len(y_unique) < 2:
            raise ValueError("Supervised training requires both classes in is_mule. Upload labels or use an unsupervised algorithm.")
        
        # Handle class imbalance
        if use_smote and SMOTE is not None and sum(y) < len(y) * 0.3:  # If mules < 30%
            smote = SMOTE(random_state=random_state)
            X, y = smote.fit_resample(X, y)
            print(f"Applied SMOTE. New class distribution: {np.bincount(y)}")
        elif use_smote and SMOTE is None:
            print("SMOTE is not available; continuing without oversampling.")
        
        class_counts = np.bincount(y.astype(int)) if len(y) else np.array([])
        min_class = int(class_counts.min()) if len(class_counts) else 0
        use_stratify = len(y_unique) > 1 and min_class >= 2
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=random_state, stratify=y if use_stratify else None
        )
        
        # Scale features
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)
        
        trainer = get_trainer(model_type)
        r = trainer.train(X_train_scaled, y_train, cv_folds=cv_folds, random_state=random_state, model_params=model_params)
        model = r.model
        
        # Evaluate
        metrics = self._evaluate_model(model, X_test_scaled, y_test, X_train_scaled, y_train)
        
        # Feature importance
        feature_importance = self._get_feature_importance(model, feature_names)
        
        # Save model
        training_config = {
            "model_type": model_type,
            "test_size": float(test_size),
            "use_smote": bool(use_smote),
            "cv_folds": int(cv_folds),
            "random_state": int(random_state),
        }
        model_version = self._save_model(
            model=model,
            model_type=model_type,
            metrics=metrics,
            features=feature_names,
            feature_importance=feature_importance,
            model_params=model_params or {},
            training_config=training_config
        )
        
        # Log experiment
        self._log_experiment(
            model_version=model_version,
            model_type=model_type,
            metrics=metrics,
            features_used=feature_names,
            feature_importance=feature_importance
        )
        
        self.current_model = model
        self.model_version = model_version
        self.feature_columns = feature_names
        
        return {
            'model_version': model_version,
            'metrics': metrics,
            'feature_importance': feature_importance,
            'features_used': feature_names,
            'model_type': model_type,
            'hyperparams': model_params or {},
            'training_config': training_config
        }
    
    def _prepare_data(self, data: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray, List[str]]:
        """Prepare data for training"""
        
        # Separate features and target
        if 'is_mule' in data.columns:
            y = pd.to_numeric(data['is_mule'], errors='coerce').fillna(0).astype(int).values
            X = data.drop(['is_mule', 'account_id'], axis=1, errors='ignore')
        else:
            # If no label, create synthetic labels for unsupervised learning
            y = np.zeros(len(data))
            X = data.drop(['account_id'], axis=1, errors='ignore')
        
        X = X.replace([np.inf, -np.inf], np.nan)
        X = X.fillna(X.mean(numeric_only=True))
        
        # Convert categorical to numerical
        categorical_cols = X.select_dtypes(include=['object', 'category']).columns
        for col in categorical_cols:
            X[col] = self.label_encoder.fit_transform(X[col].astype(str).fillna("MISSING"))
        
        # Select numeric columns only
        numeric_cols = X.select_dtypes(include=[np.number]).columns
        X = X[numeric_cols]

        X = X.replace([np.inf, -np.inf], np.nan)
        for col in X.columns:
            s = pd.to_numeric(X[col], errors='coerce')
            s = s.replace([np.inf, -np.inf], np.nan)
            lo = s.quantile(0.001) if s.notna().any() else 0.0
            hi = s.quantile(0.999) if s.notna().any() else 0.0
            if pd.isna(lo):
                lo = 0.0
            if pd.isna(hi):
                hi = 0.0
            if lo > hi:
                lo, hi = hi, lo
            if lo != hi:
                s = s.clip(lo, hi)
            med = s.median()
            if pd.isna(med):
                med = 0.0
            X[col] = s.fillna(med)
        
        # Remove constant columns
        X = X.loc[:, X.nunique() > 1]
        
        # Remove highly correlated features
        X = self._remove_correlated_features(X)
        
        feature_names = X.columns.tolist()
        
        return X.values, y, feature_names
    
    def _remove_correlated_features(self, X: pd.DataFrame, threshold: float = 0.95) -> pd.DataFrame:
        """Remove highly correlated features"""
        self.last_correlated_dropped = []
        self.last_corr_threshold = float(threshold)
        self.last_corr_heatmap = None

        corr_matrix = X.corr(numeric_only=True).abs()
        upper = corr_matrix.where(np.triu(np.ones(corr_matrix.shape), k=1).astype(bool))

        to_drop = [column for column in upper.columns if any(upper[column] > threshold)]
        self.last_correlated_dropped = list(to_drop)

        keep_cols = [c for c in X.columns if c not in set(to_drop)]
        heat_cols = keep_cols[: min(len(keep_cols), 25)]
        if len(heat_cols) >= 2:
            cm = corr_matrix.loc[heat_cols, heat_cols].fillna(0.0)
            self.last_corr_heatmap = {
                "features": heat_cols,
                "matrix": cm.to_numpy(dtype=float).tolist(),
                "threshold": float(threshold),
            }

        if to_drop:
            print(f"Dropping highly correlated features: {to_drop}")
            X = X.drop(columns=to_drop)

        return X
    
    def _train_xgboost(self, X: np.ndarray, y: np.ndarray, model_params: Optional[Dict[str, Any]] = None, cv_folds: int = 5, random_state: int = 42):
        trainer = get_trainer("xgboost")
        r = trainer.train(X, y, cv_folds=cv_folds, random_state=random_state, model_params=model_params)
        if r.cv_mean_auc is not None:
            print(f"XGBoost CV ROC-AUC: {r.cv_mean_auc:.3f} (+/- {r.cv_std_auc:.3f})")
        return r.model
    
    def _train_random_forest(self, X: np.ndarray, y: np.ndarray, model_params: Optional[Dict[str, Any]] = None, cv_folds: int = 5, random_state: int = 42) -> RandomForestClassifier:
        trainer = get_trainer("randomforest")
        r = trainer.train(X, y, cv_folds=cv_folds, random_state=random_state, model_params=model_params)
        if r.cv_mean_auc is not None:
            print(f"Random Forest CV ROC-AUC: {r.cv_mean_auc:.3f} (+/- {r.cv_std_auc:.3f})")
        return r.model
    
    def _train_isolation_forest(self, X: np.ndarray, y: np.ndarray, model_params: Optional[Dict[str, Any]] = None, random_state: int = 42) -> IsolationForest:
        trainer = get_trainer("isolation_forest")
        r = trainer.train(X, y, cv_folds=2, random_state=random_state, model_params=model_params)
        return r.model
    
    def _evaluate_model(self, model, X_test: np.ndarray, y_test: np.ndarray,
                       X_train: np.ndarray = None, y_train: np.ndarray = None) -> Dict:
        """Evaluate model performance"""
        
        # Predictions
        if hasattr(model, 'predict_proba'):
            y_pred_proba = model.predict_proba(X_test)[:, 1]
            y_pred = (y_pred_proba > 0.5).astype(int)
        elif hasattr(model, 'decision_function'):
            y_pred_proba = model.decision_function(X_test)
            y_pred = (y_pred_proba > 0).astype(int)
        else:
            y_pred = model.predict(X_test)
            y_pred_proba = y_pred
        
        # Calculate metrics
        metrics = {
            'accuracy': accuracy_score(y_test, y_pred),
            'precision': precision_score(y_test, y_pred, zero_division=0),
            'recall': recall_score(y_test, y_pred, zero_division=0),
            'f1_score': f1_score(y_test, y_pred, zero_division=0),
            'roc_auc': roc_auc_score(y_test, y_pred_proba) if len(np.unique(y_test)) > 1 else 0,
            'confusion_matrix': confusion_matrix(y_test, y_pred).tolist()
        }

        if len(np.unique(y_test)) > 1:
            try:
                fpr, tpr, thresholds = roc_curve(y_test, y_pred_proba)
                metrics["roc_curve"] = {"fpr": fpr.tolist(), "tpr": tpr.tolist(), "thresholds": thresholds.tolist()}
            except Exception:
                pass
        
        # Calculate additional metrics if training data provided
        if X_train is not None and y_train is not None:
            if hasattr(model, 'predict_proba'):
                if len(np.unique(y_train)) > 1:
                    y_train_pred_proba = model.predict_proba(X_train)[:, 1]
                    metrics['train_roc_auc'] = roc_auc_score(y_train, y_train_pred_proba)
            else:
                y_train_pred = model.predict(X_train)
                metrics['train_accuracy'] = accuracy_score(y_train, y_train_pred)
        
        print("\nModel Evaluation Metrics:")
        for metric, value in metrics.items():
            if metric != 'confusion_matrix':
                print(f"{metric}: {value:.3f}")
        
        # Classification report
        print("\nClassification Report:")
        print(classification_report(y_test, y_pred, target_names=['Non-Mule', 'Mule']))
        
        return metrics
    
    def _get_feature_importance(self, model, feature_names: List[str]) -> Dict:
        """Extract feature importance"""
        
        if hasattr(model, 'feature_importances_'):
            importances = model.feature_importances_
        elif hasattr(model, 'coef_'):
            importances = np.abs(model.coef_[0])
        else:
            # For unsupervised models, use permutation importance
            importances = np.ones(len(feature_names))
        
        # Create feature importance dictionary
        importance_dict = dict(zip(feature_names, importances))
        
        # Sort by importance
        sorted_importance = sorted(importance_dict.items(), key=lambda x: x[1], reverse=True)
        
        return {
            'top_features': [f[0] for f in sorted_importance[:10]],
            'top_importance': [float(f[1]) for f in sorted_importance[:10]],
            'all_features': importance_dict
        }
    
    def _save_model(
        self,
        model,
        model_type: str,
        metrics: Dict,
        features: List[str],
        feature_importance: Dict,
        model_params: Dict[str, Any],
        training_config: Dict[str, Any],
    ) -> str:
        """Save trained model to disk"""
        
        # Generate version number
        version = self._get_next_version()
        model_name = f"mule_model_v{version}"
        model_path = self.model_dir / f"{model_name}.pkl"
        
        # Create model metadata
        metadata = {
            'model_version': version,
            'model_type': model_type,
            'training_date': datetime.now().isoformat(),
            'metrics': metrics,
            'features': features,
            'feature_importance': feature_importance,
            'model_params': model_params,
            'training_config': training_config,
            'scaler': self.scaler,
            'label_encoder': self.label_encoder
        }
        
        # Save model and metadata
        with open(model_path, 'wb') as f:
            pickle.dump({
                'model': model,
                'metadata': metadata
            }, f)
        
        print(f"Model saved as {model_name} at {model_path}")
        
        return model_name
    
    def _get_next_version(self) -> int:
        """Get next model version number"""
        
        versions = []
        for file in self.model_dir.glob('mule_model_v*.pkl'):
            try:
                version = int(file.stem.split('_v')[-1])
                versions.append(version)
            except:
                continue
        
        if versions:
            return max(versions) + 1
        else:
            return 1
    
    def _log_experiment(self, model_version: str, model_type: str, 
                       metrics: Dict, features_used: List[str],
                       feature_importance: Dict):
        """Log experiment to tracking CSV"""
        
        experiment = {
            'timestamp': datetime.now().isoformat(),
            'model_version': model_version,
            'model_type': model_type,
            'accuracy': metrics['accuracy'],
            'precision': metrics['precision'],
            'recall': metrics['recall'],
            'f1_score': metrics['f1_score'],
            'roc_auc': metrics.get('roc_auc', 0),
            'num_features': len(features_used),
            'top_feature': feature_importance['top_features'][0] if feature_importance['top_features'] else '',
            'top_feature_importance': feature_importance['top_importance'][0] if feature_importance['top_importance'] else 0
        }
        
        self.experiment_log.append(experiment)
        
        # Save to CSV
        df = pd.DataFrame(self.experiment_log)
        df.to_csv('models/model_tracker.csv', index=False)
        
        print(f"Experiment logged for {model_version}")
    
    def _load_experiment_log(self) -> List[Dict]:
        """Load experiment tracking log"""
        
        log_file = Path('models/model_tracker.csv')
        
        if log_file.exists():
            df = pd.read_csv(log_file)
            return df.to_dict('records')
        else:
            return []
    
    def load_model(self, model_version: str):
        """Load trained model"""
        
        model_path = self.model_dir / f"{model_version}.pkl"
        
        if not model_path.exists():
            raise FileNotFoundError(f"Model {model_version} not found")
        
        with open(model_path, 'rb') as f:
            model_data = pickle.load(f)
        
        self.current_model = model_data['model']
        self.model_version = model_version
        
        # Load scaler and label encoder
        self.scaler = model_data['metadata'].get('scaler', StandardScaler())
        self.label_encoder = model_data['metadata'].get('label_encoder', LabelEncoder())
        self.feature_columns = model_data['metadata'].get('features', [])
        
        print(f"Loaded model {model_version}")
        
        return model_data
    
    def get_experiment_history(self) -> List[Dict]:
        """Get experiment history"""
        return self.experiment_log
    
    def compare_models(self) -> pd.DataFrame:
        """Compare performance of all trained models"""
        
        if not self.experiment_log:
            return pd.DataFrame()
        
        df = pd.DataFrame(self.experiment_log)
        
        # Sort by ROC-AUC (or accuracy if ROC-AUC not available)
        sort_col = 'roc_auc' if 'roc_auc' in df.columns else 'accuracy'
        df = df.sort_values(sort_col, ascending=False)
        
        return df
    
    def predict(self, data: pd.DataFrame) -> np.ndarray:
        """Make predictions using current model"""
        
        if self.current_model is None:
            raise ValueError("No model loaded. Train or load a model first.")
        
        # Prepare data
        X = self._prepare_prediction_data(data)
        
        # Scale features
        X_scaled = self.scaler.transform(X)
        
        # Make predictions
        if hasattr(self.current_model, 'predict_proba'):
            predictions = self.current_model.predict_proba(X_scaled)[:, 1]
        elif hasattr(self.current_model, 'decision_function'):
            predictions = self.current_model.decision_function(X_scaled)
            # Normalize to 0-1 range
            predictions = (predictions - predictions.min()) / (predictions.max() - predictions.min())
        else:
            predictions = self.current_model.predict(X_scaled)
        
        return predictions
    
    def _prepare_prediction_data(self, data: pd.DataFrame) -> np.ndarray:
        """Prepare data for prediction"""
        
        # Select only the features used during training
        if self.feature_columns:
            missing_features = set(self.feature_columns) - set(data.columns)
            if missing_features:
                print(f"Warning: Missing features {missing_features}. Filling with 0.")
                for feature in missing_features:
                    data[feature] = 0
            
            # Select and order features correctly
            X = data[self.feature_columns]
        else:
            # Use all numeric features
            X = data.select_dtypes(include=[np.number])
        
        # Handle missing values
        X = X.fillna(X.mean(numeric_only=True))
        
        # Convert categorical to numerical
        categorical_cols = X.select_dtypes(include=['object', 'category']).columns
        for col in categorical_cols:
            try:
                X[col] = self.label_encoder.transform(X[col])
            except:
                # If new categories, assign -1
                X[col] = -1
        
        return X.values
    
    def get_model_metadata(self, model_version: str = None) -> Dict:
        """Get model metadata"""
        
        if model_version:
            model_path = self.model_dir / f"{model_version}.pkl"
            
            if not model_path.exists():
                raise FileNotFoundError(f"Model {model_version} not found")
            
            with open(model_path, 'rb') as f:
                model_data = pickle.load(f)
            
            return model_data['metadata']
        elif self.current_model and self.model_version:
            return self.load_model(self.model_version)['metadata']
        else:
            raise ValueError("No model specified or loaded")
