# backend/api/routes/threshold.py (Enhanced Version)

from flask import Blueprint, request, jsonify
from api.services import services
from datetime import datetime
import traceback
import json

threshold_bp = Blueprint('threshold', __name__)

# ==========================================
# DATA GENERATION (REALISTIC)
# ==========================================

@threshold_bp.route('/data/generate-realistic', methods=['POST'])
def generate_realistic_data():
    """
    Generate realistic AML transaction data with sophisticated patterns
    """
    try:
        from services.realistic_data_generator import RealisticAMLDataGenerator
        
        data = request.json
        num_transactions = data.get('numTransactions', 100000)
        suspicious_rate = data.get('suspiciousRate', 0.05)
        num_customers = data.get('numCustomers', 10000)
        date_range_days = data.get('dateRangeDays', 365)
        
        if not services.db_manager:
            return jsonify({'error': 'No active environment'}), 400
        
        print(f"\n🚀 Generating Realistic AML Data...")
        print(f"   Transactions: {num_transactions:,}")
        print(f"   Customers: {num_customers:,}")
        print(f"   Suspicious Rate: {suspicious_rate*100}%")
        print(f"   Date Range: {date_range_days} days")
        
        # Initialize generator
        generator = RealisticAMLDataGenerator()
        
        # Step 1: Generate customers
        print("\n👥 Generating customers...")
        customers = generator.generate_customers(num_customers)
        
        # Step 2: Generate transactions
        print("\n💳 Generating transactions...")
        transactions = generator.generate_transactions(
            customers=customers,
            num_transactions=num_transactions,
            suspicious_rate=suspicious_rate,
            date_range_days=date_range_days
        )
        
        # Step 3: Save to database
        print("\n💾 Saving to database...")
        generator.save_to_database(
            db_manager=services.db_manager,
            transactions=transactions,
            customers=customers
        )
        
        # Step 4: Update dataset registry
        conn = services.db_manager.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE calibration_datasets 
            SET record_count = ?,
                date_range_start = ?,
                date_range_end = ?
            WHERE dataset_id = 'synthetic_v1'
        """, (
            len(transactions),
            transactions['timestamp'].min().strftime('%Y-%m-%d'),
            transactions['timestamp'].max().strftime('%Y-%m-%d')
        ))
        
        conn.commit()
        services.db_manager.close_connection(conn)
        
        # Calculate statistics
        stats = {
            'customers': len(customers),
            'transactions': len(transactions),
            'suspicious': int(transactions['is_suspicious'].sum()),
            'suspicious_rate': round(transactions['is_suspicious'].mean() * 100, 2),
            'total_volume': float(transactions['amount'].sum()),
            'avg_amount': float(transactions['amount'].mean()),
            'date_range': {
                'start': transactions['timestamp'].min().isoformat(),
                'end': transactions['timestamp'].max().isoformat()
            },
            'patterns': transactions['transaction_type'].value_counts().to_dict()
        }
        
        return jsonify({
            'success': True,
            'message': f'Generated {len(transactions):,} realistic transactions',
            'stats': stats
        })
    
    except Exception as e:
        print(f"❌ Error generating data: {e}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==========================================
# CALIBRATION SWEEP (ENHANCED)
# ==========================================

@threshold_bp.route('/calibration/sweep-enhanced', methods=['POST'])
def threshold_sweep_enhanced():
    """
    Run enhanced threshold sweep with real data processing
    """
    try:
        data = request.json
        rule_id = data.get('ruleId')
        dataset_id = data.get('datasetId', 'synthetic_v1')
        min_threshold = float(data.get('minThreshold'))
        max_threshold = float(data.get('maxThreshold'))
        num_points = int(data.get('numPoints', 30))
        
        if not services.threshold_calibration:
            return jsonify({'error': 'Calibration service not available'}), 400
        
        print(f"\n🔄 Running Enhanced Threshold Sweep")
        print(f"   Rule: {rule_id}")
        print(f"   Range: {min_threshold} → {max_threshold}")
        print(f"   Points: {num_points}")
        
        # Use enhanced service
        from services.enhanced_threshold_calibration import EnhancedThresholdCalibrationService
        enhanced_service = EnhancedThresholdCalibrationService(services.db_manager)
        
        results = enhanced_service.run_threshold_sweep(
            rule_id=rule_id,
            dataset_id=dataset_id,
            min_threshold=min_threshold,
            max_threshold=max_threshold,
            num_points=num_points
        )
        
        # Find optimal point
        optimal = max(results, key=lambda x: x['f1_score'])
        
        return jsonify({
            'success': True,
            'sweepResults': results,
            'optimal': optimal,
            'summary': {
                'totalPoints': len(results),
                'bestThreshold': optimal['threshold'],
                'bestF1Score': optimal['f1_score'],
                'suppressionRange': [
                    min(r['suppression'] for r in results),
                    max(r['suppression'] for r in results)
                ],
                'eventLossRange': [
                    min(r['event_loss'] for r in results),
                    max(r['event_loss'] for r in results)
                ]
            }
        })
    
    except Exception as e:
        print(f"❌ Error in sweep: {e}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==========================================
# SCENARIO EXECUTION (ENHANCED)
# ==========================================

@threshold_bp.route('/scenarios/run-enhanced', methods=['POST'])
def run_scenario_enhanced():
    """
    Execute scenario with detailed analysis
    """
    try:
        data = request.json
        scenario_name = data.get('scenarioName')
        rule_id = data.get('ruleId')
        threshold = float(data.get('threshold'))
        dataset_id = data.get('datasetId', 'synthetic_v1')
        
        if not services.threshold_calibration:
            return jsonify({'error': 'Calibration service not available'}), 400
        
        print(f"\n⚙️  Running Scenario: {scenario_name}")
        print(f"   Rule: {rule_id}")
        print(f"   Threshold: {threshold}")
        
        # Create scenario record
        conn = services.db_manager.connect()
        cursor = conn.cursor()
        
        scenario_id = f"SCN_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        cursor.execute("""
            INSERT INTO calibration_scenarios (
                scenario_id, scenario_name, rule_id, dataset_id,
                status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
        """, (
            scenario_id,
            scenario_name,
            rule_id,
            dataset_id,
            'running',
            datetime.now().isoformat()
        ))
        conn.commit()
        
        # Use enhanced service
        from services.enhanced_threshold_calibration import EnhancedThresholdCalibrationService
        enhanced_service = EnhancedThresholdCalibrationService(services.db_manager)
        
        # Load data and run
        transactions = enhanced_service.load_real_transaction_data(dataset_id)
        ground_truth = enhanced_service.get_ground_truth_labels(dataset_id)
        
        alerts = enhanced_service.apply_rule_with_threshold(
            rule_id=rule_id,
            transactions=transactions,
            threshold=threshold
        )
        
        metrics = enhanced_service.calculate_comprehensive_metrics(
            alerts=alerts,
            ground_truth=ground_truth,
            total_cases=len(transactions)
        )
        
        # Save experiment
        experiment_id = f"EXP_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        cursor.execute("""
            INSERT INTO calibration_experiments (
                experiment_id, scenario_id, rule_id, threshold_value,
                suppression_rate, event_loss_rate, precision_score,
                recall_score, f1_score, alerts_generated,
                true_positives, false_positives, false_negatives,
                true_negatives, status, executed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            experiment_id,
            scenario_id,
            rule_id,
            threshold,
            metrics['suppression'],
            metrics['event_loss'],
            metrics['precision'],
            metrics['recall'],
            metrics['f1_score'],
            metrics['total_alerts'],
            metrics['tp'],
            metrics['fp'],
            metrics['fn'],
            metrics['tn'],
            'completed',
            datetime.now().isoformat()
        ))
        
        # Update scenario status
        cursor.execute("""
            UPDATE calibration_scenarios 
            SET status = 'completed'
            WHERE scenario_id = ?
        """, (scenario_id,))
        
        conn.commit()
        services.db_manager.close_connection(conn)
        
        # Get current rule metrics for comparison
        cursor = conn.cursor()
        cursor.execute("""
            SELECT suppression_rate, event_loss_rate, f1_score, threshold_value
            FROM aml_rules
            WHERE rule_id = ?
        """, (rule_id,))
        
        current = cursor.fetchone()
        
        comparison = None
        if current:
            comparison = {
                'suppressionChange': round(metrics['suppression'] - (current[0] or 0), 2),
                'eventLossChange': round(metrics['event_loss'] - (current[1] or 0), 2),
                'f1ScoreChange': round(metrics['f1_score'] - (current[2] or 0), 2),
                'thresholdChange': round(threshold - (current[3] or 0), 2)
            }
        
        return jsonify({
            'success': True,
            'experimentId': experiment_id,
            'scenarioId': scenario_id,
            'results': {
                'scenario': scenario_name,
                'rule': rule_id,
                'threshold': threshold,
                'metrics': metrics,
                'comparison': comparison
            }
        })
    
    except Exception as e:
        print(f"❌ Error running scenario: {e}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==========================================
# BATCH ANALYSIS
# ==========================================

@threshold_bp.route('/analysis/batch-compare', methods=['POST'])
def batch_compare_rules():
    """
    Compare multiple rules at once
    """
    try:
        data = request.json
        rule_ids = data.get('ruleIds', [])
        dataset_id = data.get('datasetId', 'synthetic_v1')
        
        from services.enhanced_threshold_calibration import EnhancedThresholdCalibrationService
        enhanced_service = EnhancedThresholdCalibrationService(services.db_manager)
        
        # Load data once
        transactions = enhanced_service.load_real_transaction_data(dataset_id)
        ground_truth = enhanced_service.get_ground_truth_labels(dataset_id)
        
        results = []
        
        for rule_id in rule_ids:
            rule = enhanced_service._get_rule(rule_id)
            if not rule:
                continue
            
            alerts = enhanced_service.apply_rule_with_threshold(
                rule_id=rule_id,
                transactions=transactions,
                threshold=rule['threshold']
            )
            
            metrics = enhanced_service.calculate_comprehensive_metrics(
                alerts=alerts,
                ground_truth=ground_truth,
                total_cases=len(transactions)
            )
            
            results.append({
                'ruleId': rule_id,
                'ruleName': rule['name'],
                'threshold': rule['threshold'],
                'metrics': metrics
            })
        
        return jsonify({
            'success': True,
            'results': results,
            'summary': {
                'avgSuppression': sum(r['metrics']['suppression'] for r in results) / len(results),
                'avgEventLoss': sum(r['metrics']['event_loss'] for r in results) / len(results),
                'avgF1Score': sum(r['metrics']['f1_score'] for r in results) / len(results),
                'totalAlerts': sum(r['metrics']['total_alerts'] for r in results)
            }
        })
    
    except Exception as e:
        print(f"❌ Error in batch compare: {e}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==========================================
# STATISTICAL VALIDATION
# ==========================================

@threshold_bp.route('/analysis/statistical-validation', methods=['POST'])
def statistical_validation():
    """
    Perform statistical validation of calibration results
    """
    try:
        data = request.json
        experiment_id = data.get('experimentId')
        
        # Fetch experiment data
        conn = services.db_manager.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM calibration_experiments
            WHERE experiment_id = ?
        """, (experiment_id,))
        
        exp = cursor.fetchone()
        if not exp:
            return jsonify({'error': 'Experiment not found'}), 404
        
        # Calculate statistical metrics
        tp, fp, fn, tn = exp[10], exp[11], exp[12], exp[13]
        
        # Chi-square test
        from scipy.stats import chi2_contingency
        observed = [[tp, fp], [fn, tn]]
        chi2, p_value, dof, expected = chi2_contingency(observed)
        
        # Effect size (Cohen's h)
        p1 = tp / (tp + fp) if (tp + fp) > 0 else 0
        p2 = 0.5  # null hypothesis
        cohens_h = 2 * (np.arcsin(np.sqrt(p1)) - np.arcsin(np.sqrt(p2)))
        
        services.db_manager.close_connection(conn)
        
        return jsonify({
            'success': True,
            'validation': {
                'chi_square': {
                    'statistic': float(chi2),
                    'p_value': float(p_value),
                    'significant': p_value < 0.05
                },
                'effect_size': {
                    'cohens_h': float(cohens_h),
                    'interpretation': 'large' if abs(cohens_h) > 0.8 else 'medium' if abs(cohens_h) > 0.5 else 'small'
                },
                'sample_size_adequate': (tp + fp + fn + tn) > 1000
            }
        })
    
    except Exception as e:
        print(f"❌ Error in validation: {e}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500