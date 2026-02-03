"""
AML Data Pipeline - Production V1
Generates realistic synthetic data for threshold calibration system.

Usage:
    from aml_data_pipeline import AMLDataPipeline
    
    pipeline = AMLDataPipeline('backend/data/aml.db')
    pipeline.connect()
    pipeline.init_schema()
    pipeline.run_full_pipeline()
    pipeline.close()
"""

import sqlite3
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AMLDataPipeline:
    """Generates realistic AML data for calibration engine"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = None
        
    def connect(self):
        self.conn = sqlite3.connect(self.db_path)
        
    def close(self):
        if self.conn:
            self.conn.close()
    
    # =========================================================================
    # SCHEMA INITIALIZATION
    # =========================================================================
    
    def init_schema(self):
        """Create tables required for calibration"""
        cursor = self.conn.cursor()
        
        # Transactions
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                txn_id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                customer_id TEXT NOT NULL,
                txn_date TEXT NOT NULL,
                amount REAL NOT NULL,
                channel TEXT,
                merchant_type TEXT,
                counterparty_country TEXT,
                product_segment TEXT,
                geo_segment TEXT
            )
        """)
        
        # Rule Metric Snapshot (CORE)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS rule_metric_snapshot (
                snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                rule_id TEXT NOT NULL,
                metric_date TEXT NOT NULL,
                rule_metric REAL NOT NULL,
                product_segment TEXT,
                geo_segment TEXT,
                risk_tier TEXT,
                txn_count INTEGER,
                UNIQUE(entity_id, rule_id, metric_date)
            )
        """)
        
        # Alerts
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                alert_id TEXT PRIMARY KEY,
                rule_id TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                rule_metric REAL NOT NULL,
                threshold_applied REAL NOT NULL,
                alert_date TEXT NOT NULL,
                severity TEXT,
                product_segment TEXT,
                geo_segment TEXT,
                risk_tier TEXT
            )
        """)
        
        # Cases
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS cases (
                case_id TEXT PRIMARY KEY,
                alert_id TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                rule_id TEXT NOT NULL,
                is_str INTEGER NOT NULL,
                case_date TEXT NOT NULL,
                risk_score REAL,
                status TEXT DEFAULT 'closed',
                product_segment TEXT,
                geo_segment TEXT,
                risk_tier TEXT
            )
        """)
        
        # Customers
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS customers (
                customer_id TEXT PRIMARY KEY,
                risk_tier TEXT NOT NULL,
                product_segment TEXT NOT NULL,
                geo_segment TEXT NOT NULL
            )
        """)
        
        self.conn.commit()
        logger.info("✅ Schema initialized")
    
    # =========================================================================
    # FULL PIPELINE
    # =========================================================================
    
    def run_full_pipeline(
        self,
        num_customers: int = 10000,
        num_transactions: int = 500000,
        date_range_days: int = 365
    ):
        """Execute complete data generation pipeline"""
        
        logger.info("=" * 60)
        logger.info("AML DATA PIPELINE - FULL RUN")
        logger.info("=" * 60)
        
        # Step 1: Transactions
        logger.info("\n[1/5] Generating transactions...")
        self.generate_transactions(num_customers, num_transactions, date_range_days)
        
        # Step 2: Rule Metrics
        logger.info("\n[2/5] Building rule metric snapshot...")
        self.build_rule_metric_snapshot()
        
        # Step 3: Alerts
        logger.info("\n[3/5] Generating alerts...")
        self.generate_alerts()
        
        # Step 4: Cases/STRs
        logger.info("\n[4/5] Generating cases...")
        self.generate_cases()
        
        # Step 5: Baseline
        logger.info("\n[5/5] Freezing baseline...")
        baseline_info = self.freeze_baseline()
        
        logger.info("\n" + "=" * 60)
        logger.info("✅ PIPELINE COMPLETE")
        logger.info("=" * 60)
        
        self._print_summary()
        
        return baseline_info
    
    # =========================================================================
    # STEP 1: TRANSACTIONS
    # =========================================================================
    
    def generate_transactions(self, num_customers, num_transactions, date_range_days):
        """Generate realistic transaction data"""
        
        # Clear existing
        self.conn.execute("DELETE FROM transactions")
        self.conn.execute("DELETE FROM customers")
        
        # Generate customers
        customers = self._generate_customers(num_customers)
        
        # Generate transactions
        end_date = datetime.now()
        start_date = end_date - timedelta(days=date_range_days)
        
        # Power law distribution for activity
        activity_weights = np.random.power(0.5, num_customers)
        activity_weights = activity_weights / activity_weights.sum()
        customer_txn_counts = np.random.multinomial(num_transactions, activity_weights)
        
        transactions = []
        
        for idx, txn_count in enumerate(customer_txn_counts):
            if txn_count == 0:
                continue
            
            customer = customers[idx]
            
            # Transaction dates
            txn_dates = sorted([
                start_date + timedelta(seconds=np.random.randint(0, int(date_range_days * 86400)))
                for _ in range(txn_count)
            ])
            
            # Amounts (log-normal)
            segment_mult = {'retail': 1.0, 'corporate': 5.0, 'private': 10.0}[customer['product_segment']]
            amounts = np.random.lognormal(7.0, 1.5, txn_count) * segment_mult
            
            channels = np.random.choice(['ATM', 'online', 'branch', 'wire'], txn_count, p=[0.3, 0.4, 0.2, 0.1])
            merchant_types = np.random.choice(['retail', 'restaurant', 'utility', 'casino', 'jewelry', 'other'], txn_count, p=[0.35, 0.25, 0.15, 0.05, 0.05, 0.15])
            
            for i in range(txn_count):
                transactions.append((
                    f"TXN_{customer['customer_id']}_{len(transactions):08d}",
                    f"ACC_{customer['customer_id']}_{i%3:02d}",
                    customer['customer_id'],
                    txn_dates[i].strftime('%Y-%m-%d'),
                    round(float(amounts[i]), 2),
                    channels[i],
                    merchant_types[i],
                    'USA' if np.random.random() < 0.7 else np.random.choice(['China', 'UAE', 'UK']),
                    customer['product_segment'],
                    customer['geo_segment']
                ))
        
        # Insert
        cursor = self.conn.cursor()
        cursor.executemany("""
            INSERT INTO transactions (txn_id, account_id, customer_id, txn_date, amount, channel, merchant_type, counterparty_country, product_segment, geo_segment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, transactions)
        self.conn.commit()
        
        logger.info(f"✅ {len(transactions):,} transactions generated")
    
    def _generate_customers(self, num_customers):
        """Generate customer records"""
        segments = np.random.choice(['retail', 'corporate', 'private'], num_customers, p=[0.80, 0.15, 0.05])
        geos = np.random.choice(['APAC', 'EMEA', 'Americas'], num_customers, p=[0.45, 0.35, 0.20])
        risk_tiers = np.random.choice(['high', 'medium', 'low'], num_customers, p=[0.05, 0.20, 0.75])
        
        customers = []
        cursor = self.conn.cursor()
        
        for i in range(num_customers):
            customer = {
                'customer_id': f"CUST_{i:08d}",
                'product_segment': segments[i],
                'geo_segment': geos[i],
                'risk_tier': risk_tiers[i]
            }
            customers.append(customer)
            cursor.execute("INSERT INTO customers VALUES (?, ?, ?, ?)", (customer['customer_id'], customer['risk_tier'], customer['product_segment'], customer['geo_segment']))
        
        self.conn.commit()
        return customers
    
    # =========================================================================
    # STEP 2: RULE METRICS
    # =========================================================================
    
    def build_rule_metric_snapshot(self):
        """Aggregate transactions into rule metrics"""
        
        self.conn.execute("DELETE FROM rule_metric_snapshot")
        
        df = pd.read_sql_query("SELECT * FROM transactions", self.conn)
        risk_df = pd.read_sql_query("SELECT customer_id, risk_tier FROM customers", self.conn)
        df = df.merge(risk_df, on='customer_id')
        
        rules = [
            {'rule_id': 'SAR_001', 'entity': 'account_id', 'agg': 'sum', 'filter': "channel == 'ATM'"},
            {'rule_id': 'SAR_002', 'entity': 'customer_id', 'agg': 'count', 'filter': None},
            {'rule_id': 'SAR_003', 'entity': 'customer_id', 'agg': 'sum', 'filter': "merchant_type.isin(['casino', 'jewelry'])"}
        ]
        
        all_metrics = []
        
        for rule in rules:
            filtered = df.query(rule['filter']) if rule['filter'] else df
            
            grouped = filtered.groupby([rule['entity'], 'txn_date', 'product_segment', 'geo_segment', 'risk_tier'])
            
            if rule['agg'] == 'sum':
                agg = grouped['amount'].sum().reset_index(name='rule_metric')
                agg['txn_count'] = grouped.size().values
            else:
                agg = grouped.size().reset_index(name='rule_metric')
                agg['txn_count'] = agg['rule_metric']
            
            for _, row in agg.iterrows():
                all_metrics.append((
                    row[rule['entity']], 'account' if rule['entity'] == 'account_id' else 'customer',
                    rule['rule_id'], row['txn_date'], float(row['rule_metric']),
                    row['product_segment'], row['geo_segment'], row['risk_tier'], int(row['txn_count'])
                ))
        
        cursor = self.conn.cursor()
        cursor.executemany("""
            INSERT INTO rule_metric_snapshot (entity_id, entity_type, rule_id, metric_date, rule_metric, product_segment, geo_segment, risk_tier, txn_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, all_metrics)
        self.conn.commit()
        
        logger.info(f"✅ {len(all_metrics):,} metric snapshots generated")
    
    # =========================================================================
    # STEP 3: ALERTS
    # =========================================================================
    
    def generate_alerts(self):
        """Apply thresholds to generate alerts"""
        
        self.conn.execute("DELETE FROM alerts")
        
        metrics_df = pd.read_sql_query("SELECT * FROM rule_metric_snapshot", self.conn)
        
        # P95 thresholds per rule
        thresholds = {
            rule_id: float(metrics_df[metrics_df['rule_id'] == rule_id]['rule_metric'].quantile(0.95))
            for rule_id in metrics_df['rule_id'].unique()
        }
        
        alerts = []
        
        for rule_id, threshold in thresholds.items():
            firing = metrics_df[(metrics_df['rule_id'] == rule_id) & (metrics_df['rule_metric'] >= threshold)]
            
            for _, row in firing.iterrows():
                ratio = row['rule_metric'] / threshold
                severity = 'critical' if ratio >= 3 else 'high' if ratio >= 2 else 'medium' if ratio >= 1.5 else 'low'
                
                alerts.append((
                    f"ALERT_{rule_id}_{row['entity_id']}_{row['metric_date']}",
                    rule_id, row['entity_id'], row['entity_type'], float(row['rule_metric']),
                    float(threshold), row['metric_date'], severity,
                    row['product_segment'], row['geo_segment'], row['risk_tier']
                ))
        
        cursor = self.conn.cursor()
        cursor.executemany("""
            INSERT INTO alerts (alert_id, rule_id, entity_id, entity_type, rule_metric, threshold_applied, alert_date, severity, product_segment, geo_segment, risk_tier)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, alerts)
        self.conn.commit()
        
        logger.info(f"✅ {len(alerts):,} alerts generated")
    
    # =========================================================================
    # STEP 4: CASES / STRs
    # =========================================================================
    
    def generate_cases(self):
        """Generate cases with STR labels from tail"""
        
        self.conn.execute("DELETE FROM cases")
        
        alerts_df = pd.read_sql_query("SELECT * FROM alerts", self.conn)
        
        # P99 = STR threshold
        str_thresholds = {
            rule_id: float(alerts_df[alerts_df['rule_id'] == rule_id]['rule_metric'].quantile(0.99))
            for rule_id in alerts_df['rule_id'].unique()
        }
        
        cases = []
        
        for _, alert in alerts_df.iterrows():
            is_str = 1 if alert['rule_metric'] >= str_thresholds[alert['rule_id']] else 0
            
            max_metric = alerts_df[alerts_df['rule_id'] == alert['rule_id']]['rule_metric'].max()
            risk_score = min(100, (alert['rule_metric'] / max_metric) * 100) if max_metric > 0 else 0
            
            cases.append((
                f"CASE_{alert['alert_id']}", alert['alert_id'], alert['entity_id'],
                alert['rule_id'], is_str, alert['alert_date'], float(risk_score),
                'closed', alert['product_segment'], alert['geo_segment'], alert['risk_tier']
            ))
        
        cursor = self.conn.cursor()
        cursor.executemany("""
            INSERT INTO cases (case_id, alert_id, entity_id, rule_id, is_str, case_date, risk_score, status, product_segment, geo_segment, risk_tier)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, cases)
        self.conn.commit()
        
        num_strs = sum(1 for c in cases if c[4] == 1)
        logger.info(f"✅ {len(cases):,} cases generated ({num_strs:,} STRs = {num_strs/len(cases)*100:.1f}%)")
    
    # =========================================================================
    # STEP 5: FREEZE BASELINE
    # =========================================================================
    
    def freeze_baseline(self):
        """Create baseline for calibration system"""
        
        metrics_df = pd.read_sql_query("SELECT rule_id, rule_metric FROM rule_metric_snapshot", self.conn)
        alerts_df = pd.read_sql_query("SELECT * FROM alerts", self.conn)
        cases_df = pd.read_sql_query("SELECT * FROM cases", self.conn)
        
        # Baseline thresholds
        baseline_thresholds = {}
        for rule_id in metrics_df['rule_id'].unique():
            threshold = float(metrics_df[metrics_df['rule_id'] == rule_id]['rule_metric'].quantile(0.95))
            baseline_thresholds[f"{rule_id}|retail|APAC|all"] = threshold
        
        # Baseline metrics
        num_days = pd.to_datetime(alerts_df['alert_date']).nunique()
        avg_daily_alerts = len(alerts_df) / num_days if num_days > 0 else 0
        
        str_capture_rate = cases_df['is_str'].sum() / len(cases_df) if len(cases_df) > 0 else 0
        false_positive_rate = (len(cases_df) - cases_df['is_str'].sum()) / len(cases_df) if len(cases_df) > 0 else 0
        
        high_risk_customers = pd.read_sql_query("SELECT COUNT(DISTINCT customer_id) FROM customers WHERE risk_tier = 'high'", self.conn).iloc[0, 0]
        high_risk_detected = pd.read_sql_query("SELECT COUNT(DISTINCT entity_id) FROM cases WHERE risk_tier = 'high' AND is_str = 1", self.conn).iloc[0, 0]
        high_risk_coverage = (high_risk_detected / high_risk_customers * 100) if high_risk_customers > 0 else 0
        
        baseline = {
            'environment': 'Default Environment',
            'frozenAt': datetime.now().isoformat(),
            'thresholds': baseline_thresholds,
            'metrics': {
                'avgDailyAlerts': round(avg_daily_alerts, 1),
                'strCaptureRate': round(str_capture_rate, 4),
                'falsePositiveRate': round(false_positive_rate, 4),
                'highRiskCustomerCoverage': round(high_risk_coverage, 1)
            }
        }
        
        logger.info(f"✅ Baseline frozen: {avg_daily_alerts:.1f} alerts/day, {str_capture_rate*100:.1f}% STR capture")
        
        return baseline
    
    # =========================================================================
    # UTILITIES
    # =========================================================================
    
    def _print_summary(self):
        """Print pipeline summary"""
        cursor = self.conn.cursor()
        
        stats = {
            'customers': cursor.execute("SELECT COUNT(*) FROM customers").fetchone()[0],
            'transactions': cursor.execute("SELECT COUNT(*) FROM transactions").fetchone()[0],
            'metrics': cursor.execute("SELECT COUNT(*) FROM rule_metric_snapshot").fetchone()[0],
            'alerts': cursor.execute("SELECT COUNT(*) FROM alerts").fetchone()[0],
            'cases': cursor.execute("SELECT COUNT(*) FROM cases").fetchone()[0],
            'strs': cursor.execute("SELECT COUNT(*) FROM cases WHERE is_str = 1").fetchone()[0]
        }
        
        print("\n📊 PIPELINE SUMMARY")
        print("━" * 40)
        print(f"Customers:    {stats['customers']:>10,}")
        print(f"Transactions: {stats['transactions']:>10,}")
        print(f"Metrics:      {stats['metrics']:>10,}")
        print(f"Alerts:       {stats['alerts']:>10,}")
        print(f"Cases:        {stats['cases']:>10,}")
        print(f"STRs:         {stats['strs']:>10,} ({stats['strs']/stats['cases']*100:.1f}%)")
        print("━" * 40)


# ============================================================================
# INTEGRATION ADAPTER
# ============================================================================

def adapt_for_calibration_engine(db_path: str) -> Dict:
    """
    Adapter function for existing calibration engine.
    
    Maps pipeline data to calibration engine expectations.
    """
    conn = sqlite3.connect(db_path)
    
    # Query data in format calibration engine expects
    alerts_query = """
        SELECT 
            a.alert_id,
            a.rule_id,
            a.entity_id,
            a.rule_metric as score,
            a.alert_date as created_at,
            a.product_segment,
            a.geo_segment,
            c.customer_id,
            cust.risk_tier as customer_risk_tier
        FROM alerts a
        LEFT JOIN transactions t ON a.entity_id = t.account_id
        LEFT JOIN customers cust ON t.customer_id = cust.customer_id
        LEFT JOIN cases c ON a.alert_id = c.alert_id
    """
    
    cases_query = """
        SELECT
            case_id as alert_id,
            entity_id as customer_id,
            is_str,
            risk_tier as customer_risk_tier
        FROM cases
    """
    
    alerts_df = pd.read_sql_query(alerts_query, conn)
    cases_df = pd.read_sql_query(cases_query, conn)
    
    conn.close()
    
    return {
        'alerts': alerts_df,
        'cases': cases_df,
        'format': 'calibration_engine_compatible'
    }


# ============================================================================
# CLI ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    import sys
    
    db_path = sys.argv[1] if len(sys.argv) > 1 else 'backend/data/aml.db'
    
    print(f"\n🚀 AML Data Pipeline")
    print(f"Database: {db_path}\n")
    
    pipeline = AMLDataPipeline(db_path)
    pipeline.connect()
    pipeline.init_schema()
    pipeline.run_full_pipeline(
        num_customers=10000,
        num_transactions=500000,
        date_range_days=365
    )
    pipeline.close()
    
    print("\n✅ Pipeline complete. Data ready for calibration.")