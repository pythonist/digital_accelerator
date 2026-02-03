#!/usr/bin/env python3
"""
Quick script to check and fix calibration database schema
Run this to diagnose the schema issue
"""
import sqlite3
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from config import CALIBRATION_DB_PATH

def check_schema():
    """Check current schema and identify missing columns"""
    print(f"📂 Checking database: {CALIBRATION_DB_PATH}")
    
    if not os.path.exists(CALIBRATION_DB_PATH):
        print(f"❌ Database not found at: {CALIBRATION_DB_PATH}")
        return
    
    conn = sqlite3.connect(CALIBRATION_DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Check calibration_runs table
    print("\n📊 calibration_runs table schema:")
    cursor.execute("PRAGMA table_info(calibration_runs)")
    cols = cursor.fetchall()
    
    existing_cols = set()
    for col in cols:
        print(f"  ✓ {col[1]} ({col[2]})")
        existing_cols.add(col[1])
    
    # Check for missing columns
    required_cols = {
        'aggregation_level': 'TEXT',
        'frequency': 'TEXT', 
        'lookback_days': 'INTEGER',
        'selected_metrics': 'TEXT'
    }
    
    missing = []
    for col_name, col_type in required_cols.items():
        if col_name not in existing_cols:
            missing.append((col_name, col_type))
    
    if missing:
        print(f"\n⚠️ Missing columns: {[c[0] for c in missing]}")
        print("\n🔧 Attempting to add missing columns...")
        
        for col_name, col_type in missing:
            try:
                default_val = "'ACCOUNT_DATE'" if col_name == 'aggregation_level' else \
                             "'7_day'" if col_name == 'frequency' else \
                             "'amount,count'" if col_name == 'selected_metrics' else \
                             "90"
                
                cursor.execute(f"""
                    ALTER TABLE calibration_runs 
                    ADD COLUMN {col_name} {col_type} DEFAULT {default_val}
                """)
                print(f"  ✅ Added {col_name}")
            except Exception as e:
                print(f"  ❌ Failed to add {col_name}: {e}")
        
        conn.commit()
        print("\n✅ Schema updated!")
    else:
        print("\n✅ All required columns present")
    
    # Check sample data
    print("\n📋 Sample run data:")
    cursor.execute("SELECT run_id, aggregation_level, frequency, lookback_days FROM calibration_runs LIMIT 3")
    rows = cursor.fetchall()
    
    if rows:
        for row in rows:
            print(f"  Run: {row['run_id']}")
            print(f"    Level: {row['aggregation_level']}")
            print(f"    Frequency: {row['frequency']}")
            print(f"    Lookback: {row['lookback_days']}")
    else:
        print("  No runs found")
    
    conn.close()
    print("\n✅ Schema check complete!")

if __name__ == '__main__':
    check_schema()