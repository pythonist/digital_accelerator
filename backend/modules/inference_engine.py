import pandas as pd
import numpy as np
from datetime import datetime
from typing import Dict, List, Any, Tuple
import pickle
from pathlib import Path

class InferenceEngine:
    def __init__(self, model_store_path='models/trained_models'):
        self.model_store_path = Path(model_store_path)
        self.loaded_models = {}
        self.current_model = None
        
    def load_model(self, model_version: str):
        """Load a trained model"""
        
        model_path = self.model_store_path / f"{model_version}.pkl"
        
        if not model_path.exists():
            raise FileNotFoundError(f"Model {model_version} not found")
        
        with open(model_path, 'rb') as f:
            model_data = pickle.load(f)
        
        self.loaded_models[model_version] = model_data
        self.current_model = model_data
        
        print(f"Loaded model: {model_version}")
        return model_data
    
    def predict(self, model, data: pd.DataFrame, 
                model_version: str = None) -> Tuple[np.ndarray, Dict]:
        """Make predictions using specified model"""
        
        if model_version and model_version in self.loaded_models:
            model_data = self.loaded_models[model_version]
        elif self.current_model:
            model_data = self.current_model
        else:
            raise ValueError("No model loaded. Please load a model first.")
        
        # Extract model and metadata
        ml_model = model_data['model']
        metadata = model_data['metadata']
        
        # Prepare features
        feature_columns = metadata.get('features', [])
        
        # Select and align features
        X = self._prepare_features(data, feature_columns, metadata)
        
        # Make predictions
        if hasattr(ml_model, 'predict_proba'):
            probabilities = ml_model.predict_proba(X)[:, 1]
        elif hasattr(ml_model, 'decision_function'):
            scores = ml_model.decision_function(X)
            # Normalize to 0-1 range
            probabilities = (scores - scores.min()) / (scores.max() - scores.min())
        else:
            probabilities = ml_model.predict(X)
        
        # Create prediction results
        results = self._create_prediction_results(data, probabilities, metadata)
        
        return probabilities, results
    
    def _prepare_features(self, data: pd.DataFrame, feature_columns: List[str], metadata: Dict | None = None) -> np.ndarray:
        """Prepare features for prediction"""
        
        # Create a copy
        X = data.copy()
        
        # Add missing features with default values
        for feature in feature_columns:
            if feature not in X.columns:
                X[feature] = 0
        
        # Select only the required features in correct order
        X = X[feature_columns]
        
        # Handle missing values
        X = X.replace([np.inf, -np.inf], np.nan)
        X = X.fillna(0)
        
        # Convert to numeric
        X = X.apply(pd.to_numeric, errors='coerce')
        X = X.replace([np.inf, -np.inf], np.nan)
        for col in X.columns:
            s = X[col]
            s = pd.to_numeric(s, errors='coerce').replace([np.inf, -np.inf], np.nan)
            if s.notna().any():
                lo = s.quantile(0.001)
                hi = s.quantile(0.999)
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
            else:
                X[col] = 0.0

        arr = X.values.astype(np.float64, copy=False)

        scaler = (metadata or {}).get("scaler") if metadata else None
        if scaler is not None and hasattr(scaler, "transform"):
            try:
                arr = scaler.transform(arr)
            except Exception:
                pass

        arr = np.asarray(arr)
        if not np.all(np.isfinite(arr)):
            arr = np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)

        return arr
    
    def _create_prediction_results(self, data: pd.DataFrame, 
                                  probabilities: np.ndarray,
                                  metadata: Dict) -> Dict:
        """Create structured prediction results"""
        
        results = {
            'timestamp': datetime.now().isoformat(),
            'model_version': metadata.get('model_version', 'unknown'),
            'model_type': metadata.get('model_type', 'unknown'),
            'predictions': [],
            'summary': {
                'total_accounts': len(data),
                'high_risk_count': 0,
                'medium_risk_count': 0,
                'low_risk_count': 0,
                'avg_risk_score': 0
            }
        }
        
        # Risk thresholds
        thresholds = metadata.get('risk_thresholds', {
            'high': 0.7,
            'medium': 0.3,
            'low': 0.0
        })
        
        high_threshold = thresholds.get('high', 0.7)
        medium_threshold = thresholds.get('medium', 0.3)
        
        for idx, (_, row) in enumerate(data.iterrows()):
            account_id = row.get('account_id', f'account_{idx}')
            probability = probabilities[idx] if idx < len(probabilities) else 0
            
            # Determine risk level
            if probability >= high_threshold:
                risk_level = 'High'
                results['summary']['high_risk_count'] += 1
            elif probability >= medium_threshold:
                risk_level = 'Medium'
                results['summary']['medium_risk_count'] += 1
            else:
                risk_level = 'Low'
                results['summary']['low_risk_count'] += 1
            
            # Create prediction record
            prediction = {
                'account_id': account_id,
                'ml_score': float(probability),
                'risk_level': risk_level,
                'prediction_timestamp': datetime.now().isoformat(),
                'features_used': list(data.columns) if idx == 0 else []  # Include once
            }
            
            # Add key features if available
            key_features = ['tx_count_24h', 'in_out_ratio', 'degree_centrality', 
                           'accounts_per_device', 'simple_cycle_flag']
            
            for feature in key_features:
                if feature in row:
                    prediction[feature] = float(row[feature])
            
            results['predictions'].append(prediction)
        
        # Calculate average risk score
        if len(probabilities) > 0:
            results['summary']['avg_risk_score'] = float(np.mean(probabilities))
        
        return results
    
    def batch_predict(self, data: pd.DataFrame, 
                     model_version: str = None,
                     batch_size: int = 1000) -> Dict:
        """Make predictions in batches for large datasets"""
        
        results = []
        
        # Split data into batches
        num_batches = len(data) // batch_size + (1 if len(data) % batch_size > 0 else 0)
        
        print(f"Processing {len(data)} records in {num_batches} batches...")
        
        for i in range(num_batches):
            start_idx = i * batch_size
            end_idx = min((i + 1) * batch_size, len(data))
            
            batch_data = data.iloc[start_idx:end_idx]
            
            print(f"Processing batch {i+1}/{num_batches} ({len(batch_data)} records)")
            
            try:
                probabilities, batch_results = self.predict(
                    model=self.current_model,
                    data=batch_data,
                    model_version=model_version
                )
                
                results.extend(batch_results['predictions'])
                
            except Exception as e:
                print(f"Error processing batch {i+1}: {e}")
                # Create default predictions for failed batch
                for idx in range(len(batch_data)):
                    results.append({
                        'account_id': batch_data.iloc[idx].get('account_id', f'account_{start_idx + idx}'),
                        'ml_score': 0.0,
                        'risk_level': 'Low',
                        'prediction_timestamp': datetime.now().isoformat(),
                        'error': str(e)
                    })
        
        # Create final results
        final_results = {
            'timestamp': datetime.now().isoformat(),
            'model_version': model_version or 'unknown',
            'total_predictions': len(results),
            'predictions': results,
            'batch_processing': True,
            'batch_size': batch_size
        }
        
        return final_results
    
    def ensemble_predict(self, data: pd.DataFrame, 
                        model_versions: List[str] = None) -> Dict:
        """Make predictions using ensemble of models"""
        
        if not model_versions:
            # Use all loaded models
            model_versions = list(self.loaded_models.keys())
        
        if not model_versions:
            raise ValueError("No models specified for ensemble")
        
        print(f"Running ensemble prediction with {len(model_versions)} models...")
        
        all_predictions = []
        model_weights = {}
        
        for model_version in model_versions:
            if model_version not in self.loaded_models:
                self.load_model(model_version)
            
            model_data = self.loaded_models[model_version]
            metadata = model_data['metadata']
            
            # Get model performance for weighting
            model_accuracy = metadata.get('metrics', {}).get('accuracy', 0.5)
            model_weights[model_version] = model_accuracy
            
            # Get predictions
            probabilities, _ = self.predict(
                model=model_data['model'],
                data=data,
                model_version=model_version
            )
            
            all_predictions.append(probabilities)
        
        # Calculate weighted average
        total_weight = sum(model_weights.values())
        ensemble_predictions = np.zeros(len(data))
        
        for model_version, predictions in zip(model_versions, all_predictions):
            weight = model_weights[model_version] / total_weight
            ensemble_predictions += predictions * weight
        
        # Create results
        results = self._create_prediction_results(data, ensemble_predictions, {
            'model_version': f'ensemble_{len(model_versions)}_models',
            'model_type': 'ensemble',
            'risk_thresholds': {'high': 0.7, 'medium': 0.3, 'low': 0.0}
        })
        
        # Add ensemble info
        results['ensemble_info'] = {
            'models_used': model_versions,
            'model_weights': model_weights,
            'ensemble_method': 'weighted_average'
        }
        
        return results
    
    def get_model_performance(self, model_version: str = None) -> Dict:
        """Get performance metrics for a model"""
        
        if model_version:
            if model_version not in self.loaded_models:
                self.load_model(model_version)
            model_data = self.loaded_models[model_version]
        elif self.current_model:
            model_data = self.current_model
        else:
            raise ValueError("No model specified or loaded")
        
        metadata = model_data['metadata']
        
        performance = {
            'model_version': metadata.get('model_version', 'unknown'),
            'model_type': metadata.get('model_type', 'unknown'),
            'training_date': metadata.get('training_date', 'unknown'),
            'metrics': metadata.get('metrics', {}),
            'feature_importance': metadata.get('feature_importance', {}),
            'num_features': len(metadata.get('features', [])),
            'top_features': metadata.get('feature_importance', {}).get('top_features', [])
        }
        
        return performance
    
    def list_available_models(self) -> List[Dict]:
        """List all available trained models"""
        
        models = []
        
        for model_file in self.model_store_path.glob('mule_model_v*.pkl'):
            try:
                with open(model_file, 'rb') as f:
                    model_data = pickle.load(f)
                
                metadata = model_data['metadata']
                
                models.append({
                    'model_version': metadata.get('model_version', model_file.stem),
                    'model_type': metadata.get('model_type', 'unknown'),
                    'training_date': metadata.get('training_date', 'unknown'),
                    'accuracy': metadata.get('metrics', {}).get('accuracy', 0),
                    'precision': metadata.get('metrics', {}).get('precision', 0),
                    'recall': metadata.get('metrics', {}).get('recall', 0),
                    'roc_auc': metadata.get('metrics', {}).get('roc_auc', 0),
                    'file_size': model_file.stat().st_size,
                    'features_count': len(metadata.get('features', []))
                })
                
            except Exception as e:
                print(f"Error loading model {model_file}: {e}")
        
        # Sort by model version (descending)
        models.sort(key=lambda x: x['model_version'], reverse=True)
        
        return models
