"""
Mule Intelligence API Routes

Flask Blueprint that integrates the orchestrator with the backend API.
This provides endpoints for the frontend to trigger the complete pipeline.

Location: backend/api/routes/mule_detection/intelligence_routes.py
"""

from flask import Blueprint, request, jsonify
import pandas as pd
import traceback
import json
import os
import io
from datetime import datetime
from typing import Dict, Optional
import duckdb

# Import the orchestrator
from services.mule_detection.orchestrator import MuleIntelligenceOrchestrator, run_mule_intelligence
from services.mule_detection.db_service import get_md_db_service

intelligence_bp = Blueprint('mule_intelligence', __name__)
md_db = get_md_db_service()


def _load_transactions_accounts(env_id: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    paths = md_db.init_env_structure(env_id)
    conn = duckdb.connect(str(paths["duckdb"]))
    try:
        tx = conn.execute(
            "SELECT * FROM mule_transactions WHERE environment_id = ?",
            [env_id],
        ).df()
        acc = conn.execute(
            "SELECT * FROM mule_accounts WHERE environment_id = ?",
            [env_id],
        ).df()
    finally:
        conn.close()
    return tx, acc


def get_env_id_from_request():
    """Extract environment ID from request headers"""
    return request.headers.get('X-Environment-ID', 'fcip_env')


@intelligence_bp.route('/intelligence/run', methods=['POST'])
def run_intelligence_pipeline():
    """
    Run the complete Mule Intelligence pipeline on existing data.
    
    POST /api/v2/mule/intelligence/run
    
    Request Body (optional):
    {
        "model_version": "mule_model_v_20240204_120000",  // Optional: specific model version
        "use_trained_model": true,  // Optional: default true
        "account_filters": {  // Optional: filter specific accounts
            "account_ids": ["ACC100001", "ACC100002"],
            "min_transactions": 5
        }
    }
    
    Response:
    {
        "success": true,
        "summary": {
            "total_accounts": 100,
            "high_risk_count": 15,
            "medium_risk_count": 30,
            "low_risk_count": 55,
            ...
        },
        "accounts": [
            {
                "account_id": "ACC100001",
                "ml_score": 0.85,
                "hybrid_score": 0.78,
                "risk_level": "HIGH",
                "risk_percentage": 78.5,
                ...
            }
        ],
        "metadata": {...}
    }
    """
    
    try:
        env_id = get_env_id_from_request()
        transactions_df, accounts_df = _load_transactions_accounts(env_id)
        if transactions_df is None or len(transactions_df) == 0:
            return jsonify({'success': False, 'error': 'No transaction data found. Please upload data first.'}), 404
        if accounts_df is None or len(accounts_df) == 0:
            return jsonify({'success': False, 'error': 'No accounts data found. Please upload data first.'}), 404
        
        # Get request parameters
        data = request.get_json() or {}
        model_version = data.get('model_version')
        use_trained_model = data.get('use_trained_model', True)
        account_filters = data.get('account_filters', {})
        
        # Apply filters if specified
        if account_filters:
            transactions_df = _apply_account_filters(transactions_df, account_filters)
        
        # Initialize orchestrator with environment-specific paths
        paths = md_db.init_env_structure(env_id)
        model_dir = str(paths["models_dir"])
        feature_db = os.path.join(str(paths["root"]), 'feature_store.db')
        
        orchestrator = MuleIntelligenceOrchestrator(
            model_dir=model_dir,
            feature_db=feature_db
        )
        
        # Run pipeline
        results = orchestrator.run_mule_intelligence(
            transactions_df=transactions_df,
            accounts_df=accounts_df,
            use_trained_model=use_trained_model,
            model_version=model_version
        )
        
        return jsonify(results)
    
    except Exception as e:
        print(f"❌ Intelligence pipeline error: {str(e)}")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500


@intelligence_bp.route('/intelligence/status', methods=['GET'])
def get_intelligence_status():
    """
    Get status of last intelligence run.
    
    GET /api/v2/mule/intelligence/status
    
    Response:
    {
        "has_results": true,
        "last_run": "2024-02-04T12:30:45",
        "summary": {...}
    }
    """
    
    try:
        env_id = get_env_id_from_request()
        paths = md_db.init_env_structure(env_id)
        conn = duckdb.connect(str(paths["duckdb"]))
        try:
            row = conn.execute(
                """
                SELECT created_at, COUNT(*) AS n,
                       SUM(CASE WHEN risk_level = 'HIGH' THEN 1 ELSE 0 END) AS high_risk,
                       SUM(CASE WHEN risk_level = 'MEDIUM' THEN 1 ELSE 0 END) AS medium_risk,
                       SUM(CASE WHEN risk_level = 'LOW' THEN 1 ELSE 0 END) AS low_risk,
                       AVG(hybrid_score) AS avg_score,
                       MAX(hybrid_score) AS max_score
                FROM mule_risk_scores
                WHERE environment_id = ?
                GROUP BY created_at
                ORDER BY created_at DESC
                LIMIT 1
                """,
                [env_id],
            ).fetchone()
        finally:
            conn.close()

        if not row:
            return jsonify({'has_results': False, 'message': 'No intelligence results found. Run pipeline first.'})

        last_run, total, high_risk, medium_risk, low_risk, avg_score, max_score = row
        summary = {
            'total_accounts': int(total or 0),
            'high_risk_count': int(high_risk or 0),
            'medium_risk_count': int(medium_risk or 0),
            'low_risk_count': int(low_risk or 0),
            'high_risk_percentage': float((high_risk or 0) / total * 100) if total else 0.0,
            'average_risk_score': float(avg_score or 0.0),
            'max_risk_score': float(max_score or 0.0),
        }
        return jsonify({'has_results': True, 'last_run': str(last_run), 'summary': summary})
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@intelligence_bp.route('/intelligence/account/<account_id>', methods=['GET'])
def get_account_intelligence(account_id: str):
    """
    Get detailed intelligence results for a specific account.
    
    GET /api/v2/mule/intelligence/account/{account_id}
    
    Response:
    {
        "account_id": "ACC100001",
        "ml_score": 0.85,
        "hybrid_score": 0.78,
        "risk_level": "HIGH",
        "triggered_rules": [...],
        "network_metrics": {...},
        "key_features": {...}
    }
    """
    
    try:
        env_id = get_env_id_from_request()
        paths = md_db.init_env_structure(env_id)
        conn = duckdb.connect(str(paths["duckdb"]))
        try:
            row = conn.execute(
                """
                SELECT account_id, hybrid_score, risk_level, ml_risk_score, pattern_risk_score, decision_logic
                FROM mule_risk_scores
                WHERE environment_id = ? AND account_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                [env_id, account_id],
            ).fetchone()
        finally:
            conn.close()

        if not row:
            return jsonify({'success': False, 'error': f'Account {account_id} not found in results'}), 404

        account_id, hybrid_score, risk_level, ml_risk_score, pattern_risk_score, decision_logic = row
        return jsonify({
            'success': True,
            'account': {
                'account_id': account_id,
                'hybrid_score': float(hybrid_score or 0),
                'risk_level': risk_level,
                'ml_score': float(ml_risk_score or 0) if ml_risk_score is not None else None,
                'rule_score': float(pattern_risk_score or 0) if pattern_risk_score is not None else None,
                'decision_logic': decision_logic,
            }
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@intelligence_bp.route('/intelligence/high-risk', methods=['GET'])
def get_high_risk_accounts():
    """
    Get all high-risk accounts from last intelligence run.
    
    GET /api/v2/mule/intelligence/high-risk
    
    Query Parameters:
    - limit: Max number of accounts to return (default: 50)
    - min_score: Minimum hybrid score (default: 0.7)
    
    Response:
    {
        "success": true,
        "count": 15,
        "accounts": [...]
    }
    """
    
    try:
        env_id = get_env_id_from_request()
        limit = request.args.get('limit', 50, type=int)
        min_score = request.args.get('min_score', 0.7, type=float)
        paths = md_db.init_env_structure(env_id)
        conn = duckdb.connect(str(paths["duckdb"]))
        try:
            latest_ts = conn.execute(
                "SELECT MAX(created_at) FROM mule_risk_scores WHERE environment_id = ?",
                [env_id],
            ).fetchone()[0]
            if latest_ts is None:
                return jsonify({'success': False, 'error': 'No intelligence results found. Run pipeline first.'}), 404
            accounts = conn.execute(
                """
                SELECT account_id,
                       hybrid_score,
                       risk_level,
                       ml_risk_score AS ml_score,
                       pattern_risk_score AS rule_score,
                       confidence,
                       decision_logic
                FROM mule_risk_scores
                WHERE environment_id = ? AND created_at = ?
                  AND risk_level = 'HIGH'
                  AND hybrid_score >= ?
                ORDER BY hybrid_score DESC
                LIMIT ?
                """,
                [env_id, latest_ts, min_score, limit],
            ).df()
        finally:
            conn.close()
        return jsonify({'success': True, 'count': int(len(accounts)), 'accounts': accounts.to_dict('records')})
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@intelligence_bp.route('/intelligence/export', methods=['GET'])
def export_intelligence_results():
    """
    Export intelligence results as CSV.
    
    GET /api/v2/mule/intelligence/export
    
    Query Parameters:
    - format: 'csv' or 'json' (default: 'csv')
    
    Returns: File download
    """
    
    try:
        env_id = get_env_id_from_request()
        format_type = request.args.get('format', 'csv')
        paths = md_db.init_env_structure(env_id)
        conn = duckdb.connect(str(paths["duckdb"]))
        try:
            latest_ts = conn.execute(
                "SELECT MAX(created_at) FROM mule_risk_scores WHERE environment_id = ?",
                [env_id],
            ).fetchone()[0]
            if latest_ts is None:
                return jsonify({'success': False, 'error': 'No intelligence results found. Run pipeline first.'}), 404
            accounts_df = conn.execute(
                """
                SELECT account_id, hybrid_score, risk_level, ml_risk_score, pattern_risk_score,
                       confidence, decision_logic, created_at
                FROM mule_risk_scores
                WHERE environment_id = ? AND created_at = ?
                ORDER BY hybrid_score DESC
                """,
                [env_id, latest_ts],
            ).df()
        finally:
            conn.close()

        if format_type == 'csv':
            buf = io.StringIO()
            accounts_df.to_csv(buf, index=False)
            return jsonify({'success': True, 'filename': 'intelligence_results.csv', 'content': buf.getvalue()})
        return jsonify({'success': True, 'accounts': accounts_df.to_dict('records')})
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@intelligence_bp.route('/intelligence/retrain', methods=['POST'])
def trigger_model_retraining():
    """
    Trigger model retraining with current data and intelligence results.
    
    POST /api/v2/mule/intelligence/retrain
    
    Request Body:
    {
        "model_type": "xgboost",  // Optional
        "test_size": 0.2,  // Optional
        "use_smote": true  // Optional
    }
    
    Response:
    {
        "success": true,
        "model_version": "mule_model_v_20240204_120000",
        "metrics": {...}
    }
    """
    
    try:
        env_id = get_env_id_from_request()
        mule_dir = get_mule_dir(env_id)
        
        # Check if data exists
        transactions_path = os.path.join(mule_dir, 'transactions.csv')
        if not os.path.exists(transactions_path):
            return jsonify({
                'success': False,
                'error': 'No transaction data found. Please upload data first.'
            }), 404
        
        # Load data
        transactions_df = pd.read_csv(transactions_path)
        
        # Get training parameters
        data = request.get_json() or {}
        model_type = data.get('model_type', 'xgboost')
        test_size = data.get('test_size', 0.2)
        use_smote = data.get('use_smote', True)
        
        # Initialize orchestrator
        model_dir = os.path.join(mule_dir, 'ml_models')
        feature_db = os.path.join(mule_dir, 'feature_store.db')
        
        orchestrator = MuleIntelligenceOrchestrator(
            model_dir=model_dir,
            feature_db=feature_db
        )
        
        # Engineer features
        print("Engineering features for training...")
        features_df = orchestrator.feature_engineer.engineer_all_features(transactions_df)
        
        # Check for label column
        if 'is_mule' not in features_df.columns and 'is_suspicious' in transactions_df.columns:
            # Create labels from transaction data
            account_labels = transactions_df.groupby('account_id')['is_suspicious'].max()
            features_df = features_df.merge(
                account_labels.rename('is_mule'),
                left_on='account_id',
                right_index=True,
                how='left'
            )
        
        # Train model
        print(f"Training {model_type} model...")
        training_results = orchestrator.model_pipeline.train(
            data=features_df,
            model_type=model_type,
            test_size=test_size,
            use_smote=use_smote
        )
        
        return jsonify({
            'success': True,
            'model_version': training_results['model_version'],
            'metrics': training_results['metrics'],
            'features_used': training_results['features_used']
        })
    
    except Exception as e:
        print(f"❌ Model training error: {str(e)}")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


def _apply_account_filters(df: pd.DataFrame, filters: Dict) -> pd.DataFrame:
    """Apply account filters to dataframe"""
    
    # Filter by specific account IDs
    if 'account_ids' in filters:
        df = df[df['account_id'].isin(filters['account_ids'])]
    
    # Filter by minimum transaction count
    if 'min_transactions' in filters:
        account_counts = df.groupby('account_id').size()
        valid_accounts = account_counts[account_counts >= filters['min_transactions']].index
        df = df[df['account_id'].isin(valid_accounts)]
    
    return df
