import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import sqlite3
import json
from dataclasses import dataclass, asdict
import hashlib

@dataclass
class FeatureSet:
    """Feature set definition"""
    feature_name: str
    feature_category: str
    feature_type: str  # numeric, categorical, binary
    data_type: str  # float, int, str, bool
    description: str
    sql_query: Optional[str] = None
    python_function: Optional[str] = None
    basel_typology: Optional[str] = None
    risk_weight: float = 1.0
    is_mvp: bool = False

class FeatureStore:
    def __init__(self, db_path='feature_store.db'):
        self.db_path = db_path
        self.feature_definitions = self._load_feature_definitions()
        self._init_database()
    
    def _load_feature_definitions(self):
        """Load feature definitions from configuration"""
        
        features = [
            # 1. CUSTOMER / KYC FEATURES
            FeatureSet(
                feature_name='customer_age',
                feature_category='kyc',
                feature_type='numeric',
                data_type='int',
                description='Age of customer',
                sql_query='SELECT customer_age FROM customers WHERE account_id = ?',
                basel_typology='CDD-1',
                is_mvp=False
            ),
            
            FeatureSet(
                feature_name='days_since_account_open',
                feature_category='kyc',
                feature_type='numeric',
                data_type='int',
                description='Days since account was opened',
                sql_query='SELECT JULIANDAY(CURRENT_DATE) - JULIANDAY(account_open_date) FROM accounts WHERE account_id = ?',
                basel_typology='TF-2',
                risk_weight=1.5,
                is_mvp=True
            ),
            
            # 2. ACCOUNT BEHAVIOR FEATURES
            FeatureSet(
                feature_name='tx_count_24h',
                feature_category='behavior',
                feature_type='numeric',
                data_type='int',
                description='Transaction count in last 24 hours',
                sql_query='SELECT COUNT(*) FROM transactions WHERE account_id = ? AND timestamp >= datetime("now", "-24 hours")',
                basel_typology='TF-1',
                risk_weight=2.0,
                is_mvp=True
            ),
            
            FeatureSet(
                feature_name='in_out_ratio',
                feature_category='behavior',
                feature_type='numeric',
                data_type='float',
                description='Ratio of inbound to outbound transactions',
                python_function='calculate_in_out_ratio',
                basel_typology='TF-1',
                risk_weight=1.8,
                is_mvp=True
            ),
            
            # 3. NETWORK FEATURES
            FeatureSet(
                feature_name='degree_centrality',
                feature_category='network',
                feature_type='numeric',
                data_type='float',
                description='Number of unique counterparties',
                python_function='calculate_degree_centrality',
                basel_typology='TF-4',
                risk_weight=2.5,
                is_mvp=True
            ),
            
            FeatureSet(
                feature_name='simple_cycle_flag',
                feature_category='network',
                feature_type='binary',
                data_type='bool',
                description='Flag for circular transactions (A?B?A)',
                python_function='detect_simple_cycles',
                basel_typology='TF-3',
                risk_weight=3.0,
                is_mvp=True
            ),
            
            # 4. DEVICE FEATURES
            FeatureSet(
                feature_name='accounts_per_device',
                feature_category='device',
                feature_type='numeric',
                data_type='int',
                description='Number of accounts using same device',
                sql_query='SELECT COUNT(DISTINCT account_id) FROM transactions WHERE device_id = (SELECT device_id FROM transactions WHERE account_id = ? LIMIT 1)',
                basel_typology='TF-5',
                risk_weight=2.0,
                is_mvp=True
            ),
            
            # Add all 100+ features as per requirements...
        ]
        
        return {f.feature_name: f for f in features}
    
    def _init_database(self):
        """Initialize feature store database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Create feature definitions table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS feature_definitions (
                feature_name TEXT PRIMARY KEY,
                feature_category TEXT,
                feature_type TEXT,
                data_type TEXT,
                description TEXT,
                sql_query TEXT,
                python_function TEXT,
                basel_typology TEXT,
                risk_weight REAL,
                is_mvp BOOLEAN,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create feature values table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS feature_values (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT,
                feature_name TEXT,
                feature_value TEXT,
                calculation_date DATE,
                valid_from TIMESTAMP,
                valid_to TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (feature_name) REFERENCES feature_definitions(feature_name)
            )
        ''')
        
        # Create feature sets table (pre-calculated feature sets)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS feature_sets (
                set_id TEXT PRIMARY KEY,
                set_name TEXT,
                feature_list TEXT,  -- JSON array of feature names
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Insert feature definitions if empty
        cursor.execute('SELECT COUNT(*) FROM feature_definitions')
        if cursor.fetchone()[0] == 0:
            for feature in self.feature_definitions.values():
                cursor.execute('''
                    INSERT INTO feature_definitions 
                    (feature_name, feature_category, feature_type, data_type, description, 
                     sql_query, python_function, basel_typology, risk_weight, is_mvp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    feature.feature_name, feature.feature_category, feature.feature_type,
                    feature.data_type, feature.description, feature.sql_query,
                    feature.python_function, feature.basel_typology, feature.risk_weight,
                    feature.is_mvp
                ))
        
        conn.commit()
        conn.close()
    
    def get_mvp_features(self):
        """Get Minimum Viable Product feature set"""
        return [f for f in self.feature_definitions.values() if f.is_mvp]
    
    def get_features_by_category(self, category: str):
        """Get features by category"""
        return [f for f in self.feature_definitions.values() if f.feature_category == category]
    
    def calculate_feature(self, account_id: str, feature_name: str, 
                         transactions_df: pd.DataFrame = None) -> Any:
        """Calculate feature value for an account"""
        
        feature_def = self.feature_definitions.get(feature_name)
        if not feature_def:
            raise ValueError(f"Feature {feature_name} not found in definitions")
        
        # If SQL query provided, execute it
        if feature_def.sql_query:
            return self._execute_sql_feature(account_id, feature_def)
        
        # If Python function provided, call it
        elif feature_def.python_function and transactions_df is not None:
            return getattr(self, feature_def.python_function)(account_id, transactions_df)
        
        else:
            raise ValueError(f"No calculation method defined for {feature_name}")
    
    def _execute_sql_feature(self, account_id: str, feature_def: FeatureSet):
        """Execute SQL-based feature calculation"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute(feature_def.sql_query, (account_id,))
            result = cursor.fetchone()
            return result[0] if result else None
        finally:
            conn.close()
    
    def calculate_in_out_ratio(self, account_id: str, transactions_df: pd.DataFrame) -> float:
        """Calculate inbound to outbound transaction ratio"""
        account_txs = transactions_df[transactions_df['account_id'] == account_id]
        
        inbound = account_txs[account_txs['direction'] == 'inbound']['amount'].sum()
        outbound = account_txs[account_txs['direction'] == 'outbound']['amount'].sum()
        
        if outbound == 0:
            return float('inf')  # Infinite ratio if no outbound
        return inbound / outbound
    
    def calculate_degree_centrality(self, account_id: str, transactions_df: pd.DataFrame) -> int:
        """Calculate number of unique counterparties"""
        account_txs = transactions_df[transactions_df['account_id'] == account_id]
        return account_txs['counterparty_account'].nunique()
    
    def detect_simple_cycles(self, account_id: str, transactions_df: pd.DataFrame) -> bool:
        """Detect simple circular transactions (A?B?A)"""
        account_txs = transactions_df[transactions_df['account_id'] == account_id]
        
        # Get outbound transactions
        outbound = account_txs[account_txs['direction'] == 'outbound']
        
        for _, tx in outbound.iterrows():
            counterparty = tx['counterparty_account']
            # Check if counterparty sent money back
            counterparty_txs = transactions_df[
                (transactions_df['account_id'] == counterparty) &
                (transactions_df['direction'] == 'outbound')
            ]
            
            if account_id in counterparty_txs['counterparty_account'].values:
                return True
        
        return False
    
    def get_feature_schema(self):
        """Get feature store schema in SQL format"""
        schema = {
            'customer_features': '''
                CREATE TABLE customer_features (
                    account_id VARCHAR(50) PRIMARY KEY,
                    customer_age INT,
                    customer_type VARCHAR(20),
                    occupation_risk_score FLOAT,
                    declared_income FLOAT,
                    days_since_account_open INT,
                    days_since_last_activity INT,
                    account_dormancy_flag BOOLEAN,
                    recent_account_open_flag BOOLEAN,
                    profile_change_count_30d INT,
                    address_change_flag BOOLEAN,
                    phone_change_flag BOOLEAN,
                    email_change_flag BOOLEAN,
                    updated_at TIMESTAMP
                )
            ''',
            'transaction_features': '''
                CREATE TABLE transaction_features (
                    feature_id VARCHAR(100) PRIMARY KEY,
                    account_id VARCHAR(50),
                    timestamp TIMESTAMP,
                    inbound_amount_24h FLOAT,
                    outbound_amount_24h FLOAT,
                    in_out_ratio FLOAT,
                    balance_retention_ratio FLOAT,
                    avg_daily_balance_30d FLOAT,
                    pass_through_ratio FLOAT,
                    funds_exit_within_1h_flag BOOLEAN,
                    funds_exit_within_24h_flag BOOLEAN,
                    unique_inbound_counterparties_30d INT,
                    unique_outbound_counterparties_30d INT,
                    counterparty_concentration_ratio FLOAT,
                    tx_count_1h INT,
                    tx_count_24h INT,
                    tx_count_7d INT,
                    tx_velocity_ratio FLOAT,
                    avg_time_between_in_and_out FLOAT,
                    night_tx_ratio FLOAT,
                    weekend_tx_ratio FLOAT,
                    avg_tx_amount FLOAT,
                    tx_amount_stddev FLOAT,
                    round_amount_ratio FLOAT,
                    threshold_avoidance_flag BOOLEAN,
                    updated_at TIMESTAMP
                )
            ''',
            # Add all other feature tables...
        }
        return schema
    
    def map_to_basel_typologies(self, features: List[str]) -> Dict[str, List[str]]:
        """Map features to Basel AML typologies"""
        typology_map = {}
        
        for feature_name in features:
            feature_def = self.feature_definitions.get(feature_name)
            if feature_def and feature_def.basel_typology:
                typology = feature_def.basel_typology
                if typology not in typology_map:
                    typology_map[typology] = []
                typology_map[typology].append(feature_name)
        
        return typology_map