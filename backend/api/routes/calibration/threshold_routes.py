# backend/api/routes/calibration/threshold_routes.py
"""
Threshold Calibration Routes - Step 3 (FIXED)
"""
import json
from flask import Blueprint, request, jsonify
from api.services import services
from calibration.services import ThresholdService
from calibration.services.calibration_impact_service import CalibrationImpactService
import traceback

threshold_bp = Blueprint('calibration_threshold', __name__)

@threshold_bp.route('/<run_id>/percentiles', methods=['GET'])
def get_percentiles(run_id):
    """
    Compute and get percentile distribution
    
    GET /api/v2/calibration/threshold/{run_id}/percentiles?env_id=xxx&metric=amount
    """
    try:
        env_id = request.args.get('env_id')
        metric = request.args.get('metric', 'amount')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        db = services.get_calibration_db()
        threshold_service = ThresholdService(db)
        
        result = threshold_service.compute_percentiles(run_id, metric)
        
        return jsonify({
            'success': True,
            'percentiles': result['percentiles'],
            'metric': result['metric']
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@threshold_bp.route('/<run_id>/simulate', methods=['POST'])
def simulate_threshold(run_id):
    """
    ✅ FIXED: Simulate threshold with COMPREHENSIVE impact analysis
    
    POST /api/v2/calibration/threshold/{run_id}/simulate
    Body: {
        "env_id": "xxx",
        "threshold": 50000,
        "percentile": 92,
        "metric": "amount"
    }
    """
    try:
        data = request.get_json()
        threshold = float(data.get('threshold'))
        percentile = float(data.get('percentile', 50))  # ✅ Get percentile from request
        metric = data.get('metric', 'amount')
        
        print(f"🔍 Simulating threshold={threshold}, percentile={percentile}, metric={metric}")
        
        # Get database connection
        db = services.get_calibration_db()
        
        # ✅ CRITICAL FIX: Use CalibrationImpactService for comprehensive analysis
        impact_service = CalibrationImpactService(db)
        
        # Get comprehensive impact (includes composition, temporal, confidence)
        comprehensive_impact = impact_service.get_comprehensive_impact(
            run_id=run_id,
            threshold=threshold,
            percentile=percentile,
            metric=metric
        )
        
        print(f"📦 Impact keys returned: {comprehensive_impact.keys()}")
        print(f"📦 Composition: {comprehensive_impact.get('composition')}")
        print(f"📦 Temporal: {comprehensive_impact.get('temporal')}")
        print(f"📦 Confidence: {comprehensive_impact.get('confidence')}")
        
        # ✅ Also get entity-level metrics if needed
        entity_outcome = None
        try:
            # If you have an entity analysis service, call it here
            # entity_service = services.get_entity_service()
            # entity_outcome = entity_service.get_entity_metrics(run_id, threshold)
            pass
        except Exception as e:
            print(f"⚠️ Entity analysis not available: {e}")
        
        # Return both comprehensive impact AND entity outcome
        response = {
            'success': True,
            'impact': comprehensive_impact,  # ✅ This now has composition, temporal, confidence
            'entityOutcome': entity_outcome,
            'threshold': threshold,
            'percentile': percentile,
            'metric': metric
        }
        
        return jsonify(response)
        
    except Exception as e:
        print(f"❌ Simulation error: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@threshold_bp.route('/<run_id>/simulate-multiple', methods=['POST'])
def simulate_multiple(run_id):
    """
    Simulate multiple thresholds at once
    
    POST /api/v2/calibration/threshold/{run_id}/simulate-multiple
    Body: {
        "env_id": "xxx",
        "percentile_list": [75, 80, 90, 95, 99],
        "metric": "amount"
    }
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        percentile_list = data.get('percentile_list')
        metric = data.get('metric', 'amount')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        db = services.get_calibration_db()
        threshold_service = ThresholdService(db)
        
        result = threshold_service.simulate_multiple_thresholds(
            run_id, 
            percentile_list, 
            metric
        )
        
        return jsonify({
            'success': True,
            **result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# backend/api/routes/calibration/threshold_routes.py

@threshold_bp.route('/<run_id>/select-threshold', methods=['POST'])
def select_threshold(run_id):
    """
    Finalize threshold selection
    
    POST /api/v2/calibration/threshold/{run_id}/select-threshold
    Body: {
        "env_id": "xxx",
        "threshold": 50000,
        "percentile": 95,
        "alert_count": 1250,
        "rationale": "Detailed justification..."
    }
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        threshold = data.get('threshold')
        percentile = data.get('percentile')
        alert_count = data.get('alert_count')
        rationale = data.get('rationale', '')
        
        if not env_id or threshold is None:
            return jsonify({'error': 'env_id and threshold required'}), 400
        
        print(f"✅ [THRESHOLD] Selecting threshold: {threshold} (p{percentile})")
        print(f"📝 [THRESHOLD] Rationale: {rationale[:100]}...")
        
        db = services.get_calibration_db()
        threshold_service = ThresholdService(db)
        
        result = threshold_service.select_threshold(run_id, threshold, percentile)
        
        # Update run with rationale
        conn = db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE calibration_runs
            SET selected_threshold = ?,
                selected_percentile = ?,
                estimated_alert_count = ?,
                status = 'threshold_selected',
                current_step = 4,
                updated_at = CURRENT_TIMESTAMP
            WHERE run_id = ?
        """, (
            float(threshold),
            float(percentile) if percentile else None,
            int(alert_count) if alert_count else result['estimated_alerts'],
            run_id
        ))
        
        conn.commit()
        
        # Get updated run
        cursor.execute("""
            SELECT run_id, env_id, scenario_name, status, current_step,
                   population_filters, aggregation_config, 
                   selected_threshold, selected_percentile, estimated_alert_count,
                   created_at, updated_at
            FROM calibration_runs
            WHERE run_id = ?
        """, (run_id,))
        
        row = cursor.fetchone()
        run_dict = {}
        
        if row:
            columns = [d[0] for d in cursor.description]
            run_dict = dict(zip(columns, row))
            
            # Parse JSON fields
            for field in ['population_filters', 'aggregation_config']:
                if field in run_dict and run_dict[field]:
                    try:
                        run_dict[field] = json.loads(run_dict[field])
                    except:
                        pass
        
        conn.close()
        
        print(f"✅ [THRESHOLD] Updated run status: {run_dict.get('status')}")
        
        return jsonify({
            'success': True,
            'run': run_dict,
            'threshold': float(threshold),
            'percentile': float(percentile) if percentile else None,
            'estimated_alerts': int(alert_count) if alert_count else result['estimated_alerts']
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@threshold_bp.route('/<run_id>/simulations', methods=['GET'])
def get_simulations(run_id):
    """
    Get all threshold simulations for a run
    
    GET /api/v2/calibration/threshold/{run_id}/simulations?env_id=xxx
    """
    try:
        env_id = request.args.get('env_id')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        db = services.get_calibration_db()
        threshold_service = ThresholdService(db)
        
        simulations = threshold_service.get_simulations(run_id)
        
        return jsonify({
            'success': True,
            'simulations': simulations
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@threshold_bp.route('/<run_id>/impact', methods=['POST'])
def get_impact_analysis(run_id):
    """
    ✅ NEW: Dedicated endpoint for comprehensive impact analysis
    
    POST /api/v2/calibration/threshold/{run_id}/impact
    Body: {
        "threshold": 50000,
        "percentile": 92,
        "metric": "amount"
    }
    """
    try:
        data = request.get_json()
        threshold = float(data.get('threshold'))
        percentile = float(data.get('percentile', 50))
        metric = data.get('metric', 'amount')
        
        db = services.get_calibration_db()
        impact_service = CalibrationImpactService(db)
        
        # Get comprehensive impact
        impact = impact_service.get_comprehensive_impact(
            run_id=run_id,
            threshold=threshold,
            percentile=percentile,
            metric=metric
        )
        
        return jsonify({
            'success': True,
            'impact': impact
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500