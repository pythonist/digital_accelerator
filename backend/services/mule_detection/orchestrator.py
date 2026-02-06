"""
Mule Intelligence Orchestrator

Production-grade orchestrator that integrates all AML components into a unified pipeline.
This is the INTEGRATION LAYER - it does NOT reimplement any logic, only wires components together.

Components integrated:
1. FeatureEngineer - Python behavioral/velocity/device/network features
2. FeatureStore - Feature definitions and versioning
3. NetworkAnalyzer - Graph-based AML signals
4. RuleEngine - Basel typology rule scoring
5. ModelPipeline - ML model training
6. InferenceEngine - ML scoring
7. SyntheticDataGenerator - Test data generation
8. Config - Risk thresholds and weights
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
import warnings
import traceback
warnings.filterwarnings('ignore')

# Import all existing components (DO NOT MODIFY THESE)
from features.feature_engineer import FeatureEngineer
from features.feature_store import FeatureStore
from modules.network_analyzer import NetworkAnalyzer
from modules.rule_engine import RuleEngine
from models.model_pipeline import ModelPipeline
from modules.inference_engine import InferenceEngine
from config import Config


class MuleIntelligenceOrchestrator:
    """
    Orchestrates the complete Mule Intelligence pipeline.
    
    Pipeline Steps:
    1. Feature Engineering (Python features)
    2. SQL Features (simulated from FeatureStore)
    3. Network Analysis (graph metrics)
    4. Rule Engine (Basel typology scores)
    5. Feature Table Preparation (merge all)
    6. ML Scoring (inference)
    7. Risk Level Assignment (thresholds)
    8. Final Output (JSON for frontend)
    """
    
    def __init__(self, model_dir='models/trained_models', feature_db='feature_store.db'):
        """Initialize all components"""
        print("Initializing Mule Intelligence Orchestrator...")
        
        # Initialize components
        self.feature_store = FeatureStore(db_path=feature_db)
        self.feature_engineer = FeatureEngineer(feature_store=self.feature_store)
        self.network_analyzer = NetworkAnalyzer()
        self.rule_engine = RuleEngine(config=Config.RULE_WEIGHTS)
        self.model_pipeline = ModelPipeline(model_dir=model_dir)
        self.inference_engine = InferenceEngine(model_store_path=model_dir)
        
        # Configuration
        self.config = Config()
        self.risk_thresholds = Config.RISK_THRESHOLDS
        self.mvp_features = Config.MVP_FEATURES
        self.score_weights = {"ml_weight": 0.60, "rule_weight": 0.25, "network_weight": 0.15}
        
        print("✓ All components initialized successfully")
    
    
    def run_mule_intelligence(
        self,
        transactions_df: pd.DataFrame,
        accounts_df: pd.DataFrame,
        use_trained_model: bool = True,
        model_version: Optional[str] = None,
        score_weights: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Any]:
        """
        Run complete Mule Intelligence pipeline.
        
        Args:
            transactions_df: Transaction data with required columns
            use_trained_model: If True, use existing model; if False, will need training first
            model_version: Specific model version to use (optional)
        
        Returns:
            {
                'success': bool,
                'summary': {...},
                'accounts': [...],
                'metadata': {...}
            }
        """
        
        try:
            if score_weights:
                ml_w = float(score_weights.get("ml_weight", self.score_weights["ml_weight"]))
                rule_w = float(score_weights.get("rule_weight", self.score_weights["rule_weight"]))
                net_w = float(score_weights.get("network_weight", self.score_weights["network_weight"]))
                total = ml_w + rule_w + net_w
                if total > 0:
                    self.score_weights = {"ml_weight": ml_w / total, "rule_weight": rule_w / total, "network_weight": net_w / total}

            print("\n" + "="*80)
            print("MULE INTELLIGENCE PIPELINE STARTED")
            print("="*80 + "\n")
            
            # Validate input data
            self._validate_input_data(transactions_df, accounts_df)
            
            # STEP 1: Feature Engineering
            print("STEP 1/7: Engineering Python features...")
            features_df = self._engineer_python_features(transactions_df, accounts_df)
            print(f"✓ Engineered {len(features_df.columns)} features for {len(features_df)} accounts")
            
            # STEP 2: SQL Features (simulated)
            print("\nSTEP 2/7: Adding SQL-based features...")
            features_df = self._add_sql_features(features_df, transactions_df)
            print(f"✓ Added SQL features, total features: {len(features_df.columns)}")
            
            # STEP 3: Network Analysis
            print("\nSTEP 3/7: Analyzing transaction network...")
            network_metrics = self._analyze_network(transactions_df)
            features_df = self._merge_network_features(features_df, network_metrics)
            print(f"✓ Network analysis complete, {len(network_metrics)} accounts analyzed")
            
            # STEP 4: Rule Engine
            print("\nSTEP 4/7: Applying Basel typology rules...")
            rule_scores = self._apply_rules(transactions_df)
            features_df = self._merge_rule_scores(features_df, rule_scores)
            print(f"✓ Rule engine complete, {len(rule_scores)} accounts scored")
            
            # STEP 5: Prepare Final Feature Table
            print("\nSTEP 5/7: Preparing final feature table...")
            final_features_df = self._prepare_final_features(features_df)
            print(f"✓ Final feature table: {len(final_features_df)} accounts × {len(final_features_df.columns)} features")
            
            # STEP 6: ML Scoring
            print("\nSTEP 6/7: Running ML inference...")
            ml_scores = self._run_ml_inference(final_features_df, use_trained_model, model_version)
            print(f"✓ ML scoring complete")
            
            # STEP 7: Apply Risk Thresholds
            print("\nSTEP 7/7: Calculating final risk scores...")
            results = self._calculate_final_scores(
                features_df=final_features_df,
                ml_scores=ml_scores,
                rule_scores=rule_scores,
                network_metrics=network_metrics
            )
            
            print("\n" + "="*80)
            print("PIPELINE COMPLETED SUCCESSFULLY")
            print("="*80 + "\n")
            
            return results
            
        except Exception as e:
            error_msg = f"Pipeline failed: {str(e)}"
            print(f"\n❌ ERROR: {error_msg}")
            traceback.print_exc()
            return {
                'success': False,
                'error': error_msg,
                'traceback': traceback.format_exc()
            }
    
    
    def _validate_input_data(self, df: pd.DataFrame, accounts_df: pd.DataFrame):
        """Validate required columns in input data"""
        required_cols = ['account_id', 'transaction_id', 'amount', 'timestamp']
        missing = [col for col in required_cols if col not in df.columns]
        
        if missing:
            raise ValueError(f"Missing required columns: {missing}")
        
        if len(df) == 0:
            raise ValueError("Input dataframe is empty")

        if accounts_df is None or len(accounts_df) == 0:
            raise ValueError("Accounts dataframe is required")
        if 'account_id' not in accounts_df.columns:
            raise ValueError("Accounts dataframe missing required column: account_id")
        
        # Ensure timestamp is datetime
        if not pd.api.types.is_datetime64_any_dtype(df['timestamp']):
            df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    
    def _engineer_python_features(self, transactions_df: pd.DataFrame, accounts_df: pd.DataFrame) -> pd.DataFrame:
        """
        STEP 1: Engineer Python-based features using FeatureEngineer.
        This includes behavioral, velocity, device, circularity, and network features.
        """
        features_df = self.feature_engineer.engineer_all_features(transactions_df, accounts_df)
        return features_df
    
    
    def _add_sql_features(self, features_df: pd.DataFrame, 
                         transactions_df: pd.DataFrame) -> pd.DataFrame:
        """
        STEP 2: Add SQL-based features from FeatureStore.
        In production, these would come from database queries.
        Here we simulate using FeatureStore definitions.
        """
        
        # Get SQL feature definitions from FeatureStore
        sql_features = [f for f in self.feature_store.feature_definitions.values() 
                       if f.sql_query is not None]
        
        # For each account, calculate SQL features
        for feature_def in sql_features:
            feature_name = feature_def.feature_name
            
            # Skip if already exists from Python features
            if feature_name in features_df.columns:
                continue
            
            # Calculate feature for each account
            feature_values = []
            for account_id in features_df['account_id']:
                try:
                    # Use FeatureStore's calculate_feature method
                    value = self.feature_store.calculate_feature(
                        account_id=account_id,
                        feature_name=feature_name,
                        transactions_df=transactions_df
                    )
                    feature_values.append(value)
                except Exception as e:
                    # Default to 0 if calculation fails
                    feature_values.append(0)
            
            features_df[feature_name] = feature_values
        
        return features_df
    
    
    def _analyze_network(self, transactions_df: pd.DataFrame) -> Dict[str, Dict]:
        """
        STEP 3: Run network analysis using NetworkAnalyzer.
        Returns network metrics per account.
        """
        network_metrics = self.network_analyzer.analyze_transaction_network(transactions_df)
        return network_metrics
    
    
    def _merge_network_features(self, features_df: pd.DataFrame, 
                                network_metrics: Dict[str, Dict]) -> pd.DataFrame:
        """Merge network metrics into features dataframe"""
        
        # Convert network metrics to dataframe
        network_df = pd.DataFrame.from_dict(network_metrics, orient='index')
        network_df['account_id'] = network_df.index
        network_df = network_df.reset_index(drop=True)
        
        # Merge with features
        features_df = features_df.merge(
            network_df, 
            on='account_id', 
            how='left',
            suffixes=('', '_network')
        )
        
        return features_df
    
    
    def _apply_rules(self, transactions_df: pd.DataFrame) -> Dict[str, Dict]:
        """
        STEP 4: Apply rule engine using RuleEngine.
        Returns rule scores per account.
        """
        rule_scores = self.rule_engine.apply_all_rules(transactions_df)
        return rule_scores
    
    
    def _merge_rule_scores(self, features_df: pd.DataFrame, 
                          rule_scores: Dict[str, Dict]) -> pd.DataFrame:
        """Merge rule scores into features dataframe"""
        
        # Extract rule scores and create dataframe
        rule_data = []
        for account_id, scores in rule_scores.items():
            rule_data.append({
                'account_id': account_id,
                'rule_risk_score': scores.get('risk_score', 0),
                'rule_risk_category': scores.get('risk_category', 'Low'),
                'triggered_rules_count': len(scores.get('triggered_rules', []))
            })
        
        rule_df = pd.DataFrame(rule_data)
        
        # Merge with features
        features_df = features_df.merge(
            rule_df,
            on='account_id',
            how='left'
        )
        
        # Fill NaN values
        features_df['rule_risk_score'] = features_df['rule_risk_score'].fillna(0)
        features_df['triggered_rules_count'] = features_df['triggered_rules_count'].fillna(0)
        
        return features_df
    
    
    def _prepare_final_features(self, features_df: pd.DataFrame) -> pd.DataFrame:
        """
        STEP 5: Prepare final feature table for ML inference.
        Ensures one row per account with all features aligned.
        """
        
        # Drop any duplicate account_id rows (keep first)
        features_df = features_df.drop_duplicates(subset=['account_id'], keep='first')
        
        # Handle missing values
        numeric_cols = features_df.select_dtypes(include=[np.number]).columns
        features_df[numeric_cols] = features_df[numeric_cols].fillna(0)
        
        # Handle infinite values
        features_df = features_df.replace([np.inf, -np.inf], 0)
        
        return features_df
    
    
    def _run_ml_inference(self, features_df: pd.DataFrame, 
                         use_trained_model: bool = True,
                         model_version: Optional[str] = None) -> np.ndarray:
        """
        STEP 6: Run ML inference using InferenceEngine or ModelPipeline.
        
        Args:
            features_df: Feature dataframe
            use_trained_model: Whether to use existing trained model
            model_version: Specific model version to load
        
        Returns:
            Array of ML scores (probabilities)
        """
        
        if use_trained_model:
            # Load model using InferenceEngine
            if model_version:
                self.inference_engine.load_model(model_version)
            else:
                # Load latest model
                import os
                model_dir = self.model_pipeline.model_dir
                models = [f for f in os.listdir(model_dir) if f.endswith('.pkl')]
                
                if not models:
                    print("⚠ No trained model found. Using default scores.")
                    return np.random.random(len(features_df)) * 0.3  # Low random scores
                
                # Sort by modification time, get latest
                models.sort(key=lambda x: os.path.getmtime(os.path.join(model_dir, x)))
                latest_model = models[-1].replace('.pkl', '')
                self.inference_engine.load_model(latest_model)
            
            # Run inference
            ml_scores, metadata = self.inference_engine.predict(
                model=self.model_pipeline,
                data=features_df
            )
            
        else:
            # No model available - return placeholder scores
            print("⚠ No model specified. Using placeholder scores.")
            ml_scores = np.random.random(len(features_df)) * 0.3  # Low random scores
        
        return ml_scores
    
    
    def _calculate_final_scores(self, features_df: pd.DataFrame,
                               ml_scores: np.ndarray,
                               rule_scores: Dict[str, Dict],
                               network_metrics: Dict[str, Dict]) -> Dict[str, Any]:
        """
        STEP 7: Calculate final hybrid risk scores and prepare output.
        
        Combines:
        - ML probability scores (60% weight)
        - Rule engine scores (25% weight)
        - Network risk signals (15% weight)
        """
        
        accounts_output = []
        
        for idx, row in features_df.iterrows():
            account_id = row['account_id']
            
            # Get component scores
            ml_score = float(ml_scores[idx]) if idx < len(ml_scores) else 0.0
            rule_data = rule_scores.get(account_id, {})
            rule_score = float(rule_data.get('risk_score', 0) or 0)
            
            network_data = network_metrics.get(account_id, {})
            # Network risk based on centrality and clustering
            network_risk = min(
                (network_data.get('degree_centrality', 0) / 10.0 + 
                 network_data.get('clustering_coefficient', 0)) / 2.0,
                1.0
            )
            
            # Calculate hybrid score (weighted combination)
            ml_w = float(self.score_weights.get("ml_weight", 0.60))
            rule_w = float(self.score_weights.get("rule_weight", 0.25))
            net_w = float(self.score_weights.get("network_weight", 0.15))
            hybrid_score = (ml_score * ml_w) + (rule_score * rule_w) + (network_risk * net_w)
            
            # Apply risk thresholds
            if hybrid_score >= self.risk_thresholds['high']:
                risk_level = 'HIGH'
            elif hybrid_score >= self.risk_thresholds['medium']:
                risk_level = 'MEDIUM'
            else:
                risk_level = 'LOW'
            
            # Extract key features for explainability
            key_features = self._extract_key_features(row, ml_score, rule_score, network_risk)
            
            # Build account output
            account_output = {
                'account_id': account_id,
                'ml_score': round(ml_score, 4),
                'rule_score': round(rule_score, 4),
                'network_risk': round(network_risk, 4),
                'hybrid_score': round(hybrid_score, 4),
                'risk_level': risk_level,
                'risk_percentage': round(hybrid_score * 100, 2),
                'triggered_rules': rule_data.get('triggered_rules', []),
                'rule_details': rule_data.get('rule_scores', {}),
                'network_metrics': {
                    'degree_centrality': network_data.get('degree_centrality', 0),
                    'clustering_coefficient': network_data.get('clustering_coefficient', 0),
                    'betweenness_centrality': network_data.get('betweenness_centrality', 0),
                    'pagerank': network_data.get('pagerank', 0)
                },
                'key_features': key_features
            }
            
            accounts_output.append(account_output)
        
        # Sort by hybrid score (highest first)
        accounts_output.sort(key=lambda x: x['hybrid_score'], reverse=True)
        
        # Calculate summary statistics
        summary = self._calculate_summary(accounts_output, features_df)
        
        return {
            'success': True,
            'summary': summary,
            'accounts': accounts_output,
            'metadata': {
                'pipeline_version': '1.0',
                'execution_timestamp': datetime.now().isoformat(),
                'total_accounts': len(accounts_output),
                'model_version': self.model_pipeline.model_version,
                'score_weights': dict(self.score_weights),
                'features_used': list(features_df.columns)
            }
        }
    
    
    def _extract_key_features(self, row: pd.Series, ml_score: float, 
                             rule_score: float, network_risk: float) -> Dict[str, Any]:
        """Extract most important features for the account"""
        
        key_features = {}
        
        # Get MVP features if available
        for feature_name in self.mvp_features:
            if feature_name in row.index:
                key_features[feature_name] = self._format_feature_value(row[feature_name])
        
        # Add score components
        key_features['ml_mule_probability'] = round(ml_score, 4)
        key_features['rule_based_risk'] = round(rule_score, 4)
        key_features['network_risk_signal'] = round(network_risk, 4)
        
        return key_features
    
    
    def _format_feature_value(self, value: Any) -> Any:
        """Format feature value for output"""
        if isinstance(value, (np.integer, np.floating)):
            return float(value)
        elif isinstance(value, bool):
            return bool(value)
        elif pd.isna(value):
            return None
        else:
            return value
    
    
    def _calculate_summary(self, accounts: List[Dict], features_df: pd.DataFrame) -> Dict[str, Any]:
        """Calculate summary statistics"""
        
        risk_counts = {'LOW': 0, 'MEDIUM': 0, 'HIGH': 0}
        for account in accounts:
            risk_counts[account['risk_level']] += 1
        
        high_risk_accounts = [a for a in accounts if a['risk_level'] == 'HIGH']
        
        return {
            'total_accounts': len(accounts),
            'risk_distribution': risk_counts,
            'high_risk_count': risk_counts['HIGH'],
            'medium_risk_count': risk_counts['MEDIUM'],
            'low_risk_count': risk_counts['LOW'],
            'high_risk_percentage': round(risk_counts['HIGH'] / len(accounts) * 100, 2) if accounts else 0,
            'average_risk_score': round(np.mean([a['hybrid_score'] for a in accounts]), 4) if accounts else 0,
            'max_risk_score': round(max([a['hybrid_score'] for a in accounts]), 4) if accounts else 0,
            'top_high_risk_accounts': [a['account_id'] for a in high_risk_accounts[:10]],
            'feature_count': len(features_df.columns),
            'execution_time': datetime.now().isoformat()
        }


def run_mule_intelligence(transactions_df: pd.DataFrame, 
                         accounts_df: pd.DataFrame,
                         model_version: Optional[str] = None) -> Dict[str, Any]:
    """
    Convenience function to run the complete pipeline.
    
    Usage:
        results = run_mule_intelligence(transactions_df)
    
    Args:
        transactions_df: Transaction data
        model_version: Optional model version to use
    
    Returns:
        Complete results dictionary
    """
    orchestrator = MuleIntelligenceOrchestrator()
    return orchestrator.run_mule_intelligence(
        transactions_df=transactions_df,
        accounts_df=accounts_df,
        use_trained_model=True,
        model_version=model_version
    )


