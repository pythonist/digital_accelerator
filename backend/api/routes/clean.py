import os
from flask import Blueprint, request, jsonify
from api.utils import handle_errors
from api.services import services
import pandas as pd
from pathlib import Path

clean_bp = Blueprint('clean', __name__)

def update_registry(table_name):
    """Updates the registry with the new table schema."""
    try:
        if not services.investigation_db: return
        conn = services.investigation_db.connect()
        df = pd.read_sql(f"SELECT * FROM {table_name} LIMIT 0", conn)
        columns = list(df.columns)
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) FROM {table_name}")
        count = cur.fetchone()[0]
        services.investigation_db.close_connection(conn)
        
        # Save to metadata
        services.metadata_manager.save_schema(table_name, columns, count)
    except Exception as e:
        print(f"⚠️ Registry update failed for {table_name}: {e}")

@clean_bp.route('/clean/rename-batch', methods=['POST'])
@handle_errors
def rename_batch():
    d = request.json
    table = d.get('table')
    target = d.get('target_table', table)
    
    # 1. Perform DB Operation
    res = services.data_cleaning.batch_rename_columns(table, d.get('renames'), target)
    
    # 2. Update Registry
    if res['success']:
        update_registry(target)
        
    return jsonify(res)

@clean_bp.route('/clean/columns', methods=['POST'])
@handle_errors
def get_cols():
    # Service call handles DB internally, usually fine if service was init with correct DB
    data = services.data_cleaning.get_column_metadata(request.json.get('table'))
    return jsonify(data)

@clean_bp.route('/clean/fill-nulls', methods=['POST'])
@handle_errors
def fill_nulls():
    d = request.json
    res = services.data_cleaning.fill_missing(d.get('table'), d.get('column'), d.get('strategy'), d.get('value'))
    if res['success']: update_registry(d.get('table'))
    return jsonify(res)

@clean_bp.route('/clean/to-upper', methods=['POST'])
@handle_errors
def to_upper():
    table = request.json['table']
    res = services.data_cleaning.convert_text_to_uppercase(table)
    if res['success']: update_registry(table)
    return jsonify(res)

@clean_bp.route('/clean/drop-column', methods=['POST'])
@handle_errors
def drop_column():
    d = request.json
    res = services.data_cleaning.drop_column(d.get('table'), d.get('column'))
    if res['success']: update_registry(d.get('table'))
    return jsonify(res)

@clean_bp.route('/clean/auto-type', methods=['POST'])
@handle_errors
def auto_type():
    """Attempts to convert Object columns to Numeric/Datetime."""
    table = request.json.get('table')
    res = services.data_cleaning.auto_convert_types(table)
    if res['success']: update_registry(table)
    return jsonify(res)


@clean_bp.route('/clean/add-feature', methods=['POST'])
@handle_errors
def add_feature():
    """Creates a new column based on a formula."""
    d = request.json
    res = services.data_cleaning.add_formula_column(d.get('table'), d.get('name'), d.get('expression'))
    if res['success']: update_registry(d.get('table'))
    return jsonify(res)

@clean_bp.route('/clean/commit-master', methods=['POST'])
@handle_errors
def commit_master():
    """
    Finalizes 'master_cleaned_data' and saves CSV to 'investigation/master_data/' folder.
    """
    source = request.json.get('source_table')
    target = 'master_cleaned_data'
    
    if not services.investigation_db:
         return jsonify({"error": "Database not connected"}), 500

    conn = services.investigation_db.connect()
    try:
        # 1. Create Table in DB
        conn.execute(f"DROP TABLE IF EXISTS {target}")
        conn.execute(f"CREATE TABLE {target} AS SELECT * FROM {source}")
        
        # 2. Export to CSV in CORRECT FOLDER
        df = pd.read_sql(f"SELECT * FROM {target}", conn)
        
        # Get path to investigation DB
        db_path = Path(services.investigation_db.db_path) 
        # Structure is: .../env_name/investigation/investigation.db
        
        # We want: .../env_name/investigation/master_data/master_cleaned_data.csv
        master_dir = db_path.parent / "master_data"
        os.makedirs(master_dir, exist_ok=True)
        
        csv_path = master_dir / "master_cleaned_data.csv"
        df.to_csv(csv_path, index=False)
        
        conn.commit()
    finally:
        services.investigation_db.close_connection(conn)
        
    # 3. Update Registry
    update_registry(target)
    
    return jsonify({"success": True, "table": target, "csv_path": str(csv_path)})