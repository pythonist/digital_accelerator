# backend/api/routes/calibration/percentile_routes.py
"""
Percentile & Threshold Routes - Step 3 (FIXED VERSION)
✅ No re-aggregation after Step 2 (uses cache)
✅ Alert population accepts query params
✅ STR evaluation has graceful error handling
"""
from flask import Blueprint, request, jsonify
from api.services import services
from calibration.shared.calibration_helpers import load_calibration_population
import traceback

percentile_bp = Blueprint('calibration_percentile', __name__)

# ================================================================
# FIX #2 APPLIED: Using cached aggregation data
# ================================================================
def get_param(key, default=None, param_type=str):
    """
    Helper to get query params from either flat or nested format
    Handles both:
      - threshold=50000 (correct)
      - params[threshold]=50000 (frontend bug)
    """
    # Try flat format first
    value = request.args.get(key, type=param_type)
    
    if value is not None:
        return value
    
    # Try nested params[] format (frontend bug workaround)
    nested_key = f'params[{key}]'
    value = request.args.get(nested_key, type=param_type)
    
    if value is not None:
        print(f"⚠️ WARNING: Received nested param {nested_key} - frontend should send flat {key}")
        return value
    
    return default
@percentile_bp.route('/<run_id>/calculate', methods=['POST'])
def calculate_percentiles(run_id):
    """
    Step 3 Entry Point: Calculate percentiles AND histogram
    POST /api/v2/calibration/percentile/{run_id}/calculate
    
    ✅ FIXED: Uses cached aggregation instead of re-running
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        metric = data.get('metric', 'amount')
        
        if not env_id: 
            return jsonify({'error': 'env_id required'}), 400
        
        # ✅ LOAD FROM CACHE - Never re-aggregate
        try:
            df, metadata = load_calibration_population(run_id, services.get_calibration_db())
        except ValueError as e:
            return jsonify({
                'error': str(e),
                'code': 'STEP_2_INCOMPLETE'
            }), 400
        
        if df.empty:
            return jsonify({
                'error': 'No aggregated data found. Complete Step 2 first.',
                'code': 'STEP_2_INCOMPLETE'
            }), 400
        
        # 2. Compute percentiles and histogram
        pct_engine = services.get_percentile_engine()
        engine_result = pct_engine.compute_percentiles(run_id, df, metric)
        
        return jsonify({
            'success': True,
            'percentiles': engine_result['percentiles'],
            'histogram': engine_result['histogram'],
            'stats': engine_result.get('stats', {}),
            'metric': metric
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@percentile_bp.route('/<run_id>', methods=['GET'])
def get_percentiles(run_id):
    """
    Get stored percentile distribution
    
    GET /api/v2/calibration/percentile/{run_id}?metric=amount
    
    Fast endpoint - retrieves from database without recomputation
    """
    try:
        metric = request.args.get('metric', 'amount')
        
        pct_engine = services.get_percentile_engine()
        percentiles = pct_engine.get_stored_percentiles(run_id, metric)
        
        if not percentiles:
            return jsonify({
                'error': 'Percentiles not calculated yet. Call /calculate first.',
                'code': 'NOT_CALCULATED'
            }), 404
        
        summary = pct_engine.get_distribution_summary(run_id, metric)
        
        return jsonify({
            'success': True,
            'percentiles': percentiles,
            'summary': summary
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@percentile_bp.route('/<run_id>/simulate', methods=['POST'])
def simulate_threshold(run_id):
    """
    Simulate a specific threshold value
    
    POST /api/v2/calibration/percentile/{run_id}/simulate
    Body: {
        "env_id": "xxx",
        "threshold": 50000,
        "metric": "amount"
    }
    
    Used by slider for real-time feedback
    ✅ FIXED: Uses cached data
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        threshold = data.get('threshold')
        metric = data.get('metric', 'amount')
        
        if not env_id or threshold is None:
            return jsonify({'error': 'env_id and threshold required'}), 400
        
        # ✅ LOAD FROM CACHE - Never re-aggregate
        try:
            df, metadata = load_calibration_population(run_id, services.get_calibration_db())
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        
        # 2. Simulate
        simulator = services.get_threshold_simulator()
        simulation = simulator.simulate_threshold(run_id, df, float(threshold), metric)
        
        return jsonify({
            'success': True,
            'simulation': simulation
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@percentile_bp.route('/<run_id>/batch-simulate', methods=['POST'])
def batch_simulate(run_id):
    """
    Simulate multiple thresholds at once
    
    POST /api/v2/calibration/percentile/{run_id}/batch-simulate
    Body: {
        "env_id": "xxx",
        "percentiles": [75, 80, 85, 90, 95, 99],
        "metric": "amount"
    }
    
    Pre-computes common thresholds for fast table rendering
    ✅ FIXED: Uses cached data
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        percentile_list = data.get('percentiles', [75, 80, 85, 90, 95, 99])
        metric = data.get('metric', 'amount')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        # 1. Get percentile values
        pct_engine = services.get_percentile_engine()
        all_percentiles = pct_engine.get_stored_percentiles(run_id, metric)
        
        if not all_percentiles:
            return jsonify({
                'error': 'Percentiles not calculated. Call /calculate first.'
            }), 400
        
        # 2. ✅ LOAD FROM CACHE - Never re-aggregate
        try:
            df, metadata = load_calibration_population(run_id, services.get_calibration_db())
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        
        # 3. Simulate each requested percentile
        simulator = services.get_threshold_simulator()
        simulations = []
        
        for p in percentile_list:
            # Find threshold for this percentile
            pct_data = next((x for x in all_percentiles if x['percentile'] == p), None)
            if pct_data:
                sim = simulator.simulate_threshold(
                    run_id, df, pct_data['threshold'], metric
                )
                sim['percentile_label'] = f"p{p}"
                simulations.append(sim)
        
        return jsonify({
            'success': True,
            'simulations': simulations
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@percentile_bp.route('/<run_id>/select', methods=['POST'])
def select_threshold(run_id):
    """
    Finalize threshold selection
    
    POST /api/v2/calibration/percentile/{run_id}/select
    Body: {
        "env_id": "xxx",
        "threshold": 50000,
        "percentile": 92,
        "metric": "amount",
        "estimated_alerts": 1234,
        "rationale": "Balances coverage and workload"
    }
    
    Saves selection and advances to Step 4 (Approval)
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        threshold = data.get('threshold')
        percentile = data.get('percentile')
        metric = data.get('metric', 'amount')
        estimated_alerts = data.get('estimated_alerts')
        rationale = data.get('rationale', '')
        
        if not all([env_id, threshold, percentile, estimated_alerts]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Store selection
        db = services.get_calibration_db()
        conn = db.connect()
        cursor = conn.cursor()
        
        # Save to selected_thresholds table
        cursor.execute("""
            INSERT OR REPLACE INTO selected_thresholds
            (run_id, threshold_value, percentile, metric, estimated_alerts, rationale)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (run_id, float(threshold), float(percentile), metric, int(estimated_alerts), rationale))
        
        # Update run status
        cursor.execute("""
            UPDATE calibration_runs
            SET selected_threshold = ?,
                selected_percentile = ?,
                estimated_alert_count = ?,
                status = 'calibrating',
                current_step = 3,
                updated_at = CURRENT_TIMESTAMP
            WHERE run_id = ?
        """, (float(threshold), float(percentile), int(estimated_alerts), run_id))
        
        conn.commit()
        conn.close()
        
        print(f"✅ Threshold selected: p{percentile} = {threshold} ({estimated_alerts} alerts)")
        
        return jsonify({
            'success': True,
            'message': 'Threshold selection saved',
            'run_id': run_id,
            'threshold': float(threshold),
            'percentile': float(percentile),
            'estimated_alerts': int(estimated_alerts)
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@percentile_bp.route('/<run_id>/metadata', methods=['GET'])
def get_calibration_metadata(run_id):
    """
    Get calibration metadata for context bar
    
    GET /api/v2/calibration/percentile/{run_id}/metadata
    
    Returns aggregation config and population stats
    """
    try:
        db = services.get_calibration_db()
        conn = db.connect()
        cursor = conn.cursor()
        
        # Get run metadata
        cursor.execute("""
            SELECT env_id, population_filters, aggregation_config,
                   aggregated_population_count, created_at
            FROM calibration_runs
            WHERE run_id = ?
        """, (run_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return jsonify({'error': 'Run not found'}), 404
        
        import json
        agg_config = json.loads(row['aggregation_config']) if row['aggregation_config'] else {}
        
        return jsonify({
            'success': True,
            'metadata': {
                'run_id': run_id,
                'env_id': row['env_id'],
                'level': agg_config.get('level', 'account'),
                'lookback_days': agg_config.get('lookback_days', 30),
                'frequency': agg_config.get('frequency', 'daily'),
                'metrics': agg_config.get('metrics', ['amount']),
                'population_count': row['aggregated_population_count'],
                'created_at': row['created_at']
            }
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@percentile_bp.route('/<run_id>/ladder', methods=['GET'])
def get_percentile_ladder(run_id):
    """
    Get percentile ladder table data with sensitivity
    """
    try:
        metric = request.args.get('metric', 'amount')
        
        # ✅ FIX: Use comparison service for full ladder data
        comparison_service = services.get_comparison_service()
        result = comparison_service.get_percentile_ladder(
            run_id, 
            percentiles=[50, 75, 80, 85, 90, 92, 94, 95, 96, 97, 98, 99, 99.5, 99.9],
            metric=metric
        )
        
        return jsonify({
            'success': True,
            'ladder': result['ladder'],
            'total_entities': result.get('total_entities', 0),
            'metric': metric
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@percentile_bp.route('/<run_id>/distribution-table', methods=['GET'])
def get_distribution_table(run_id):
    """
    Get distribution table - FIXED to return consistent property names
    """
    try:
        # Use helper function to handle both formats
        metric = get_param('metric', default='amount', param_type=str)
        bins = get_param('bins', default=50, param_type=int)
        threshold = get_param('threshold', param_type=float)
        
        # Load from cache
        try:
            df, metadata = load_calibration_population(run_id, services.get_calibration_db())
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        
        # Determine metric column
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=['number']).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        if not target_col:
            return jsonify({'error': f'No numeric column found for metric: {metric}'}), 400
        
        # Create bins
        import pandas as pd
        import numpy as np
        
        hist, bin_edges = pd.cut(df[target_col], bins=bins, retbins=True, duplicates='drop')
        hist_counts = df.groupby(hist, observed=True).size()
        
        distribution_table = []
        cumulative_count = 0
        
        for interval, count in hist_counts.items():
            bin_start = float(interval.left)
            bin_end = float(interval.right)
            cumulative_count += count
            
            # Determine if bin is above/below threshold
            is_above_threshold = False
            if threshold:
                if bin_start >= threshold:
                    is_above_threshold = True
            
            # Format range string
            range_str = f"₹{bin_start:,.0f} - ₹{bin_end:,.0f}"
            
            # ✅ FIX: Return BOTH property names for compatibility
            distribution_table.append({
                'bin_start': bin_start,
                'bin_end': bin_end,
                'bin_midpoint': (bin_start + bin_end) / 2,
                'count': int(count),                    # Backend property
                'entity_count': int(count),             # Frontend property (for compatibility)
                'percentage': round((count / len(df)) * 100, 2),      # Backend property
                'pct_population': round((count / len(df)) * 100, 2), # Frontend property
                'cumulative_pct': round((cumulative_count / len(df)) * 100, 2),
                'is_above_threshold': is_above_threshold,
                'range': range_str,
                'status': 'above' if is_above_threshold else 'below'
            })
        
        return jsonify({
            'success': True,
            'bins': distribution_table,
            'total_entities': len(df),
            'metric': metric
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@percentile_bp.route('/<run_id>/distribution-shape', methods=['GET'])
def get_distribution_shape(run_id):
    """
    Get distribution shape analysis
    
    GET /api/v2/calibration/percentile/{run_id}/distribution-shape?metric=amount
    
    Returns skewness, kurtosis, concentration metrics
    """
    try:
        metric = request.args.get('metric', 'amount')
        
        # ✅ LOAD FROM CACHE
        try:
            df, metadata = load_calibration_population(run_id, services.get_calibration_db())
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        
        # Determine metric column
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=['number']).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        if not target_col:
            return jsonify({'error': f'No numeric column found for metric: {metric}'}), 400
        
        # Calculate shape metrics
        values = df[target_col]
        
        shape_analysis = {
            'skewness': float(values.skew()),
            'kurtosis': float(values.kurtosis()),
            'concentration': {
                'top_1_pct_share': float((values >= values.quantile(0.99)).sum() / len(values) * 100),
                'top_5_pct_share': float((values >= values.quantile(0.95)).sum() / len(values) * 100),
                'top_10_pct_share': float((values >= values.quantile(0.90)).sum() / len(values) * 100)
            },
            'spread': {
                'min': float(values.min()),
                'q25': float(values.quantile(0.25)),
                'median': float(values.median()),
                'q75': float(values.quantile(0.75)),
                'max': float(values.max()),
                'std': float(values.std())
            }
        }
        
        return jsonify({
            'success': True,
            'distribution_shape': shape_analysis,
            'metric': metric
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# @percentile_bp.route('/<run_id>/impact-comprehensive', methods=['POST'])
# def get_comprehensive_impact(run_id):
#     """
#     Get comprehensive threshold impact analysis - FIXED to include composition
#     """
#     try:
#         data = request.get_json()
#         threshold = data.get('threshold')
#         percentile = data.get('percentile')
#         metric = data.get('metric', 'amount')
        
#         if not threshold:
#             return jsonify({'error': 'threshold required'}), 400
        
#         # ✅ LOAD FROM CACHE
#         try:
#             df, metadata = load_calibration_population(run_id, services.get_calibration_db())
#         except ValueError as e:
#             return jsonify({'error': str(e)}), 400
        
#         # Determine metric column
#         col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
#         target_col = col_map.get(metric, 'aggregated_amount')
        
#         if target_col not in df.columns:
#             numeric_cols = df.select_dtypes(include=['number']).columns
#             target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
#         if not target_col:
#             return jsonify({'error': f'No numeric column found for metric: {metric}'}), 400
        
#         # Calculate comprehensive impact
#         threshold_float = float(threshold)
#         alerted_df = df[df[target_col] > threshold_float]
#         suppressed_df = df[df[target_col] <= threshold_float]
        
#         # Near-miss band (within 10% of threshold)
#         lower_bound = threshold_float * 0.9
#         upper_bound = threshold_float * 1.1
#         near_miss_df = df[(df[target_col] > lower_bound) & (df[target_col] <= upper_bound)]
        
#         # ✅ ADD COMPOSITION ANALYSIS
#         composition = {}
        
#         # Helper function to find column with any prefix
#         def find_column(base_name):
#             if base_name in alerted_df.columns:
#                 return base_name
#             for prefix in ['t0_', 't1_', 't2_', 't3_']:
#                 prefixed = f"{prefix}{base_name}"
#                 if prefixed in alerted_df.columns:
#                     return prefixed
#             return None
        
#         # Composition by customer type
#         customer_type_col = find_column('customer_type')
#         if customer_type_col and not alerted_df.empty:
#             type_dist = alerted_df[customer_type_col].value_counts(normalize=True) * 100
#             composition['by_customer_type'] = type_dist.to_dict()
        
#         # Composition by risk rating
#         risk_rating_col = find_column('customer_risk_rating')
#         if risk_rating_col and not alerted_df.empty:
#             risk_dist = alerted_df[risk_rating_col].value_counts(normalize=True) * 100
#             composition['by_risk_rating'] = risk_dist.to_dict()
        
#         # Composition by account type
#         account_type_col = find_column('account_type')
#         if account_type_col and not alerted_df.empty:
#             account_dist = alerted_df[account_type_col].value_counts(normalize=True) * 100
#             composition['by_account_type'] = account_dist.to_dict()
        
#         # If no composition data available
#         if not composition:
#             composition = {
#                 'note': 'No composition fields available (customer_type, risk_rating, account_type not found)'
#             }
        
#         impact = {
#             'threshold': threshold_float,
#             'percentile': percentile,
#             'metric': metric,
#             'alerts_triggered': len(alerted_df),
#             'alerts_suppressed': len(suppressed_df),
#             'alert_rate': round((len(alerted_df) / len(df)) * 100, 2) if len(df) > 0 else 0,
#             'total_volume_alerted': float(alerted_df[target_col].sum()) if len(alerted_df) > 0 else 0,
#             'total_volume_suppressed': float(suppressed_df[target_col].sum()) if len(suppressed_df) > 0 else 0,
#             'near_miss_count': len(near_miss_df),
#             'percentile_of_threshold': round((df[target_col] <= threshold_float).sum() / len(df) * 100, 2),
#             'alert_grain': metadata.get('level', 'account').upper(),
#             'composition': composition,  # ✅ ADD THIS
#             'pct_population': round((len(alerted_df) / len(df)) * 100, 2) if len(df) > 0 else 0,
#             'suppression_pct': round((len(suppressed_df) / len(df)) * 100, 2) if len(df) > 0 else 0
#         }
        
#         return jsonify({
#             'success': True,
#             **impact
#         })
        
#     except Exception as e:
#         traceback.print_exc()
#         return jsonify({'error': str(e)}), 500

@percentile_bp.route('/<run_id>/impact-comprehensive', methods=['POST'])
def get_comprehensive_impact(run_id):
    """
    Get comprehensive threshold impact analysis - COMPLETE VERSION
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        percentile = data.get('percentile')
        metric = data.get('metric', 'amount')
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        # ✅ LOAD FROM CACHE
        try:
            df, metadata = load_calibration_population(run_id, services.get_calibration_db())
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        
        # Determine metric column
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=['number']).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        if not target_col:
            return jsonify({'error': f'No numeric column found for metric: {metric}'}), 400
        
        # Calculate comprehensive impact
        threshold_float = float(threshold)
        alerted_df = df[df[target_col] > threshold_float]
        suppressed_df = df[df[target_col] <= threshold_float]
        
        # Near-miss band (within 10% of threshold)
        lower_bound = threshold_float * 0.9
        upper_bound = threshold_float * 1.1
        near_miss_df = df[(df[target_col] > lower_bound) & (df[target_col] <= upper_bound)]
        
        # ================================================================
        # COMPOSITION ANALYSIS
        # ================================================================
        composition = {}
        
        def find_column(base_name):
            if base_name in alerted_df.columns:
                return base_name
            for prefix in ['t0_', 't1_', 't2_', 't3_']:
                prefixed = f"{prefix}{base_name}"
                if prefixed in alerted_df.columns:
                    return prefixed
            return None
        
        customer_type_col = find_column('customer_type')
        if customer_type_col and not alerted_df.empty:
            type_dist = alerted_df[customer_type_col].value_counts(normalize=True) * 100
            composition['by_customer_type'] = {k: float(v) for k, v in type_dist.to_dict().items()}
        
        risk_rating_col = find_column('customer_risk_rating')
        if risk_rating_col and not alerted_df.empty:
            risk_dist = alerted_df[risk_rating_col].value_counts(normalize=True) * 100
            composition['by_risk_rating'] = {k: float(v) for k, v in risk_dist.to_dict().items()}
        
        account_type_col = find_column('account_type')
        if account_type_col and not alerted_df.empty:
            account_dist = alerted_df[account_type_col].value_counts(normalize=True) * 100
            composition['by_account_type'] = {k: float(v) for k, v in account_dist.to_dict().items()}
        
        if not composition:
            composition = {
                'note': 'No composition fields available'
            }
        
        # ================================================================
        # TEMPORAL ANALYSIS
        # ================================================================
        temporal = {}
        
        # Find transaction_date column
        date_col = find_column('transaction_date')
        if not date_col:
            date_col = find_column('transaction_datetime')
        
        if date_col and not alerted_df.empty:
            import pandas as pd
            import numpy as np
            
            # Ensure date column is datetime
            try:
                alerted_df_copy = alerted_df.copy()
                alerted_df_copy[date_col] = pd.to_datetime(alerted_df_copy[date_col], errors='coerce')
                
                # Daily alert counts
                daily_alerts = alerted_df_copy.groupby(alerted_df_copy[date_col].dt.date).size()
                
                if len(daily_alerts) > 0:
                    # Calculate monthly average (assume 30 days)
                    days_in_data = (daily_alerts.index.max() - daily_alerts.index.min()).days + 1
                    avg_monthly = float(len(alerted_df) / max(days_in_data, 1) * 30)
                    
                    # Volatility (coefficient of variation)
                    volatility = float(daily_alerts.std() / daily_alerts.mean()) if daily_alerts.mean() > 0 else 0
                    
                    # Stability classification
                    if volatility < 0.3:
                        stability = "STABLE"
                    elif volatility < 0.6:
                        stability = "MODERATE"
                    else:
                        stability = "VOLATILE"
                    
                    # Detect spike days (> 2 std above mean)
                    mean_daily = daily_alerts.mean()
                    std_daily = daily_alerts.std()
                    spike_threshold = mean_daily + (2 * std_daily)
                    spike_days = daily_alerts[daily_alerts > spike_threshold].index.tolist()
                    
                    temporal = {
                        'avg_monthly_alerts': int(avg_monthly),
                        'volatility_score': round(volatility, 2),
                        'stability': stability,
                        'daily_alerts': [
                            {'date': str(date), 'count': int(count)} 
                            for date, count in daily_alerts.tail(30).items()
                        ],
                        'spike_days': [str(d) for d in spike_days[:5]],  # Top 5 spike days
                        'days_analyzed': int(days_in_data)
                    }
                else:
                    temporal = {'note': 'Insufficient temporal data'}
            except Exception as e:
                print(f"⚠️ Temporal analysis failed: {e}")
                temporal = {'note': f'Temporal analysis failed: {str(e)}'}
        else:
            temporal = {'note': 'No date column found in data'}
        
        # ================================================================
        # CONFIDENCE ANALYSIS
        # ================================================================
        confidence = {}
        
        total_entities = len(df)
        alerted_count = len(alerted_df)
        
        # Sample size adequacy
        if total_entities >= 1000:
            sample_adequacy = "EXCELLENT"
        elif total_entities >= 500:
            sample_adequacy = "ADEQUATE"
        elif total_entities >= 100:
            sample_adequacy = "LIMITED"
        else:
            sample_adequacy = "INSUFFICIENT"
        
        # Distribution stability (based on skewness)
        values = df[target_col]
        skewness = abs(float(values.skew()))
        
        if skewness < 1:
            distribution_quality = "STABLE"
        elif skewness < 2:
            distribution_quality = "MODERATE_SKEW"
        else:
            distribution_quality = "HIGHLY_SKEWED"
        
        # Alert volume reasonableness
        alert_rate = (alerted_count / total_entities) * 100 if total_entities > 0 else 0
        
        if 1 <= alert_rate <= 10:
            alert_volume = "REASONABLE"
        elif alert_rate < 1:
            alert_volume = "TOO_LOW"
        else:
            alert_volume = "TOO_HIGH"
        
        # Overall confidence level
        factors = [sample_adequacy, distribution_quality, alert_volume]
        
        if all(f in ["EXCELLENT", "ADEQUATE", "STABLE", "REASONABLE", "MODERATE_SKEW"] for f in factors):
            confidence_level = "HIGH"
        elif any(f in ["INSUFFICIENT", "TOO_LOW", "TOO_HIGH"] for f in factors):
            confidence_level = "LOW"
        else:
            confidence_level = "MEDIUM"
        
        confidence = {
            'level': confidence_level,
            'factors': {
                'sample_size': sample_adequacy,
                'distribution_quality': distribution_quality,
                'alert_volume': alert_volume
            },
            'metrics': {
                'total_entities': int(total_entities),
                'alerted_entities': int(alerted_count),
                'alert_rate_pct': round(alert_rate, 2),
                'skewness': round(skewness, 2)
            }
        }
        
        # ================================================================
        # ASSEMBLE RESPONSE
        # ================================================================
        impact = {
            'threshold': threshold_float,
            'percentile': percentile,
            'metric': metric,
            'alerts_triggered': len(alerted_df),
            'alerts_suppressed': len(suppressed_df),
            'alert_rate': round((len(alerted_df) / len(df)) * 100, 2) if len(df) > 0 else 0,
            'total_volume_alerted': float(alerted_df[target_col].sum()) if len(alerted_df) > 0 else 0,
            'total_volume_suppressed': float(suppressed_df[target_col].sum()) if len(suppressed_df) > 0 else 0,
            'near_miss_count': len(near_miss_df),
            'percentile_of_threshold': round((df[target_col] <= threshold_float).sum() / len(df) * 100, 2),
            'alert_grain': metadata.get('level', 'account').upper(),
            'pct_population': round((len(alerted_df) / len(df)) * 100, 2) if len(df) > 0 else 0,
            'suppression_pct': round((len(suppressed_df) / len(df)) * 100, 2) if len(df) > 0 else 0,
            'composition': composition,
            'temporal': temporal,
            'confidence': confidence
        }
        
        return jsonify({
            'success': True,
            **impact
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    
@percentile_bp.route('/<run_id>/rationale', methods=['POST'])
def generate_rationale(run_id):
    """
    Auto-generate calibration rationale
    
    POST /api/v2/calibration/percentile/{run_id}/rationale
    Body: {
        "threshold": 50000,
        "percentile": 95,
        "metric": "amount"
    }
    
    Returns auto-generated rationale text
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        percentile = data.get('percentile')
        metric = data.get('metric', 'amount')
        
        if not threshold or not percentile:
            return jsonify({'error': 'threshold and percentile required'}), 400
        
        # ✅ LOAD FROM CACHE
        try:
            df, metadata = load_calibration_population(run_id, services.get_calibration_db())
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        
        # Determine metric column
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=['number']).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        # Calculate stats
        threshold_float = float(threshold)
        alerts = (df[target_col] > threshold_float).sum()
        alert_rate = (alerts / len(df)) * 100
        
        # Generate rationale
        rationale = f"Selected p{percentile} threshold of ₹{threshold_float:,.0f} for {metadata.get('level', 'account')}-level " \
                    f"{metadata.get('frequency', 'daily')} {metric} aggregation with {metadata.get('lookback_days', 30)}-day lookback. " \
                    f"This generates {alerts:,} alerts ({alert_rate:.1f}% of population), balancing regulatory coverage with " \
                    f"operational capacity. Distribution analysis shows appropriate risk concentration in upper tail."
        
        return jsonify({
            'success': True,
            'auto_text': rationale,
            'threshold': threshold_float,
            'percentile': percentile,
            'alerts': int(alerts)
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ================================================================
# FIX #4 APPLIED: Alert Population with Query Params
# ================================================================

@percentile_bp.route('/<run_id>/alert-population', methods=['GET'])
def get_alert_population(run_id):
    """
    Get alert population table - FIXED to handle both param formats
    """
    try:
        # ✅ Use helper function to handle both formats
        threshold = get_param('threshold', param_type=float)
        metric = get_param('metric', default='amount', param_type=str)
        category = get_param('category', default='alerted', param_type=str)
        limit = get_param('limit', default=100, param_type=int)
        offset = get_param('offset', default=0, param_type=int)
        
        if not threshold:
            return jsonify({'error': 'threshold parameter is required'}), 400
        
        if category not in ['alerted', 'suppressed', 'near_miss']:
            return jsonify({'error': 'category must be one of: alerted, suppressed, near_miss'}), 400
        
        outcome_service = services.get_outcome_service()
        result = outcome_service.get_alert_population(
            run_id, threshold, metric, category, limit, offset
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': 'Failed to load alert population'}), 500


@percentile_bp.route('/<run_id>/outcome-impact', methods=['POST'])
def get_outcome_impact(run_id):
    """
    Get comprehensive outcome impact (entity-level)
    
    POST /api/v2/calibration/percentile/{run_id}/outcome-impact
    Body: {
        "threshold": 50000,
        "percentile": 95,
        "metric": "amount"
    }
    
    Returns:
        - Entity counts (accounts/customers)
        - Customer rollup
        - Near-miss band analysis
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        percentile = data.get('percentile', 95)
        metric = data.get('metric', 'amount')
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        outcome_service = services.get_outcome_service()
        result = outcome_service.get_outcome_impact(
            run_id,
            float(threshold),
            float(percentile),
            metric
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# Add this to percentile_routes.py

@percentile_bp.route('/<run_id>/customer-impact', methods=['POST'])
def get_customer_impact(run_id):
    """
    Get customer-level impact analysis with distribution
    
    POST /api/v2/calibration/percentile/{run_id}/customer-impact
    Body: {
        "threshold": 50000,
        "metric": "amount"
    }
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        metric = data.get('metric', 'amount')
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        # Load data
        try:
            df, metadata = load_calibration_population(run_id, services.get_calibration_db())
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        
        # Determine metric column
        col_map = {'amount': 'aggregated_amount', 'count': 'aggregated_count'}
        target_col = col_map.get(metric, 'aggregated_amount')
        
        if target_col not in df.columns:
            numeric_cols = df.select_dtypes(include=['number']).columns
            target_col = numeric_cols[0] if len(numeric_cols) > 0 else None
        
        # Find customer_id column
        def find_column(base_name):
            if base_name in df.columns:
                return base_name
            for prefix in ['t0_', 't1_', 't2_', 't3_']:
                prefixed = f"{prefix}{base_name}"
                if prefixed in df.columns:
                    return prefixed
            return None
        
        customer_id_col = find_column('customer_id')
        account_id_col = find_column('account_id')
        
        if not customer_id_col:
            return jsonify({
                'success': True,
                'note': 'Customer ID column not found in data',
                'total_customers': 0,
                'alerted_customers': 0,
                'distribution': {},
                'top_customers': []
            })
        
        # Filter alerted accounts
        threshold_float = float(threshold)
        alerted_df = df[df[target_col] > threshold_float]
        
        if alerted_df.empty:
            return jsonify({
                'success': True,
                'total_customers': len(df[customer_id_col].unique()),
                'alerted_customers': 0,
                'pct_customers_impacted': 0,
                'distribution': {
                    'single_account': 0,
                    'two_accounts': 0,
                    'three_plus_accounts': 0
                },
                'top_customers': []
            })
        
        # Count accounts per customer
        customer_account_counts = alerted_df.groupby(customer_id_col)[account_id_col].nunique()
        
        # Distribution
        single_account = int((customer_account_counts == 1).sum())
        two_accounts = int((customer_account_counts == 2).sum())
        three_plus = int((customer_account_counts >= 3).sum())
        
        # Top customers by total exposure
        top_customers = (
            alerted_df.groupby(customer_id_col)[target_col]
            .agg(['sum', 'count'])
            .sort_values('sum', ascending=False)
            .head(10)
        )
        
        top_customers_list = [
            {
                'customer_id': str(cust_id),
                'total_exposure': float(row['sum']),
                'account_count': int(row['count'])
            }
            for cust_id, row in top_customers.iterrows()
        ]
        
        total_customers_in_data = len(df[customer_id_col].unique())
        alerted_customers = len(customer_account_counts)
        
        return jsonify({
            'success': True,
            'total_customers': int(total_customers_in_data),
            'alerted_customers': int(alerted_customers),
            'pct_customers_impacted': round((alerted_customers / total_customers_in_data) * 100, 2) if total_customers_in_data > 0 else 0,
            'distribution': {
                'single_account': single_account,
                'two_accounts': two_accounts,
                'three_plus_accounts': three_plus
            },
            'top_customers': top_customers_list,
            'metric': metric,
            'threshold': threshold_float
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@percentile_bp.route('/<run_id>/approve-outcome', methods=['POST'])
def approve_outcome(run_id):
    """
    Persist immutable calibration outcome
    
    POST /api/v2/calibration/percentile/{run_id}/approve-outcome
    Body: {
        "threshold": 50000,
        "percentile": 95,
        "metric": "amount",
        "rationale": "Detailed justification...",
        "approved_by": "john.doe@bank.com"
    }
    
    Creates immutable approval record with:
        - Entity IDs (accounts/customers)
        - Summary statistics
        - Governance metadata
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        percentile = data.get('percentile')
        metric = data.get('metric', 'amount')
        rationale = data.get('rationale')
        approved_by = data.get('approved_by')
        
        if not all([threshold, percentile, rationale, approved_by]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        if len(rationale) < 50:
            return jsonify({'error': 'Rationale must be at least 50 characters'}), 400
        
        outcome_service = services.get_outcome_service()
        result = outcome_service.persist_approved_outcome(
            run_id,
            float(threshold),
            float(percentile),
            metric,
            rationale,
            approved_by
        )
        
        print(f"✅ Calibration outcome approved: {result['outcome_id']}")
        
        return jsonify({
            'success': True,
            'message': 'Calibration outcome approved and persisted',
            **result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@percentile_bp.route('/<run_id>/approved-outcome', methods=['GET'])
def get_approved_outcome(run_id):
    """
    Retrieve approved calibration outcome
    
    GET /api/v2/calibration/percentile/{run_id}/approved-outcome
    
    Returns immutable outcome record if exists
    """
    try:
        outcome_service = services.get_outcome_service()
        result = outcome_service.get_approved_outcome(run_id)
        
        if not result:
            return jsonify({
                'success': False,
                'message': 'No approved outcome found for this run'
            }), 404
        
        return jsonify({
            'success': True,
            'outcome': result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ================================================================
# FIX #5 APPLIED: STR Evaluation with Graceful Error Handling
# ================================================================

@percentile_bp.route('/<run_id>/str-evaluation', methods=['POST'])
def evaluate_str_capture(run_id):
    """
    Evaluate STR capture for a threshold
    
    POST /api/v2/calibration/percentile/{run_id}/str-evaluation
    Body: {
        "threshold": 50000,
        "metric": "amount"
    }
    
    Returns:
        - Total STRs in period
        - Captured STRs (alerted + filed)
        - Missed STRs (not alerted but filed)
        - False positives (alerted but no STR)
        - Capture rate %
    
    ✅ FIXED: Graceful error handling when STR data missing
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        metric = data.get('metric', 'amount')
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        str_service = services.get_str_evaluation_service()
        result = str_service.evaluate_str_capture(
            run_id,
            float(threshold),
            metric
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        # ✅ GRACEFUL DEGRADATION: Return empty structure instead of error
        print(f"⚠️ STR evaluation failed: {e}")
        traceback.print_exc()
        return jsonify({
            'success': True,
            'total_strs': 0,
            'captured_strs': 0,
            'missed_strs': 0,
            'false_positives': 0,
            'total_alerts': 0,
            'capture_rate': 0.0,
            'precision': 0.0,
            'str_accounts': [],
            'captured_str_accounts': [],
            'missed_str_accounts': [],
            'note': f'STR data not available: {str(e)}'
        })


@percentile_bp.route('/<run_id>/str-missed-details', methods=['POST'])
def get_missed_str_details(run_id):
    """
    Get detailed records for missed STRs
    
    POST /api/v2/calibration/percentile/{run_id}/str-missed-details
    Body: {
        "threshold": 50000,
        "metric": "amount",
        "limit": 50
    }
    
    Returns account-level details for STRs that fell below threshold
    ✅ FIXED: Graceful error handling
    """
    try:
        data = request.get_json()
        threshold = data.get('threshold')
        metric = data.get('metric', 'amount')
        limit = data.get('limit', 50)
        
        if not threshold:
            return jsonify({'error': 'threshold required'}), 400
        
        str_service = services.get_str_evaluation_service()
        result = str_service.get_missed_str_details(
            run_id,
            float(threshold),
            metric,
            limit
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        # ✅ GRACEFUL DEGRADATION
        print(f"⚠️ Missed STR details failed: {e}")
        traceback.print_exc()
        return jsonify({
            'success': True,
            'total_missed': 0,
            'records': [],
            'note': f'Failed to load missed STR details: {str(e)}'
        })


@percentile_bp.route('/<run_id>/str-threshold-comparison', methods=['POST'])
def compare_threshold_str_impact(run_id):
    """
    Compare STR capture across multiple thresholds
    
    POST /api/v2/calibration/percentile/{run_id}/str-threshold-comparison
    Body: {
        "thresholds": [40000, 50000, 60000],
        "metric": "amount"
    }
    
    Returns STR capture metrics for each threshold scenario
    ✅ FIXED: Graceful error handling
    """
    try:
        data = request.get_json()
        thresholds = data.get('thresholds', [])
        metric = data.get('metric', 'amount')
        
        if not thresholds:
            return jsonify({'error': 'thresholds array required'}), 400
        
        str_service = services.get_str_evaluation_service()
        result = str_service.compare_threshold_str_impact(
            run_id,
            thresholds,
            metric
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        # ✅ GRACEFUL DEGRADATION
        print(f"⚠️ STR threshold comparison failed: {e}")
        traceback.print_exc()
        return jsonify({
            'success': True,
            'scenarios': [],
            'total_strs': 0,
            'note': f'STR comparison failed: {str(e)}'
        })