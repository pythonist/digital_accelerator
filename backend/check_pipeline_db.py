import sqlite3
import json

def check_pipelines():
    db_path = "env/fccanalytics/fcc_env/investigation/investigation.db"
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # List all tables to make sure
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cursor.fetchall()]
    print("Tables:", tables)
    
    if 'mlops_pipelines' in tables:
        cursor.execute("SELECT pipeline_id, name, steps_json, status, active_training_job_id, active_validation_job_id FROM mlops_pipelines ORDER BY pipeline_id DESC LIMIT 3")
        rows = cursor.fetchall()
        print("\nLast 3 Pipelines:")
        for r in rows:
            print(f"\nPipeline ID: {r[0]}, Name: {r[1]}, Status: {r[3]}")
            print("  active_training_job_id:", r[4])
            print("  active_validation_job_id:", r[5])
            steps = json.loads(r[2] or "[]")
            print(f"  Steps Count: {len(steps)}")
            for s in steps:
                print(f"    - Screen: {s.get('screen')}, Type: {s.get('type')}")
    else:
        print("mlops_pipelines table not found!")
    conn.close()

if __name__ == '__main__':
    check_pipelines()
