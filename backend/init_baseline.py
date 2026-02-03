#!/usr/bin/env python3
"""
One-Time Baseline Initialization

Creates baseline threshold set from existing data in aml.db
Run once after data population: python init_baseline.py
"""

import sys
import os
import sqlite3
import json
from datetime import datetime

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import CALIBRATION_DB_PATH

def freeze_baseline():
    """
    Create baseline threshold set from existing data.
    This is what the UI expects to load.
    """
    
    print("\n" + "="*60)
    print("BASELINE INITIALIZATION")
    print("="*60)
    print(f"\nDatabase: {CALIBRATION_DB_PATH}")
    
    if not os.path.exists(CALIBRATION_DB_PATH):
        print("❌ Database not found. Run data pipeline first.")
        return False
    
    conn = sqlite3.connect(CALIBRATION_DB_PATH)
    cursor = conn.cursor()
    
    # Check if data exists
    print("\n📊 Checking data...")
    
    counts = {}
    for table in ['transactions', 'rule_metric_snapshot', 'alerts', 'cases']:
        try:
            count = cursor.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            counts[table] = count
            print(f"   {table:25s} {count:>10,}")
        except sqlite3.OperationalError:
            print(f"   ❌ Table {table} not found")
            return False
    
    if counts.get('alerts', 0) == 0:
        print("\n❌ No alerts found. Run data pipeline first.")
        return False
    
    # Check if baseline already exists
    try:
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='threshold_sets'")
        if not cursor.fetchone():
            print("\n⚠️  Calibration schema tables not found.")
            print("   Creating calibration schema...")
            
            # Create calibration schema tables
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS threshold_sets (
                    id TEXT PRIMARY KEY,
                    environment TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT,
                    thresholds TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    is_baseline INTEGER DEFAULT 0,
                    is_live INTEGER DEFAULT 0,
                    parent_id TEXT
                )
            """)
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS calibration_runs (
                    id TEXT PRIMARY KEY,
                    environment TEXT NOT NULL,
                    name TEXT NOT NULL,
                    baseline_threshold_set_id TEXT NOT NULL,
                    candidate_threshold_set_id TEXT,
                    status TEXT DEFAULT 'draft',
                    created_at TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT,
                    lookback_days INTEGER DEFAULT 180,
                    segmentation TEXT,
                    max_acceptable_loss_percent REAL,
                    min_high_risk_customer_floor REAL,
                    max_investigator_load_increase REAL,
                    result_id TEXT,
                    notes TEXT
                )
            """)
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS calibration_results (
                    id TEXT PRIMARY KEY,
                    run_id TEXT UNIQUE NOT NULL,
                    baseline_daily_alert_count REAL NOT NULL,
                    baseline_str_capture_rate REAL NOT NULL,
                    baseline_false_positive_rate REAL NOT NULL,
                    baseline_high_risk_customer_coverage REAL NOT NULL,
                    candidate_daily_alert_count REAL NOT NULL,
                    candidate_str_capture_rate REAL NOT NULL,
                    candidate_false_positive_rate REAL NOT NULL,
                    candidate_high_risk_customer_coverage REAL NOT NULL,
                    alert_volume_change INTEGER NOT NULL,
                    alert_volume_change_percent REAL NOT NULL,
                    str_capture_change INTEGER NOT NULL,
                    str_loss_percent REAL NOT NULL,
                    high_risk_customer_impact INTEGER NOT NULL,
                    high_risk_customer_floor_met INTEGER NOT NULL,
                    baseline_investigator_hours REAL NOT NULL,
                    candidate_investigator_hours REAL NOT NULL,
                    investigator_capacity_met INTEGER NOT NULL,
                    segment_breakdown TEXT,
                    risk_assessment TEXT NOT NULL,
                    computed_at TEXT NOT NULL
                )
            """)
            
            conn.commit()
            print("   ✅ Schema created")
        
        # Check for existing baseline
        cursor.execute("SELECT COUNT(*) FROM threshold_sets WHERE is_baseline = 1")
        existing_count = cursor.fetchone()[0]
        
        if existing_count > 0:
            print(f"\n⚠️  Baseline already exists ({existing_count} found)")
            response = input("   Recreate baseline? (yes/no): ")
            if response.lower() != 'yes':
                print("   Aborted.")
                return True
            
            # Clear existing baseline
            cursor.execute("DELETE FROM threshold_sets WHERE is_baseline = 1")
            print("   Cleared existing baseline")
    
    except sqlite3.OperationalError as e:
        print(f"\n⚠️  Schema check failed: {e}")
        return False
    
    # Calculate baseline thresholds (P95 per rule)
    print("\n🔧 Calculating baseline thresholds...")
    
    cursor.execute("""
        SELECT rule_id, 
               GROUP_CONCAT(rule_metric) as metrics
        FROM rule_metric_snapshot
        GROUP BY rule_id
    """)
    
    thresholds = {}
    for row in cursor.fetchall():
        rule_id = row[0]
        metrics = [float(x) for x in row[1].split(',')]
        metrics.sort()
        
        # P95 threshold
        p95_idx = int(len(metrics) * 0.95)
        threshold = metrics[p95_idx] if p95_idx < len(metrics) else metrics[-1]
        
        # Store with segmentation key format
        thresholds[f"{rule_id}|retail|APAC|all"] = threshold
        print(f"   {rule_id}: {threshold:,.2f} (P95)")
    
    # Calculate baseline metrics
    print("\n📊 Calculating baseline metrics...")
    
    # Alert volume
    cursor.execute("""
        SELECT 
            COUNT(*) as total_alerts,
            COUNT(DISTINCT alert_date) as days
        FROM alerts
    """)
    alert_row = cursor.fetchone()
    total_alerts = alert_row[0]
    days = alert_row[1] if alert_row[1] > 0 else 1
    avg_daily_alerts = total_alerts / days
    
    # STR capture rate
    cursor.execute("SELECT COUNT(*) FROM cases WHERE is_str = 1")
    str_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM cases")
    total_cases = cursor.fetchone()[0]
    str_capture_rate = str_count / total_cases if total_cases > 0 else 0
    
    # False positive rate
    false_positive_rate = (total_cases - str_count) / total_cases if total_cases > 0 else 0
    
    # High-risk customer coverage
    cursor.execute("SELECT COUNT(DISTINCT customer_id) FROM customers WHERE risk_tier = 'high'")
    total_high_risk = cursor.fetchone()[0]
    cursor.execute("""
        SELECT COUNT(DISTINCT c.entity_id)
        FROM cases c
        WHERE c.risk_tier = 'high' AND c.is_str = 1
    """)
    high_risk_detected = cursor.fetchone()[0]
    high_risk_coverage = (high_risk_detected / total_high_risk * 100) if total_high_risk > 0 else 0
    
    print(f"   Avg Daily Alerts: {avg_daily_alerts:.1f}")
    print(f"   STR Capture Rate: {str_capture_rate*100:.2f}%")
    print(f"   False Positive Rate: {false_positive_rate*100:.2f}%")
    print(f"   High-Risk Coverage: {high_risk_coverage:.1f}%")
    
    # Create baseline threshold set
    print("\n💾 Creating baseline threshold set...")
    
    import uuid
    baseline_id = str(uuid.uuid4())
    
    cursor.execute("""
        INSERT INTO threshold_sets (
            id, environment, name, description, thresholds,
            created_at, created_by, is_baseline, is_live
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
    """, (
        baseline_id,
        'Default Environment',
        'Initial Baseline',
        'Frozen baseline from synthetic data',
        json.dumps(thresholds),
        datetime.now().isoformat(),
        'system'
    ))
    
    conn.commit()
    conn.close()
    
    print("   ✅ Baseline threshold set created")
    print(f"   ID: {baseline_id}")
    
    print("\n" + "="*60)
    print("✅ BASELINE INITIALIZATION COMPLETE")
    print("="*60)
    print("\nNext steps:")
    print("   1. Start backend: python app.py")
    print("   2. Navigate to Calibration Platform")
    print("   3. Baseline should load automatically")
    print()
    
    return True


if __name__ == '__main__':
    success = freeze_baseline()
    sys.exit(0 if success else 1)