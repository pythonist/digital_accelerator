# backend/api/routes/calibration.py
"""
Calibration API Routes (Complete Implementation)
Handles all calibration workflow endpoints with proper tenant context
"""
from flask import Blueprint, request, jsonify
import traceback
import uuid
from datetime import datetime

calibration_bp = Blueprint('calibration', __name__)

# Import calibration services (lazy import to avoid circular dependencies)
def get_calibration_services():
    from api.services import services
    return services

# ============================================================================
# DATA LOADING ENDPOINTS
# ============================================================================

@calibration_bp.route('/data/upload', methods=['POST'])
def upload_calibration_data():
    """
    Upload CSV file for calibration (transactions/accounts/customers)
    
    Body (multipart/form-data):
        file: CSV file
        table_name: transactions | accounts | customers
        env_id: environment identifier
    """
    try:
        # Get file and metadata
        file = request.files.get('file')
        table_name = request.form.get('table_name')
        env_id = request.form.get('env_id') or request.headers.get('X-Environment-ID')
        
        if not file:
            return jsonify({'error': 'No file provided'}), 400
        
        if not table_name:
            return jsonify({'error': 'table_name required'}), 400
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        # Validate table name
        valid_tables = ['transactions', 'accounts', 'customers']
        if table_name not in valid_tables:
            return jsonify({'error': f'Invalid table_name. Must be one of: {valid_tables}'}), 400
        
        # Save file temporarily
        import os
        temp_dir = f"data/calibration/{env_id}/uploads"
        os.makedirs(temp_dir, exist_ok=True)
        
        file_path = os.path.join(temp_dir, f"{table_name}.csv")
        file.save(file_path)
        
        # Import and use calibration data ingestion
        from aml_investigation_system.backend.calibration.services.calibration_data_ingestion import CalibrationDataIngestionService
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        
        db_manager = CalibrationDatabaseManager()
        ingestion_service = CalibrationDataIngestionService(db_manager)
        
        # Load data
        stats = ingestion_service.load_csv_to_db(file_path, table_name, env_id)
        
        # Check if all data is ready
        readiness = ingestion_service.check_data_readiness(env_id)
        
        return jsonify({
            'success': True,
            'table': table_name,
            'stats': stats,
            'readiness': readiness
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@calibration_bp.route('/data/stats', methods=['GET'])
def get_data_stats():
    """Get upload status AND Golden Dataset status"""
    try:
        env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID')
        if not env_id: return jsonify({'error': 'env_id required'}), 400
        
        from aml_investigation_system.backend.calibration.services.calibration_data_ingestion import CalibrationDataIngestionService
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        
        db_manager = CalibrationDatabaseManager()
        ingestion_service = CalibrationDataIngestionService(db_manager)
        
        # 1. Check Raw Files (Transactions, Accounts, Customers)
        stats = ingestion_service.get_table_stats(env_id)
        
        # 2. Check Golden Dataset (FIX: This was missing!)
        conn = db_manager.connect()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT row_count, status, created_at 
            FROM golden_dataset_cache 
            WHERE env_id = ? AND status = 'ready' 
            ORDER BY created_at DESC LIMIT 1
        """, (env_id,))
        golden_row = cursor.fetchone()
        conn.close()
        
        if golden_row:
            stats['golden_rows'] = golden_row['row_count']
            stats['golden_built_at'] = golden_row['created_at']
            stats['golden_ready'] = True
        else:
            stats['golden_rows'] = 0
            stats['golden_ready'] = False
            
        readiness = ingestion_service.check_data_readiness(env_id)
        
        # If golden is ready, the whole environment is "Data Ready"
        readiness['golden_ready'] = stats['golden_ready']
        
        return jsonify({'success': True, 'stats': stats, 'readiness': readiness})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@calibration_bp.route('/data/build-golden', methods=['POST'])
def build_golden_dataset():
    """
    Build golden dataset (joined TRANSACTIONS + ACCOUNTS + CUSTOMERS)
    This is Step 0 - must be done before starting calibration workflow
    """
    try:
        data = request.json
        env_id = data.get('env_id') or request.headers.get('X-Environment-ID')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        from aml_investigation_system.backend.calibration.services.golden_dataset_builder import GoldenDatasetBuilder
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        
        db_manager = CalibrationDatabaseManager()
        builder = GoldenDatasetBuilder(db_manager)
        
        # Build golden dataset
        result = builder.build_golden_dataset(env_id)
        
        return jsonify({
            'success': True,
            'result': result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ============================================================================
# CALIBRATION RUN MANAGEMENT
# ============================================================================

@calibration_bp.route('/run/create', methods=['POST'])
def create_calibration_run():
    """Create new calibration run"""
    try:
        data = request.json
        env_id = data.get('env_id') or request.headers.get('X-Environment-ID')
        scenario_name = data.get('scenario_name', f"Scenario {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        
        # Get user from context (set by tenant_context middleware)
        user = getattr(request, 'username', 'anonymous')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        
        db_manager = CalibrationDatabaseManager()
        conn = db_manager.connect()
        cursor = conn.cursor()
        
        # Generate run ID
        run_id = str(uuid.uuid4())
        
        # Create run
        cursor.execute("""
            INSERT INTO calibration_runs 
            (run_id, env_id, scenario_name, created_by, status, current_step)
            VALUES (?, ?, ?, ?, 'draft', 1)
        """, (run_id, env_id, scenario_name, user))
        
        conn.commit()
        
        # Log action
        db_manager.log_action(run_id, user, 'run_created', {'scenario_name': scenario_name})
        
        # Fetch created run
        cursor.execute("SELECT * FROM calibration_runs WHERE run_id = ?", (run_id,))
        run = dict(cursor.fetchone())
        
        conn.close()
        
        return jsonify({
            'success': True,
            'run': run
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@calibration_bp.route('/run/<run_id>', methods=['GET'])
def get_calibration_run(run_id):
    """Get calibration run details"""
    try:
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        
        db_manager = CalibrationDatabaseManager()
        conn = db_manager.connect()
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM calibration_runs WHERE run_id = ?", (run_id,))
        run = cursor.fetchone()
        
        if not run:
            return jsonify({'error': 'Run not found'}), 404
        
        run_dict = dict(run)
        conn.close()
        
        return jsonify({
            'success': True,
            'run': run_dict
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@calibration_bp.route('/runs', methods=['GET'])
def list_calibration_runs():
    """List calibration runs for environment"""
    try:
        env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID')
        status = request.args.get('status')  # Optional filter
        limit = int(request.args.get('limit', 50))
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        
        db_manager = CalibrationDatabaseManager()
        conn = db_manager.connect()
        cursor = conn.cursor()
        
        # Build query
        query = "SELECT * FROM calibration_runs WHERE env_id = ?"
        params = [env_id]
        
        if status:
            query += " AND status = ?"
            params.append(status)
        
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        runs = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'runs': runs,
            'count': len(runs)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@calibration_bp.route('/run/<run_id>', methods=['DELETE'])
def delete_calibration_run(run_id):
    """Delete calibration run"""
    try:
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        
        db_manager = CalibrationDatabaseManager()
        conn = db_manager.connect()
        cursor = conn.cursor()
        
        cursor.execute("DELETE FROM calibration_runs WHERE run_id = ?", (run_id,))
        conn.commit()
        
        deleted = cursor.rowcount > 0
        conn.close()
        
        if not deleted:
            return jsonify({'error': 'Run not found'}), 404
        
        return jsonify({
            'success': True,
            'message': 'Run deleted successfully'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# STEP 1: SCENARIO DEFINITION
# ============================================================================

@calibration_bp.route('/run/<run_id>/scenario', methods=['POST'])
def define_scenario(run_id):
    """
    Define scenario filters (Step 1)
    
    Body:
        scenario_config: {
            transaction_filters: {...},
            customer_filters: {...},
            account_filters: {...}
        }
    """
    try:
        data = request.json
        scenario_config = data.get('scenario_config')
        
        if not scenario_config:
            return jsonify({'error': 'scenario_config required'}), 400
        
        # TODO: Apply filters to golden dataset
        # For now, just store config
        
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        import json
        
        db_manager = CalibrationDatabaseManager()
        conn = db_manager.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE calibration_runs 
            SET scenario_config = ?, current_step = 2, updated_at = CURRENT_TIMESTAMP
            WHERE run_id = ?
        """, (json.dumps(scenario_config), run_id))
        
        conn.commit()
        
        # Fetch updated run
        cursor.execute("SELECT * FROM calibration_runs WHERE run_id = ?", (run_id,))
        run = dict(cursor.fetchone())
        
        conn.close()
        
        return jsonify({
            'success': True,
            'run': run,
            'message': 'Scenario defined successfully'
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ============================================================================
# MORE ENDPOINTS TO FOLLOW (Aggregation, Percentiles, Threshold Selection)
# ============================================================================

@calibration_bp.route('/health', methods=['GET'])
def calibration_health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'calibration',
        'timestamp': datetime.now().isoformat()
    })

@calibration_bp.route('/data/preview', methods=['GET'])
def preview_calibration_data():
    """
    Preview data from calibration tables (transactions, accounts, etc.)
    Query Params: env_id, table (transactions|accounts|customers|golden)
    """
    try:
        env_id = request.args.get('env_id') or request.headers.get('X-Environment-ID')
        table_type = request.args.get('table')
        limit = int(request.args.get('limit', 50))
        
        if not env_id or not table_type:
            return jsonify({'error': 'env_id and table required'}), 400
        
        # Determine actual table name in DB
        # If looking for 'golden', find the latest golden table from cache
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        db_manager = CalibrationDatabaseManager()
        conn = db_manager.connect()
        cursor = conn.cursor()
        
        target_table_name = None
        
        if table_type == 'golden':
            cursor.execute("""
                SELECT file_path FROM golden_dataset_cache 
                WHERE env_id = ? AND status = 'ready' 
                ORDER BY created_at DESC LIMIT 1
            """, (env_id,))
            row = cursor.fetchone()
            if row:
                target_table_name = row[0] # We stored table_name in file_path column
        else:
            target_table_name = f"{env_id}_{table_type}"
            
        if not target_table_name:
            return jsonify({'error': 'Table not found'}), 404

        # Fetch Data
        try:
            # Get columns
            cursor.execute(f"PRAGMA table_info('{target_table_name}')")
            cols = [r[1] for r in cursor.fetchall()]
            
            # Get rows
            cursor.execute(f'SELECT * FROM "{target_table_name}" LIMIT ?', (limit,))
            rows = [dict(zip(cols, row)) for row in cursor.fetchall()]
            
            conn.close()
            
            return jsonify({
                'success': True,
                'table': table_type,
                'columns': cols,
                'data': rows,
                'count': len(rows)
            })
            
        except Exception as e:
            conn.close()
            return jsonify({'error': f"Table read error: {str(e)}"}), 500

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
@calibration_bp.route('/run/<run_id>/aggregate', methods=['POST'])
def run_aggregation(run_id):
    """
    Step 2: Run Aggregation Engine
    """
    try:
        data = request.json
        agg_config = data.get('aggregation_config')
        env_id = data.get('env_id') or request.headers.get('X-Environment-ID')
        
        if not agg_config:
            return jsonify({'error': 'aggregation_config required'}), 400
            
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        from calibration.scenario_engine import ScenarioEngine
        from calibration.aggregation_engine import AggregationEngine
        from aml_investigation_system.backend.calibration.services.golden_dataset_builder import GoldenDatasetBuilder
        import json
        
        db_manager = CalibrationDatabaseManager()
        
        # 1. Re-load golden dataset & re-apply scenario filters
        # (Optimized: In prod, you might cache the filtered DF, but recalculating is safer for stateless)
        builder = GoldenDatasetBuilder(db_manager)
        golden_df = builder.load_golden_dataset(env_id)
        
        # Load run to get scenario config
        run_manager = CalibrationRunManager(db_manager.connect())
        run = run_manager.get_run(run_id)
        
        if not run or not run['scenario_config']:
            return jsonify({'error': 'Run or scenario config not found'}), 404
            
        scenario_engine = ScenarioEngine(golden_df)
        scenario_df, _ = scenario_engine.apply_scenario(run['scenario_config'])
        
        # 2. Run Aggregation
        agg_engine = AggregationEngine(scenario_df)
        aggregated_df, stats = agg_engine.aggregate(agg_config)
        
        # 3. Save Aggregation Config & State
        conn = db_manager.connect()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE calibration_runs 
            SET aggregation_config = ?, 
                aggregated_population_count = ?,
                current_step = 3,
                status = 'AGGREGATED',
                updated_at = CURRENT_TIMESTAMP
            WHERE run_id = ?
        """, (json.dumps(agg_config), len(aggregated_df), run_id))
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'run': run_manager.get_run(run_id),
            'stats': stats
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# ============================================================================
# STEP 3: PERCENTILES
# ============================================================================

@calibration_bp.route('/run/<run_id>/percentiles', methods=['GET'])
def get_percentiles(run_id):
    """
    Step 3: Compute/Get Percentiles
    """
    try:
        env_id = request.args.get('env_id')
        metric = request.args.get('metric', 'amount')
        
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        from aml_investigation_system.backend.calibration.services.golden_dataset_builder import GoldenDatasetBuilder
        from calibration.scenario_engine import ScenarioEngine
        from calibration.aggregation_engine import AggregationEngine
        from calibration.percentile_engine import PercentileEngine
        
        # ✅ FIX: Correct import path
        from aml_investigation_system.backend.calibration.services.run_manager import CalibrationRunManager

        db_manager = CalibrationDatabaseManager()
        perc_engine = PercentileEngine(db_manager.connect())
        
        # Check if we already have percentiles
        cached_percentiles = perc_engine.get_percentiles(run_id, metric)
        if cached_percentiles:
            return jsonify({'success': True, 'percentiles': cached_percentiles})
            
        # If not, compute them (requires rebuilding DF)
        builder = GoldenDatasetBuilder(db_manager)
        golden_df = builder.load_golden_dataset(env_id)
        
        run_manager = CalibrationRunManager(db_manager.connect())
        run = run_manager.get_run(run_id)
        
        scenario_engine = ScenarioEngine(golden_df)
        scenario_df, _ = scenario_engine.apply_scenario(run['scenario_config'])
        
        agg_engine = AggregationEngine(scenario_df)
        aggregated_df, _ = agg_engine.aggregate(run['aggregation_config'])
        
        percentiles = perc_engine.compute_percentiles(run_id, aggregated_df, metric)
        
        return jsonify({
            'success': True, 
            'percentiles': percentiles
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
# ============================================================================
# STEP 4: SIMULATION
# ============================================================================

@calibration_bp.route('/run/<run_id>/simulate', methods=['POST'])
def simulate_threshold(run_id):
    """
    Step 4: Simulate Threshold Impact
    """
    try:
        data = request.json
        threshold = float(data.get('threshold'))
        metric = data.get('metric', 'amount')
        env_id = data.get('env_id')
        
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        from calibration.threshold_simulator import ThresholdSimulator
        from aml_investigation_system.backend.calibration.services.golden_dataset_builder import GoldenDatasetBuilder
        from calibration.scenario_engine import ScenarioEngine
        from calibration.aggregation_engine import AggregationEngine
        
        db_manager = CalibrationDatabaseManager()
        
        # Rebuild Context (Standardize this into a helper function in prod)
        builder = GoldenDatasetBuilder(db_manager)
        golden_df = builder.load_golden_dataset(env_id)
        run_manager = CalibrationRunManager(db_manager.connect())
        run = run_manager.get_run(run_id)
        scenario_engine = ScenarioEngine(golden_df)
        scenario_df, _ = scenario_engine.apply_scenario(run['scenario_config'])
        agg_engine = AggregationEngine(scenario_df)
        aggregated_df, _ = agg_engine.aggregate(run['aggregation_config'])
        
        # Simulate
        simulator = ThresholdSimulator(db_manager)
        result = simulator.simulate_threshold(run_id, aggregated_df, threshold, metric)
        
        return jsonify({
            'success': True,
            'simulation': result
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@calibration_bp.route('/run/<run_id>/select-threshold', methods=['POST'])
def select_threshold(run_id):
    """
    Step 4: Confirm Selection
    """
    try:
        data = request.json
        threshold = data.get('threshold')
        percentile = data.get('percentile')
        alert_count = data.get('alert_count')
        
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        db_manager = CalibrationDatabaseManager()
        run_manager = CalibrationRunManager(db_manager.connect())
        
        updated_run = run_manager.select_threshold(run_id, threshold, percentile, alert_count)
        
        return jsonify({
            'success': True,
            'run': updated_run
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============================================================================
# STEP 5: APPROVAL
# ============================================================================

@calibration_bp.route('/run/<run_id>/approve', methods=['POST'])
def approve_run(run_id):
    data = request.json
    comment = data.get('comment')
    user = getattr(request, 'username', 'admin') # From middleware
    
    from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
    db_manager = CalibrationDatabaseManager()
    run_manager = CalibrationRunManager(db_manager.connect())
    
    updated_run = run_manager.approve_run(run_id, user, comment)
    return jsonify({'success': True, 'run': updated_run})

@calibration_bp.route('/run/<run_id>/reject', methods=['POST'])
def reject_run(run_id):
    data = request.json
    comment = data.get('comment')
    user = getattr(request, 'username', 'admin')
    
    from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
    db_manager = CalibrationDatabaseManager()
    run_manager = CalibrationRunManager(db_manager.connect())
    
    updated_run = run_manager.reject_run(run_id, user, comment)
    return jsonify({'success': True, 'run': updated_run})
# ... inside calibration.py ...

# ============================================================================
# LIVE PREVIEW ENDPOINTS (For Reactive UI)
# ============================================================================

@calibration_bp.route('/run/<run_id>/scenario/preview', methods=['POST'])
def preview_scenario_impact(run_id):
    """
    Dry-run the scenario filters to show live impact.
    Returns step-by-step reduction stats.
    """
    try:
        data = request.json
        scenario_config = data.get('scenario_config')
        env_id = data.get('env_id')
        
        # 1. Load Golden Data (Cached)
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        from aml_investigation_system.backend.calibration.services.golden_dataset_builder import GoldenDatasetBuilder
        from calibration.scenario_engine import ScenarioEngine
        
        db_manager = CalibrationDatabaseManager()
        builder = GoldenDatasetBuilder(db_manager)
        golden_df = builder.load_golden_dataset(env_id)
        
        # 2. Run Engine (Dry Run)
        engine = ScenarioEngine(golden_df)
        _, stats = engine.apply_scenario(scenario_config)
        
        # 3. Return Stats Only (No DB Save)
        return jsonify({
            'success': True,
            'stats': stats,
            'message': 'Impact calculated'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@calibration_bp.route('/run/<run_id>/aggregate/preview', methods=['POST'])
def preview_aggregation_impact(run_id):
    """
    Dry-run the aggregation to show row count changes (e.g. Transactions -> Accounts).
    """
    try:
        data = request.json
        agg_config = data.get('aggregation_config')
        env_id = data.get('env_id')
        
        from aml_investigation_system.backend.calibration.services.calibration_db_schema import CalibrationDatabaseManager
        from aml_investigation_system.backend.calibration.services.golden_dataset_builder import GoldenDatasetBuilder
        from calibration.scenario_engine import ScenarioEngine
        from calibration.aggregation_engine import AggregationEngine
        from aml_investigation_system.backend.calibration.services.run_manager import CalibrationRunManager
        
        db_manager = CalibrationDatabaseManager()
        run_manager = CalibrationRunManager(db_manager.connect())
        
        # Reconstruct Pipeline (Fast Rebuild)
        builder = GoldenDatasetBuilder(db_manager)
        golden_df = builder.load_golden_dataset(env_id)
        
        # Get current scenario filters from the RUN (since we are in Step 2)
        run = run_manager.get_run(run_id)
        scenario_engine = ScenarioEngine(golden_df)
        scenario_df, _ = scenario_engine.apply_scenario(run['scenario_config'])
        
        # Run Aggregation Dry Run
        agg_engine = AggregationEngine(scenario_df)
        aggregated_df, stats = agg_engine.aggregate(agg_config)
        
        return jsonify({
            'success': True,
            'stats': stats,
            'input_rows': len(scenario_df),
            'output_rows': len(aggregated_df)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
# Helper for run management (duplicate of class in run_manager.py, ensure it's imported)
from aml_investigation_system.backend.calibration.services.run_manager import CalibrationRunManager