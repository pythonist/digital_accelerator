# backend/api/routes/calibration/merge_routes.py
"""
Dynamic Merge Routes for Calibration Tool
User-controlled visual merge builder (like SmartMerge but for calibration)
"""
from flask import Blueprint, request, jsonify
from api.services import services
import traceback
import pandas as pd

merge_bp = Blueprint('calibration_merge', __name__)

@merge_bp.route('/tables', methods=['GET'])
def get_tables():
    """Get list of uploaded tables for this environment"""
    try:
        env_id = request.args.get('env_id')
        if not env_id:
            return jsonify({'error': 'env_id required'}), 400
        
        db = services.get_calibration_db()
        conn = db.connect()
        cursor = conn.cursor()
        
        # Get all tables for this environment
        cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' 
            AND name LIKE ?
            AND name NOT LIKE 'sqlite_%'
            AND name NOT LIKE '%_golden_%'
        """, (f"{env_id}_%",))
        
        tables = [row[0].replace(f"{env_id}_", '') for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({'success': True, 'tables': tables})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@merge_bp.route('/columns', methods=['GET'])
def get_columns():
    """Get column list for a specific table"""
    try:
        env_id = request.args.get('env_id')
        table = request.args.get('table')
        
        if not env_id or not table:
            return jsonify({'error': 'env_id and table required'}), 400
        
        full_table_name = f"{env_id}_{table}"
        
        db = services.get_calibration_db()
        conn = db.connect()
        cursor = conn.cursor()
        
        cursor.execute(f'PRAGMA table_info("{full_table_name}")')
        columns = [row[1] for row in cursor.fetchall() if row[1] not in ('id', 'loaded_at')]
        conn.close()
        
        return jsonify({'success': True, 'columns': columns})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@merge_bp.route('/preview-merge', methods=['POST'])
def preview_merge():
    """Preview the merge result based on user's chain configuration"""
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        chain = data.get('chain', [])
        
        if not env_id or not chain:
            return jsonify({'error': 'env_id and chain required'}), 400
        
        db = services.get_calibration_db()
        conn = db.connect()
        
        # Build dynamic SQL
        base_step = chain[0]
        base_table = f"{env_id}_{base_step['table']}"
        
        query = f'SELECT t0.* FROM "{base_table}" t0 '
        
        for idx, step in enumerate(chain[1:], start=1):
            table_name = f"{env_id}_{step['table']}"
            join_type = step.get('joinType', 'LEFT JOIN')
            left_key = step.get('leftKey', '')  # format: "table.column"
            right_key = step.get('rightKey', '')
            
            if not left_key or not right_key:
                conn.close()
                return jsonify({
                    'error': f'Missing join keys for {step["table"]}'
                }), 400
            
            # Parse left key: "transactions.account_id" -> table alias + column
            if '.' in left_key:
                left_table, left_col = left_key.split('.', 1)
                # Find which alias this refers to
                left_alias = 't0' if left_table == base_step['table'] else None
                if not left_alias:
                    for i, s in enumerate(chain[1:idx], start=1):
                        if s['table'] == left_table:
                            left_alias = f't{i}'
                            break
                if not left_alias:
                    left_alias = 't0'  # fallback
            else:
                left_alias = 't0'
                left_col = left_key
            
            query += f', t{idx}.* '
            query += f'{join_type} "{table_name}" t{idx} ON {left_alias}."{left_col}" = t{idx}."{right_key}" '
        
        query += ' LIMIT 20'
        
        print(f"[PREVIEW SQL] {query}")
        
        df = pd.read_sql_query(query, conn)
        df = df.fillna('')
        conn.close()
        
        return jsonify({
            'success': True,
            'preview': df.to_dict(orient='records')
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@merge_bp.route('/build-golden', methods=['POST'])
def build_golden_from_chain():
    """Build golden dataset from user's merge chain"""
    try:
        data = request.get_json()
        env_id = data.get('env_id')
        chain = data.get('chain', [])
        
        if not env_id or not chain:
            return jsonify({'error': 'env_id and chain required'}), 400
        
        db = services.get_calibration_db()
        conn = db.connect()
        cursor = conn.cursor()
        
        # Generate golden table name
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        golden_table = f"{env_id}_golden_{timestamp}"
        
        # Build SQL
        base_step = chain[0]
        base_table = f"{env_id}_{base_step['table']}"
        
        select_clause = 't0.*'
        joins = ''
        
        for idx, step in enumerate(chain[1:], start=1):
            table_name = f"{env_id}_{step['table']}"
            join_type = step.get('joinType', 'LEFT JOIN')
            left_key = step.get('leftKey', '')
            right_key = step.get('rightKey', '')
            
            if not left_key or not right_key:
                conn.close()
                return jsonify({
                    'error': f'Missing join keys for {step["table"]}'
                }), 400
            
            # Parse left key
            if '.' in left_key:
                left_table, left_col = left_key.split('.', 1)
                left_alias = 't0' if left_table == base_step['table'] else None
                if not left_alias:
                    for i, s in enumerate(chain[1:idx], start=1):
                        if s['table'] == left_table:
                            left_alias = f't{i}'
                            break
                if not left_alias:
                    left_alias = 't0'
            else:
                left_alias = 't0'
                left_col = left_key
            
            select_clause += f', t{idx}.*'
            joins += f'{join_type} "{table_name}" t{idx} ON {left_alias}."{left_col}" = t{idx}."{right_key}" '
        
        create_sql = f'CREATE TABLE "{golden_table}" AS SELECT {select_clause} FROM "{base_table}" t0 {joins}'
        
        print(f"[BUILD SQL] {create_sql}")
        
        cursor.execute(create_sql)
        
        # Get stats
        cursor.execute(f'SELECT COUNT(*) FROM "{golden_table}"')
        row_count = cursor.fetchone()[0]
        
        # Get join statistics
        join_stats = []
        for idx, step in enumerate(chain[1:], start=1):
            cursor.execute(f'''
                SELECT COUNT(*) as matched 
                FROM "{golden_table}" 
                WHERE t{idx}_id IS NOT NULL OR t{idx}_{step.get("rightKey", "id")} IS NOT NULL
            ''')
            try:
                matched = cursor.fetchone()[0]
            except:
                matched = row_count  # fallback
            
            join_stats.append({
                'step': f'{chain[idx-1]["table"]} → {step["table"]}',
                'matched': matched,
                'unmatched': row_count - matched,
                'match_rate': round((matched / row_count * 100), 2) if row_count > 0 else 0
            })
        
        # Cache metadata
        cursor.execute("""
            INSERT OR REPLACE INTO golden_dataset_cache
            (cache_id, env_id, row_count, status, file_path, metadata)
            VALUES (?, ?, ?, 'ready', ?, ?)
        """, (
            f"{env_id}_{timestamp}",
            env_id,
            row_count,
            golden_table,
            str({'join_stats': join_stats, 'chain': chain})
        ))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'result': {
                'table_name': golden_table,
                'row_count': row_count,
                'join_stats': join_stats
            }
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500