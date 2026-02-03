# backend/api/tools/btsy/transaction_universe/transaction_universe_routes.py
"""
Transaction Universe API Routes (Enhanced with Data Statistics)
"""
from flask import Blueprint, request, jsonify
from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.transaction_universe.transaction_universe_service import TransactionUniverseService
from api.tools.btsy.transaction_universe.data_statistics_service import DataStatisticsService
from api.tools.btsy.transaction_universe.audit_service import AuditTrailService
from pathlib import Path
import logging
import threading

logger = logging.getLogger(__name__)

universe_bp = Blueprint('universe', __name__)

_svc_lock = threading.Lock()
_svc_cache = {}


def _get_services(env_id: str, tenant_id: str = 'default'):
    """Get all required service instances"""
    key = (tenant_id, env_id)
    with _svc_lock:
        cached = _svc_cache.get(key)
        if cached:
            return cached

        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)

        db_path = folders['duckdb'] / 'universes.duckdb'
        snapshot_storage = folders['snapshots']
        audit_db_path = folders['duckdb'] / 'audit.duckdb'
        snapshots_db = folders['duckdb'] / 'snapshots.duckdb'

        audit_service = AuditTrailService(audit_db_path)
        universe_service = TransactionUniverseService(db_path, snapshot_storage, audit_service)
        stats_service = DataStatisticsService(snapshot_storage, snapshots_db)

        logger.info(f"[UNIVERSE] Using DB: {db_path}, Audit DB: {audit_db_path}")

        _svc_cache[key] = (universe_service, audit_service, stats_service)
        return _svc_cache[key]


@universe_bp.route('/universe/data-statistics/<snapshot_id>', methods=['GET'])
def get_data_statistics(snapshot_id):
    """Get comprehensive data statistics for a snapshot"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        _, _, stats_service = _get_services(env_id)
        
        stats = stats_service.get_transaction_statistics(snapshot_id)
        
        return jsonify({
            'success': True,
            'data': stats
        }), 200
        
    except FileNotFoundError as e:
        logger.error(f"[STATS] File not found: {str(e)}")
        return jsonify({'error': f'Data not found: {str(e)}'}), 404
    except Exception as e:
        logger.error(f"[STATS] Failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@universe_bp.route('/universe/filtered-statistics/<snapshot_id>', methods=['POST'])
def get_filtered_statistics(snapshot_id):
    """Get statistics for filtered data subset"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        data = request.get_json()
        
        _, _, stats_service = _get_services(env_id)
        
        stats = stats_service.get_filtered_statistics(
            snapshot_id=snapshot_id,
            categories=data.get('categories'),
            date_start=data.get('date_start'),
            date_end=data.get('date_end'),
            amount_min=data.get('amount_min'),
            amount_max=data.get('amount_max')
        )
        
        return jsonify({
            'success': True,
            'data': stats
        }), 200
        
    except Exception as e:
        logger.error(f"[STATS] Filtered stats failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@universe_bp.route('/universe/create', methods=['POST'])
def create_universe():
    """Create new transaction universe (draft)"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        data = request.get_json()
        
        required = ['snapshot_id', 'universe_name', 'filter_spec']
        missing = [f for f in required if f not in data]
        if missing:
            return jsonify({'error': f'Missing fields: {missing}'}), 400
        
        universe_service, _, _ = _get_services(env_id)
        
        result = universe_service.create_universe(
            calibration_run_id=data.get('calibration_run_id'),
            scenario_id=data.get('scenario_id'),
            snapshot_id=data['snapshot_id'],
            universe_name=data['universe_name'],
            filter_spec=data['filter_spec'],
            created_by=data.get('created_by', 'system'),
            description=data.get('description')
        )
        
        if result.get('error'):
            return jsonify(result), 400
        
        return jsonify({
            'success': True,
            'message': 'Universe created',
            'data': result
        }), 200
        
    except Exception as e:
        logger.error(f"[UNIVERSE] Create failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@universe_bp.route('/universe/<int:universe_id>/freeze', methods=['POST'])
def freeze_universe(universe_id):
    """Freeze universe (make immutable)"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        data = request.get_json() or {}
        frozen_by = data.get('frozen_by', 'system')
        
        universe_service, _, _ = _get_services(env_id)
        result = universe_service.freeze_universe(universe_id, frozen_by)
        
        if result.get('error'):
            return jsonify(result), 400
        
        return jsonify({
            'success': True,
            'message': 'Universe frozen',
            'data': result
        }), 200
        
    except Exception as e:
        logger.error(f"[UNIVERSE] Freeze failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@universe_bp.route('/universe/<int:universe_id>', methods=['GET'])
def get_universe(universe_id):
    """Get universe details"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        universe_service, _, _ = _get_services(env_id)
        universe = universe_service.get_universe(universe_id)
        
        if not universe:
            return jsonify({'error': 'Universe not found'}), 404
        
        return jsonify({
            'success': True,
            'data': universe
        }), 200
        
    except Exception as e:
        logger.error(f"[UNIVERSE] Get failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@universe_bp.route('/universe/list', methods=['GET'])
def list_universes():
    """List universes with optional filters"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        calibration_run_id = request.args.get('calibration_run_id', type=int)
        snapshot_id = request.args.get('snapshot_id')
        status = request.args.get('status')
        
        logger.info(
            f"[UNIVERSE] List request: env_id={env_id}, "
            f"calibration_run_id={calibration_run_id}, "
            f"snapshot_id={snapshot_id}, status={status}"
        )
        
        universe_service, _, _ = _get_services(env_id)
        universes = universe_service.list_universes(
            calibration_run_id=calibration_run_id,
            snapshot_id=snapshot_id,
            status=status
        )
        
        logger.info(f"[UNIVERSE] Returning {len(universes)} universes")
        
        return jsonify({
            'success': True,
            'data': universes
        }), 200
        
    except Exception as e:
        logger.error(f"[UNIVERSE] List failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@universe_bp.route('/universe/<int:universe_id>', methods=['DELETE'])
def delete_universe(universe_id):
    """Delete universe (only if draft)"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        universe_service, _, _ = _get_services(env_id)
        success = universe_service.delete_universe(universe_id)
        
        if not success:
            return jsonify({'error': 'Universe not found or cannot be deleted'}), 400
        
        return jsonify({
            'success': True,
            'message': 'Universe deleted'
        }), 200
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        logger.error(f"[UNIVERSE] Delete failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@universe_bp.route('/universe/<int:universe_id>/preview', methods=['GET'])
def preview_universe_data(universe_id):
    """Preview universe transaction sample"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        limit = request.args.get('limit', default=100, type=int)
        
        universe_service, _, _ = _get_services(env_id)
        universe = universe_service.get_universe(universe_id)
        
        if not universe:
            return jsonify({'error': 'Universe not found'}), 404
        
        parquet_path = universe.get('parquet_path')
        if not parquet_path or not Path(parquet_path).exists():
            return jsonify({'error': 'Universe data not found'}), 404
        
        import duckdb
        conn = duckdb.connect()
        sample_df = conn.execute(f"""
            SELECT * FROM read_parquet('{parquet_path}') 
            LIMIT {limit}
        """).df()
        conn.close()
        
        return jsonify({
            'success': True,
            'data': {
                'sample': sample_df.to_dict(orient='records'),
                'total_count': universe['transaction_count']
            }
        }), 200
        
    except Exception as e:
        logger.error(f"[UNIVERSE] Preview failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@universe_bp.route('/universe/<int:universe_id>/stats', methods=['GET'])
def universe_statistics(universe_id):
    """Return distribution statistics for a specific universe parquet"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        universe_service, _, _ = _get_services(env_id)
        universe = universe_service.get_universe(universe_id)
        if not universe:
            return jsonify({'error': 'Universe not found'}), 404
        
        parquet_path = universe.get('parquet_path')
        if not parquet_path or not Path(parquet_path).exists():
            return jsonify({'error': 'Universe data not found'}), 404
        
        import duckdb
        conn = duckdb.connect()
        
        # Basic counts
        total_count = conn.execute(f"SELECT COUNT(*) FROM read_parquet('{parquet_path}')").fetchone()[0]
        
        # Coverage vs base snapshot
        # Read normalized base to compute base total for coverage percentage
        base_total = None
        try:
            # universe dict contains snapshot_id
            snapshot_id = universe.get('snapshot_id')
            normalized_base = universe_service.snapshot_storage_path.parent / 'normalized'
            tx_file = normalized_base / 'transactions.parquet'
            if tx_file.exists():
                base_total = conn.execute(f"SELECT COUNT(*) FROM read_parquet('{tx_file}')").fetchone()[0]
        except Exception:
            base_total = None
        
        # Date range
        min_max = conn.execute(f"""
            SELECT MIN(transaction_datetime) AS min_date,
                   MAX(transaction_datetime) AS max_date
            FROM read_parquet('{parquet_path}')
        """).fetchone()
        
        # Amount stats
        amt = conn.execute(f"""
            SELECT MIN(CAST(transaction_amount AS DOUBLE)) AS min_amount,
                   MAX(CAST(transaction_amount AS DOUBLE)) AS max_amount,
                   AVG(CAST(transaction_amount AS DOUBLE)) AS avg_amount,
                   MEDIAN(CAST(transaction_amount AS DOUBLE)) AS median_amount
            FROM read_parquet('{parquet_path}')
        """).fetchone()
        
        # Type distribution
        type_dist = []
        try:
            type_dist = conn.execute(f"""
                SELECT transaction_type, COUNT(*) AS count
                FROM read_parquet('{parquet_path}')
                WHERE transaction_type IS NOT NULL
                GROUP BY transaction_type
                ORDER BY count DESC
            """).fetchall()
        except Exception:
            pass
        
        # Category distribution
        category_dist = []
        try:
            category_dist = conn.execute(f"""
                SELECT transaction_category, COUNT(*) AS count
                FROM read_parquet('{parquet_path}')
                WHERE transaction_category IS NOT NULL
                GROUP BY transaction_category
                ORDER BY count DESC
            """).fetchall()
        except Exception:
            pass
        
        # Monthly distribution
        monthly_dist = conn.execute(f"""
            SELECT strftime(transaction_datetime, '%Y-%m') AS month, COUNT(*) AS count
            FROM read_parquet('{parquet_path}')
            GROUP BY month
            ORDER BY month
        """).fetchall()
        
        # Day of week
        dow = conn.execute(f"""
            SELECT strftime(transaction_datetime, '%A') AS day, COUNT(*) AS count
            FROM read_parquet('{parquet_path}')
            GROUP BY day
            ORDER BY day
        """).fetchall()
        
        # Hour of day
        hod = conn.execute(f"""
            SELECT strftime(transaction_datetime, '%H') AS hour, COUNT(*) AS count
            FROM read_parquet('{parquet_path}')
            GROUP BY hour
            ORDER BY hour
        """).fetchall()
        
        # Top transactions (by amount)
        top_tx = conn.execute(f"""
            SELECT 
                account_id, 
                CAST(transaction_amount AS DOUBLE) AS amount, 
                transaction_datetime, 
                transaction_category, 
                transaction_type
            FROM read_parquet('{parquet_path}')
            WHERE transaction_amount IS NOT NULL
            ORDER BY amount DESC
            LIMIT 10
        """).fetchall()
        
        # Top accounts by volume and by amount
        top_accounts_volume = conn.execute(f"""
            SELECT 
                account_id, 
                COUNT(*) AS txn_count, 
                SUM(CAST(transaction_amount AS DOUBLE)) AS total_amount
            FROM read_parquet('{parquet_path}')
            GROUP BY account_id
            ORDER BY txn_count DESC
            LIMIT 10
        """).fetchall()
        
        top_accounts_amount = conn.execute(f"""
            SELECT 
                account_id, 
                COUNT(*) AS txn_count, 
                SUM(CAST(transaction_amount AS DOUBLE)) AS total_amount
            FROM read_parquet('{parquet_path}')
            GROUP BY account_id
            ORDER BY total_amount DESC
            LIMIT 10
        """).fetchall()
        
        # Percentiles for amount
        percentiles = conn.execute(f"""
            SELECT 
                quantile(CAST(transaction_amount AS DOUBLE), 0.5) AS p50,
                quantile(CAST(transaction_amount AS DOUBLE), 0.9) AS p90,
                quantile(CAST(transaction_amount AS DOUBLE), 0.95) AS p95,
                quantile(CAST(transaction_amount AS DOUBLE), 0.97) AS p97,
                quantile(CAST(transaction_amount AS DOUBLE), 0.99) AS p99
            FROM read_parquet('{parquet_path}')
            WHERE transaction_amount IS NOT NULL
        """).fetchone()
        
        conn.close()
        
        stats = {
            'total_transactions': int(total_count),
            'base_total_transactions': int(base_total) if base_total is not None else None,
            'coverage_percentage': round((total_count / base_total) * 100, 2) if base_total else None,
            'date_range': {
                'min_date': str(min_max[0])[:10] if min_max and min_max[0] else None,
                'max_date': str(min_max[1])[:10] if min_max and min_max[1] else None
            },
            'amount_range': {
                'min': float(amt[0]) if amt and amt[0] is not None else None,
                'max': float(amt[1]) if amt and amt[1] is not None else None,
                'avg': float(amt[2]) if amt and amt[2] is not None else None,
                'median': float(amt[3]) if amt and amt[3] is not None else None
            },
            'type_distribution': {str(t): int(c) for t, c in type_dist},
            'category_distribution': {str(cat): int(c) for cat, c in category_dist},
            'monthly_distribution': [{'month': m, 'count': int(c)} for m, c in monthly_dist],
            'day_of_week': [{'day': d, 'count': int(c)} for d, c in dow],
            'hour_of_day': [{'hour': h, 'count': int(c)} for h, c in hod],
            'top_transactions': [
                {
                    'account_id': a, 
                    'amount': float(x), 
                    'transaction_datetime': str(ts), 
                    'transaction_category': cat, 
                    'transaction_type': typ
                } for a, x, ts, cat, typ in top_tx
            ],
            'top_accounts': {
                'by_volume': [
                    {
                        'account_id': a, 
                        'txn_count': int(n), 
                        'total_amount': float(t) if t is not None else 0.0
                    } for a, n, t in top_accounts_volume
                ],
                'by_amount': [
                    {
                        'account_id': a, 
                        'txn_count': int(n), 
                        'total_amount': float(t) if t is not None else 0.0
                    } for a, n, t in top_accounts_amount
                ],
            },
            'amount_percentiles': {
                'p50': float(percentiles[0]) if percentiles and percentiles[0] is not None else None,
                'p90': float(percentiles[1]) if percentiles and percentiles[1] is not None else None,
                'p95': float(percentiles[2]) if percentiles and percentiles[2] is not None else None,
                'p97': float(percentiles[3]) if percentiles and percentiles[3] is not None else None,
                'p99': float(percentiles[4]) if percentiles and percentiles[4] is not None else None
            }
        }
        
        return jsonify({'success': True, 'data': stats}), 200
    except Exception as e:
        logger.error(f"[UNIVERSE] Stats failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@universe_bp.route('/universe/history', methods=['GET'])
def universe_history():
    """List past universes with meta for quick reuse"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        limit = request.args.get('limit', default=50, type=int)
        snapshot_id = request.args.get('snapshot_id')
        status = request.args.get('status')
        calibration_run_id = request.args.get('calibration_run_id', type=int)
        
        universe_service, _, _ = _get_services(env_id)
        universes = universe_service.list_universes(
            calibration_run_id=calibration_run_id,
            snapshot_id=snapshot_id,
            status=status
        )
        
        universes = universes[:limit] if limit else universes
        
        return jsonify({'success': True, 'data': universes}), 200
    except Exception as e:
        logger.error(f"[UNIVERSE] History failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@universe_bp.route('/universe/<int:universe_id>/select', methods=['POST'])
def select_universe(universe_id):
    """Mark a universe as selected for its calibration run, unselect others"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        reason = (request.get_json() or {}).get('reason')
        
        universe_service, _, _ = _get_services(env_id)
        universe = universe_service.get_universe(universe_id)
        if not universe:
            return jsonify({'error': 'Universe not found'}), 404
        
        calibration_run_id = universe.get('calibration_run_id')
        
        import duckdb
        conn = duckdb.connect(str(universe_service.db_path))
        try:
            # Unselect others in same run
            conn.execute("""
                UPDATE transaction_universe_runs
                SET selected = FALSE, selected_at = NULL, selection_reason = NULL
                WHERE calibration_run_id = ? AND id <> ?
            """, [calibration_run_id, universe_id])
            
            # Select this one
            conn.execute("""
                UPDATE transaction_universe_runs
                SET selected = TRUE, selected_at = CURRENT_TIMESTAMP, selection_reason = ?
                WHERE id = ?
            """, [reason, universe_id])
        finally:
            conn.close()
        
        return jsonify({'success': True, 'data': {'universe_id': universe_id, 'selected': True}}), 200
    except Exception as e:
        logger.error(f"[UNIVERSE] Select failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@universe_bp.route('/universe/selected', methods=['GET'])
def get_selected_universe():
    """Get currently selected universe for a calibration run"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        run_id = request.args.get('calibration_run_id', type=int)
        if not run_id:
            return jsonify({'error': 'calibration_run_id required'}), 400
        
        universe_service, _, _ = _get_services(env_id)
        
        import duckdb
        conn = duckdb.connect(str(universe_service.db_path))
        try:
            row = conn.execute("""
                SELECT 
                    id, universe_name, status, transaction_count, date_range_start, date_range_end,
                    selected_at, selection_reason, parquet_path, filter_spec
                FROM transaction_universe_runs
                WHERE calibration_run_id = ? AND selected = TRUE
                ORDER BY selected_at DESC
                LIMIT 1
            """, [run_id]).fetchone()
        finally:
            conn.close()
        
        if not row:
            return jsonify({'success': True, 'data': None}), 200
        
        data = {
            'id': row[0],
            'universe_name': row[1],
            'status': row[2],
            'transaction_count': row[3],
            'date_range_start': row[4],
            'date_range_end': row[5],
            'selected_at': row[6],
            'selection_reason': row[7],
            'parquet_path': row[8],
            'filter_spec': row[9]
        }
        return jsonify({'success': True, 'data': data}), 200
    except Exception as e:
        logger.error(f"[UNIVERSE] Get selected failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# Audit-specific endpoints
@universe_bp.route('/audit/calibration/<int:calibration_run_id>/step/<step_name>', methods=['GET'])
def get_step_audit(calibration_run_id, step_name):
    """Get audit trail for specific step"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        _, audit_service, _ = _get_services(env_id)
        audit_data = audit_service.get_step_audit(calibration_run_id, step_name)
        
        return jsonify({
            'success': True,
            'data': audit_data
        }), 200
        
    except Exception as e:
        logger.error(f"[AUDIT] Get step audit failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@universe_bp.route('/audit/calibration/<int:calibration_run_id>', methods=['GET'])
def get_full_audit(calibration_run_id):
    """Get complete audit trail for calibration run"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        _, audit_service, _ = _get_services(env_id)
        audit_data = audit_service.get_full_audit(calibration_run_id)
        
        return jsonify({
            'success': True,
            'data': audit_data
        }), 200
        
    except Exception as e:
        logger.error(f"[AUDIT] Get full audit failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@universe_bp.route('/audit/calibration/<int:calibration_run_id>/export', methods=['GET'])
def export_audit_report(calibration_run_id):
    """Export comprehensive audit report"""
    try:
        env_id = request.headers.get('X-Environment-ID')
        if not env_id:
            return jsonify({'error': 'X-Environment-ID header required'}), 400
        
        _, audit_service, _ = _get_services(env_id)
        report = audit_service.generate_report(calibration_run_id)
        
        return jsonify({
            'success': True,
            'data': report
        }), 200
        
    except Exception as e:
        logger.error(f"[AUDIT] Export report failed: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500
