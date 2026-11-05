import duckdb
import json
import os

def check():
    paths = [
        "data/environments/fcc_env/mlops/duckdb/mlops.duckdb",
        "data/environments/fcc_env/mlops/mlops.duckdb",
        "../data/environments/fcc_env/mlops/duckdb/mlops.duckdb",
        "../data/environments/fcc_env/mlops/mlops.duckdb",
    ]
    
    db_path = None
    for p in paths:
        if os.path.exists(p):
            size = os.path.getsize(p)
            print(f"Candidate: {p} (Size: {size} bytes)")
            if size > 15000:
                db_path = p
                break
                
    if not db_path:
        db_path = paths[0]
        
    print(f"Connecting to: {db_path} (Exists: {os.path.exists(db_path)}) in READ-ONLY mode")
    conn = duckdb.connect(db_path, read_only=True)
    print("Tables:", conn.execute("SHOW TABLES").fetchall())
    
    rows = conn.execute("SELECT pipeline_id, name, steps_json, status, active_training_job_id, active_validation_job_id FROM mlops_pipelines ORDER BY pipeline_id DESC LIMIT 3").fetchall()
    print("\nLast 3 Pipelines:")
    for r in rows:
        print(f"\nPipeline ID: {r[0]}, Name: {r[1]}, Status: {r[3]}")
        print("  active_training_job_id:", r[4])
        print("  active_validation_job_id:", r[5])
        steps = json.loads(r[2] or "[]")
        print(f"  Steps Count: {len(steps)}")
        for s in steps:
            print(f"    - Screen: {s.get('screen')}, Type: {s.get('type')}, State keys: {list(s.get('state', {}).keys()) if s.get('state') else 'None'}")
            if s.get('screen') == 'workbench_journey':
                print("      Journey state:", s.get('state'))
            if s.get('screen') == 'data_upload':
                print("      DataUpload state:", s.get('state'))
    conn.close()

if __name__ == '__main__':
    check()
