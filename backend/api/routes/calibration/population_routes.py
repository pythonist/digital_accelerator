# backend/api/routes/calibration/population_routes.py
"""
Population Explorer Routes - Step 1
Real-time query-based exploration - NO PERSISTENCE
"""
from flask import Blueprint, request, jsonify
from api.services import services
from calibration.services.population_explorer_service import PopulationExplorerService
import traceback
import json
population_bp = Blueprint('calibration_population', __name__)


@population_bp.route('/<run_id>/explore', methods=['POST'])
def explore_population(run_id):
    """
    STEP 1: Explore population with live filters
    
    POST /api/v2/calibration/population/{run_id}/explore
    Body: {
        "env_id": "xxx",
        "filters": {
            "transaction_filters": {...},
            "customer_filters": {...},
            "account_filters": {...}
        }
    }
    
    Returns:
        {
            "success": true,
            "stats": {
                "original_count": 100000,
                "filtered_count": 45000,
                "reduction_pct": 55.0,
                "unique_accounts": 1200,
                "unique_customers": 800,
                "filters_applied": ["Transaction Category: CASH, UPI", ...],
                "reduction_by_filter": {"Category": 20000, "Amount": 35000}
            }
        }
    
    NOTE: This endpoint does NOT save anything. It's purely for exploration.
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        filters = data.get('filters')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        if not filters:
            filters = {}
        
        # Get service
        db = services.get_calibration_db()
        explorer = PopulationExplorerService(db)
        
        # Execute exploration query
        stats = explorer.explore_population(run_id, env_id, filters)
        
        return jsonify({
            'success': True,
            'stats': stats
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@population_bp.route('/<run_id>/filter-options', methods=['GET'])
def get_filter_options(run_id):
    """
    Get available filter options from uploaded data
    
    GET /api/v2/calibration/population/{run_id}/filter-options?env_id=xxx
    
    Returns unique values for dropdowns directly from raw uploaded tables.
    Does NOT use golden dataset.
    """
    try:
        env_id = request.args.get('env_id')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        db = services.get_calibration_db()
        explorer = PopulationExplorerService(db)
        
        filter_options = explorer.get_filter_options(run_id, env_id)
        
        return jsonify({
            'success': True,
            'filters': filter_options
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@population_bp.route('/<run_id>/confirm', methods=['POST'])
def confirm_population_filters(run_id):
    """
    STEP 1 -> STEP 2 Transition: Confirm filters and advance workflow
    
    POST /api/v2/calibration/population/{run_id}/confirm
    Body: {
        "env_id": "xxx",
        "filters": {...}
    }
    
    This is the ONLY endpoint that:
    - Saves the filter configuration
    - Updates run status to 'population_confirmed'
    - Advances to STEP 2
    
    Does NOT materialize data yet - that happens in aggregation step.
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        filters = data.get('filters')
        
        if not env_id or not filters:
            return jsonify({'error': 'env_id and filters required'}), 400
        
        db = services.get_calibration_db()
        explorer = PopulationExplorerService(db)
        
        # Confirm and save filters
        result = explorer.confirm_population_filters(run_id, env_id, filters)
        
        return jsonify({
            'success': True,
            'message': 'Population filters confirmed',
            'run': result['run']
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    
@population_bp.route('/<run_id>/preview', methods=['POST'])
def preview_population_data(run_id):
    """
    ZONE 5: Get sample data for the current filter set
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        filters = data.get('filters')
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        db = services.get_calibration_db()
        explorer = PopulationExplorerService(db)
        
        # Get preview rows
        preview = explorer.preview_population(run_id, env_id, filters)
        
        return jsonify({
            'success': True,
            'preview': preview
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    
@population_bp.route('/<run_id>/enhanced-stats', methods=['POST'])
def get_enhanced_stats(run_id):
    """
    Get enhanced population statistics
    POST /api/v2/calibration/population/{run_id}/enhanced-stats
    Body: {
        "env_id": "xxx",
        "filters": {...}
    }
    
    Returns cardinality, excluded summary, warnings
    """
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        filters = data.get('filters', {})
        
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        db = services.get_calibration_db()
        
        # Get base stats from explorer
        from calibration.services.population_explorer_service import PopulationExplorerService
        explorer = PopulationExplorerService(db)
        base_stats = explorer.explore_population(run_id, env_id, filters)
        
        # Load population DataFrame for cardinality
        df = explorer.fetch_population_dataframe(run_id, env_id, filters, limit=50000)
        
        # Compute enhanced stats
        from calibration.services.population_stats_service import PopulationStatsService
        stats_service = PopulationStatsService(db)
        
        cardinality = stats_service.compute_cardinality_stats(df)
        
        # Get mapping for excluded analysis
        conn = db.connect()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT mapping_config FROM schema_mappings 
            WHERE env_id = ? AND mapping_type = 'golden_source'
        """, (env_id,))
        row = cursor.fetchone()
        mapping = json.loads(row[0]) if row and row[0] else {}
        conn.close()
        
        excluded = stats_service.compute_excluded_summary(run_id, env_id, filters, mapping)
        
        # Combine stats
        enhanced_stats = {
            **base_stats,
            'cardinality': cardinality,
            'excluded_summary': excluded
        }
        
        # Generate warnings
        warnings = stats_service.generate_warnings(enhanced_stats)
        enhanced_stats['warnings'] = warnings
        
        return jsonify({
            'success': True,
            'stats': enhanced_stats
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@population_bp.route('/<run_id>/narrative', methods=['POST'])
def generate_narrative(run_id):
    """
    Generate population narrative
    POST /api/v2/calibration/population/{run_id}/narrative
    Body: {
        "scenario_name": "Total Cash Transactions",
        "filters": {...},
        "stats": {...}
    }
    """
    try:
        data = request.get_json()
        scenario_name = data.get('scenario_name', 'Scenario')
        filters = data.get('filters', {})
        stats = data.get('stats')
        
        from calibration.services.population_narrative_service import PopulationNarrativeService
        
        narrative = PopulationNarrativeService.generate_narrative(
            scenario_name, filters, stats
        )
        
        filter_summary = PopulationNarrativeService.generate_filter_summary(filters)
        
        return jsonify({
            'success': True,
            'narrative': {
                'auto_narrative': narrative,
                'editable': True,
                'frozen': False,
                'filters_summary': filter_summary
            }
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    
@population_bp.route('/<run_id>/debug-filters', methods=['GET'])
def debug_filters(run_id):
    """Debug endpoint to see what's actually in the view"""
    env_id = request.args.get('env_id')
    
    if not env_id:
        return jsonify({'error': 'env_id required'}), 400
    
    db = services.get_calibration_db()
    explorer = PopulationExplorerService(db)
    
    # Get mapping
    conn = db.connect()
    mapping = explorer._get_mapping(conn, env_id)
    
    # Get sample data
    view_name = f"{env_id}_calibration_data"
    
    # Get account_status values
    status_col = mapping.get('accounts', {}).get('account_status', 'account_status')
    
    query = f'SELECT DISTINCT "{status_col}" FROM "{view_name}" LIMIT 10'
    result = conn.execute(query).fetchall()
    
    conn.close()
    
    return jsonify({
        'mapping': mapping,
        'account_status_column': status_col,
        'actual_status_values': [r[0] for r in result],
        'sample_query': query
    })