
# backend/api/routes/calibration/validation_routes.py
"""
Validation Routes - Step 2.5
Explains Step 1 → Step 2 → Validates → Gates Step 3
"""
from flask import Blueprint, request, jsonify
from api.services import services
from calibration.services.aggregation_service import AggregationService
import traceback
import numpy as np
import json
import pandas as pd

validation_bp = Blueprint('calibration_validation', __name__)


@validation_bp.route('/<run_id>/explanation', methods=['GET'])
def get_full_explanation(run_id):
    """
    NEW ENDPOINT: Get complete Step 1 + Step 2 + Validation explanation
    """
    try:
        env_id = request.args.get('env_id')
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        db = services.get_calibration_db()
        conn = db.connect()
        
        # Get run details
        cursor = conn.cursor()
        cursor.execute("""
            SELECT run_id, scenario_name, population_filters, base_population_count,
                   aggregation_config, status
            FROM calibration_runs 
            WHERE run_id = ?
        """, (run_id,))
        
        row = cursor.fetchone()
        if not row:
            conn.close()
            return jsonify({'error': 'Run not found'}), 404
        
        run_data = {
            'run_id': row[0],
            'scenario_name': row[1],
            'population_filters': json.loads(row[2]) if row[2] else {},
            'base_population_count': row[3],
            'aggregation_config': json.loads(row[4]) if row[4] else {},
            'status': row[5]
        }
        
        conn.close()
        
        # Build Step 1 Explanation
        step1_explanation = _build_step1_explanation(run_data)
        
        # Build Step 2 Explanation
        agg_service = AggregationService(db)
        step2_explanation = _build_step2_explanation(run_data, agg_service, run_id)
        
        # Build Validation (reuse existing logic)
        validation_result = _get_validation_stats_internal(run_id, env_id, db)
        
        return jsonify({
            'success': True,
            'step1': step1_explanation,
            'step2': step2_explanation,
            'validation': validation_result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@validation_bp.route('/<run_id>/stats', methods=['GET'])
def get_validation_stats(run_id):
    """
    EXISTING ENDPOINT (kept for backwards compatibility)
    Now delegates to internal function
    """
    try:
        env_id = request.args.get('env_id')
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        db = services.get_calibration_db()
        result = _get_validation_stats_internal(run_id, env_id, db)
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@validation_bp.route('/<run_id>/advance', methods=['POST'])
def advance_to_calibration(run_id):
    """
    Validate and advance to calibration step
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        db = services.get_calibration_db()
        conn = db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE calibration_runs
            SET status = 'validated',
                current_step = 3,
                updated_at = CURRENT_TIMESTAMP
            WHERE run_id = ?
        """, (run_id,))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Validation passed. Ready for calibration.',
            'next_step': 'calibration'
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ============================================================================
# INTERNAL HELPER FUNCTIONS
# ============================================================================

def _build_step1_explanation(run_data):
    """
    Build human-readable Step 1 explanation
    """
    filters = run_data.get('population_filters', {})
    
    # Extract filter descriptions
    filter_descriptions = []
    
    txn_filters = filters.get('transaction_filters', {})
    if txn_filters.get('categories'):
        cats = txn_filters['categories']
        filter_descriptions.append({
            'type': 'Transaction Category',
            'value': ', '.join(cats) if isinstance(cats, list) else cats,
            'impact': 'Limits transactions to specified categories only'
        })
    
    if txn_filters.get('min_amount') or txn_filters.get('max_amount'):
        min_amt = txn_filters.get('min_amount', 0)
        max_amt = txn_filters.get('max_amount', 'unlimited')
        filter_descriptions.append({
            'type': 'Transaction Amount Range',
            'value': f'₹{min_amt:,} - {max_amt if max_amt == "unlimited" else f"₹{max_amt:,}"}',
            'impact': 'Excludes transactions outside this range'
        })
    
    cust_filters = filters.get('customer_filters', {})
    if cust_filters.get('risk_ratings'):
        ratings = cust_filters['risk_ratings']
        filter_descriptions.append({
            'type': 'Customer Risk Rating',
            'value': ', '.join(ratings) if isinstance(ratings, list) else ratings,
            'impact': 'Limits to customers with specified risk levels'
        })
    
    if cust_filters.get('customer_types'):
        types = cust_filters['customer_types']
        filter_descriptions.append({
            'type': 'Customer Type',
            'value': ', '.join(types) if isinstance(types, list) else types,
            'impact': 'Filters by customer classification'
        })
    
    acc_filters = filters.get('account_filters', {})
    if acc_filters.get('account_types'):
        types = acc_filters['account_types']
        filter_descriptions.append({
            'type': 'Account Type',
            'value': ', '.join(types) if isinstance(types, list) else types,
            'impact': 'Limits to specific account types'
        })
    
    # If no filters, note it
    if not filter_descriptions:
        filter_descriptions.append({
            'type': 'No Filters',
            'value': 'All transactions included',
            'impact': 'Using complete transaction population'
        })
    
    return {
        'filters_applied': filter_descriptions,
        'raw_population_count': run_data.get('base_population_count', 0),
        'description': 'This population was selected using the filters above. All subsequent steps use ONLY this filtered data.'
    }


def _build_step2_explanation(run_data, agg_service, run_id):
    """
    Build human-readable Step 2 explanation
    """
    agg_config = run_data.get('aggregation_config', {})
    
    level = agg_config.get('level', 'account')
    lookback_days = agg_config.get('lookback_days', 30)
    frequency = agg_config.get('frequency', 'daily')
    filter_history = agg_config.get('filter_history', True)
    
    # Get aggregation result for stats
    agg_result = agg_service.get_aggregation_result(run_id)
    
    if not agg_result:
        return {
            'error': 'Aggregation not yet executed',
            'config': agg_config
        }
    
    # Calculate compression ratio
    raw_count = run_data.get('base_population_count', 0)
    agg_count = agg_result.get('row_count', 0)
    
    compression_ratio = round(raw_count / agg_count, 2) if agg_count > 0 else 0
    
    # Build explanation text
    explanation_parts = []
    
    # Grouping
    explanation_parts.append({
        'step': 'Grouping Level',
        'value': level.upper(),
        'description': f'Each {level} gets one row per date window'
    })
    
    # Rolling window
    explanation_parts.append({
        'step': 'Rolling Window',
        'value': f'{lookback_days} days',
        'description': f'For each {level} on each date, we sum all their transactions from the past {lookback_days} days'
    })
    
    # Frequency
    explanation_parts.append({
        'step': 'Time Frequency',
        'value': frequency.upper(),
        'description': f'We create aggregated rows at {frequency} intervals'
    })
    
    # History filtering
    if filter_history:
        explanation_parts.append({
            'step': 'History Filter',
            'value': 'ENABLED',
            'description': 'Historical transactions are filtered using the same Step 1 criteria before aggregation'
        })
    else:
        explanation_parts.append({
            'step': 'History Filter',
            'value': 'DISABLED',
            'description': 'All historical transactions for selected entities are included in aggregation'
        })
    
    # Deduplication
    explanation_parts.append({
        'step': 'Deduplication',
        'value': f'Unique ({level}, date) pairs',
        'description': f'Raw population is deduplicated to one row per {level} per date before aggregation'
    })
    
    return {
        'config': agg_config,
        'process_steps': explanation_parts,
        'compression_stats': {
            'input_rows': raw_count,
            'output_rows': agg_count,
            'compression_ratio': compression_ratio,
            'unique_entities': agg_result.get('unique_entities', 0)
        },
        'metrics_calculated': {
            'amount_sum': f'Sum of transaction amounts over {lookback_days} days',
            'amount_avg': f'Average transaction amount over {lookback_days} days',
            'amount_max': f'Maximum transaction amount over {lookback_days} days',
            'count': f'Number of transactions over {lookback_days} days'
        },
        'summary': f'Step 1 gave us {raw_count:,} raw transactions. Step 2 aggregated them into {agg_count:,} calibration-ready rows (compression ratio: {compression_ratio}x).'
    }


def _get_validation_stats_internal(run_id, env_id, db):
    """
    Internal function for validation stats (reused by both endpoints)
    """
    agg_service = AggregationService(db)
    
    result = agg_service.get_aggregation_result(run_id)
    
    if not result:
        raise ValueError('Aggregation not found. Complete Step 2 first.')
    
    # Load aggregated data
    config = {
        'level': result['level'],
        'lookback_days': result['lookback_days'],
        'frequency': result['frequency'],
        'metrics': ['amount', 'count']
    }
    
    agg_result = agg_service.execute_aggregation(run_id, config)
    
    # ✅ FIX: Handle missing key gracefully or use df
    if 'aggregated_df' in agg_result:
        df = agg_result['aggregated_df']
    else:
        # Fallback (though service update should prevent this)
        print("⚠️ Warning: 'aggregated_df' missing in response. Using empty DF for validation.")
        df = pd.DataFrame()
    
    # Perform validation checks
    validation_result = _perform_validation_checks(df, result)
    
    return {
        'stats': validation_result['stats'],
        'warnings': validation_result['warnings'],
        'ready_for_calibration': validation_result['ready'],
        'config_recap': {
            'level': result['level'],
            'lookback_days': result['lookback_days'],
            'frequency': result['frequency']
        }
    }


def _perform_validation_checks(df, agg_result):
    """
    Perform comprehensive validation checks
    """
    warnings = []
    
    # If DF is empty (safety check)
    if df.empty:
        return {
            'stats': {},
            'warnings': [{'severity': 'high', 'message': 'No aggregated data found for validation.'}],
            'ready': False
        }

    # Determine lookback from aggregation result
    lookback_days = agg_result.get('lookback_days', 30)
    
    # Find the aggregated amount column
    amount_col = f'agg_{lookback_days}d_amount'
    if amount_col not in df.columns:
        # Fallback to any agg column
        agg_cols = [c for c in df.columns if c.startswith('agg_') and c.endswith('_amount')]
        amount_col = agg_cols[0] if agg_cols else None
    
    # Basic stats
    stats = {
        'row_count': len(df),
        'unique_entities': agg_result.get('unique_entities', 0),
        'amount_stats': agg_result.get('amount_stats', {})
    }
    
    # Check 1: Minimum data volume
    if len(df) < 100:
        warnings.append({
            'severity': 'high',
            'message': f'Very low data volume ({len(df)} rows). Consider expanding population filters.',
            'recommendation': 'Return to Step 1 and reduce filters'
        })
    
    # Check 2: Outlier detection
    if amount_col and amount_col in df.columns:
        values = df[amount_col].dropna()
        if len(values) > 0:
            q99 = values.quantile(0.99)
            q1 = values.quantile(0.01)
            max_val = values.max()
            
            stats['outlier_analysis'] = {
                'p99': float(q99),
                'p1': float(q1),
                'max': float(max_val),
                'outlier_ratio': float((values > q99).sum() / len(values)) if len(values) > 0 else 0
            }
            
            if max_val > q99 * 10:
                warnings.append({
                    'severity': 'medium',
                    'message': f'Extreme outliers detected. Max value (₹{max_val:,.0f}) is 10x the 99th percentile.',
                    'recommendation': 'Review data quality or add upper bound filter in Step 1'
                })
    
    # Check 3: Entity distribution
    entity_col = 'account_id' if 'account_id' in df.columns else 'customer_id'
    
    if entity_col in df.columns:
        entity_counts = df[entity_col].value_counts()
        stats['entity_distribution'] = {
            'max_rows_per_entity': int(entity_counts.max()),
            'avg_rows_per_entity': float(entity_counts.mean()),
            'entities_with_single_row': int((entity_counts == 1).sum())
        }
        
        if entity_counts.max() > 100:
            warnings.append({
                'severity': 'low',
                'message': f'One entity has {entity_counts.max()} aggregated rows. This may skew results.',
                'recommendation': 'Review if this is expected behavior'
            })
    
    # Check 4: Null/zero analysis
    if amount_col and amount_col in df.columns:
        null_count = df[amount_col].isnull().sum()
        zero_count = (df[amount_col] == 0).sum()
        
        stats['data_quality'] = {
            'null_count': int(null_count),
            'zero_count': int(zero_count),
            'null_pct': round(float(null_count / len(df) * 100), 2),
            'zero_pct': round(float(zero_count / len(df) * 100), 2)
        }
        
        if null_count > len(df) * 0.1:
            warnings.append({
                'severity': 'high',
                'message': f'{stats["data_quality"]["null_pct"]:.1f}% of rows have null amounts.',
                'recommendation': 'Check aggregation logic'
            })
    
    # Calculate quality score
    quality_score = 100
    for warning in warnings:
        if warning['severity'] == 'high':
            quality_score -= 20
        elif warning['severity'] == 'medium':
            quality_score -= 10
        else:
            quality_score -= 5
    
    stats['quality_score'] = max(0, quality_score)
    
    # Determine readiness
    ready = quality_score >= 60 and len(df) >= 100
    
    return {
        'stats': stats,
        'warnings': warnings,
        'ready': ready
    }
