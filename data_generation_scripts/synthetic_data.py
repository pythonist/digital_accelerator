import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import random
from typing import Dict, List, Tuple

class SyntheticDataGenerator:
    def __init__(self, seed=42):
        np.random.seed(seed)
        random.seed(seed)
    
    def generate_transactions(self, num_records=10000, mule_ratio=0.1, label_noise=0.03, behavior_noise=0.12):
        num_accounts = int(num_records / 10)
        accounts = self._generate_accounts(num_accounts, mule_ratio, label_noise=label_noise)
        transactions = []
        transaction_id = 1000000
        
        for _ in range(num_records):
            account = random.choice(accounts)
            effective_is_mule = bool(account['is_mule'])
            if np.random.random() < float(behavior_noise or 0):
                effective_is_mule = not effective_is_mule
            if effective_is_mule:
                tx = self._generate_mule_transaction(account, transaction_id)
            else:
                tx = self._generate_normal_transaction(account, transaction_id)
            transactions.append(tx)
            transaction_id += 1
        
        df = pd.DataFrame(transactions)
        df = self._add_temporal_patterns(df)
        df = self._add_network_patterns(df, accounts, behavior_noise=behavior_noise)
        accounts_df = pd.DataFrame(accounts)
        return df, accounts_df
    
    def _generate_accounts(self, num_accounts, mule_ratio, label_noise=0.03):
        accounts = []
        for i in range(num_accounts):
            is_mule = np.random.random() < mule_ratio
            if np.random.random() < float(label_noise or 0):
                is_mule = not is_mule
            account = {
                'account_id': f'ACC{100000 + i}',
                'customer_age': np.random.randint(18, 80),
                'customer_type': np.random.choice(['individual', 'business'], p=[0.85, 0.15]),
                'declared_income': np.random.lognormal(10, 0.5),
                'account_open_date': datetime.now() - timedelta(days=np.random.randint(1, 365*5)),
                'days_since_last_activity': np.random.randint(0, 90),
                'is_mule': is_mule,
                'device_id': f'DEV{np.random.randint(1000, 9999)}',
                'ip_address': f'192.168.{np.random.randint(1, 255)}.{np.random.randint(1, 255)}'
            }
            if is_mule:
                account['days_since_account_open'] = np.random.randint(1, 90)
                account['profile_change_count_30d'] = np.random.randint(2, 10)
                account['shared_device_flag'] = True
            else:
                account['days_since_account_open'] = np.random.randint(90, 365*3)
                account['profile_change_count_30d'] = np.random.randint(0, 2)
                account['shared_device_flag'] = False
            accounts.append(account)
        return accounts
    
    def _generate_mule_transaction(self, account, tx_id):
        patterns = ['velocity', 'circular', 'pass_through', 'structured']
        pattern = random.choice(patterns)
        base_amount = min(account['declared_income'] * 0.1, 10000)
        if pattern == 'velocity':
            amount = np.random.uniform(500, 5000)
            timestamp = datetime.now() - timedelta(hours=np.random.randint(0, 24))
            direction = 'outbound' if np.random.random() > 0.3 else 'inbound'
        elif pattern == 'circular':
            amount = np.random.uniform(1000, 10000)
            timestamp = datetime.now() - timedelta(days=np.random.randint(0, 7))
            direction = random.choice(['inbound', 'outbound'])
        elif pattern == 'pass_through':
            amount = np.random.uniform(2000, 8000)
            timestamp = datetime.now() - timedelta(hours=np.random.randint(0, 48))
            direction = 'inbound' if np.random.random() > 0.5 else 'outbound'
        else:
            amount = np.random.uniform(4500, 9500)
            timestamp = datetime.now() - timedelta(days=np.random.randint(0, 30))
            direction = 'outbound'
            if np.random.random() < 0.25:
                direction = 'inbound'
        return {
            'transaction_id': tx_id,
            'account_id': account['account_id'],
            'timestamp': timestamp,
            'amount': float(amount),
            'direction': direction,
            'transaction_type': random.choice(['wire', 'ach', 'card', 'p2p']),
            'counterparty_account': f'CP{np.random.randint(100000, 999999)}',
            'counterparty_name': random.choice(['External Bank', 'Merchant', 'Individual']),
            'balance_after': float(np.random.uniform(1000, 50000)),
            'channel': random.choice(['mobile', 'online', 'branch']),
            'device_id': account['device_id'],
            'ip_address': account['ip_address'],
            'geo_location': random.choice(['US', 'UK', 'DE', 'NL', 'HK', 'SG']),
            'is_suspicious': bool(np.random.random() > 0.12),
            'mule_pattern': pattern if np.random.random() > 0.1 else None
        }
    
    def _generate_normal_transaction(self, account, tx_id):
        amount = np.random.exponential(account['declared_income'] * 0.01)
        amount = min(amount, 5000)
        timestamp = datetime.now() - timedelta(days=np.random.randint(0, 90))
        if account['customer_type'] == 'business':
            direction = random.choice(['inbound', 'outbound'])
            tx_type = random.choice(['wire', 'ach', 'card'])
            amount = np.random.uniform(100, 5000)
        else:
            direction = 'outbound' if np.random.random() > 0.6 else 'inbound'
            tx_type = random.choice(['card', 'p2p', 'ach'])
            amount = np.random.uniform(10, 1000)
        return {
            'transaction_id': tx_id,
            'account_id': account['account_id'],
            'timestamp': timestamp,
            'amount': float(amount),
            'direction': direction,
            'transaction_type': tx_type,
            'counterparty_account': f'CP{np.random.randint(100000, 999999)}',
            'counterparty_name': random.choice(['Salary', 'Grocery', 'Utility', 'Shopping', 'Transfer']),
            'balance_after': float(np.random.uniform(1000, 50000)),
            'channel': random.choice(['mobile', 'online', 'branch']),
            'device_id': account['device_id'],
            'ip_address': account['ip_address'],
            'geo_location': account.get('geo_location', 'US'),
            'is_suspicious': bool(np.random.random() < 0.03),
            'mule_pattern': None if np.random.random() > 0.05 else random.choice(['velocity', 'pass_through'])
        }
    
    def _add_temporal_patterns(self, df):
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df['hour'] = df['timestamp'].dt.hour
        df['day_of_week'] = df['timestamp'].dt.dayofweek
        df['is_weekend'] = df['day_of_week'] >= 5
        df['is_night'] = (df['hour'] >= 22) | (df['hour'] <= 6)
        return df
    
    def _add_network_patterns(self, df, accounts, behavior_noise=0.12):
        mule_accounts = [acc['account_id'] for acc in accounts if acc['is_mule']]
        non_mule_accounts = [acc['account_id'] for acc in accounts if not acc['is_mule']]
        pairs = []
        for i in range(0, max(0, len(mule_accounts) - 1), 2):
            pairs.append((mule_accounts[i], mule_accounts[i + 1] if i + 1 < len(mule_accounts) else mule_accounts[0]))
        if non_mule_accounts and np.random.random() < float(behavior_noise or 0):
            for _ in range(min(10, len(non_mule_accounts) // 2)):
                a = random.choice(non_mule_accounts)
                b = random.choice(non_mule_accounts)
                if a != b:
                    pairs.append((a, b))

        for i, (acc1, acc2) in enumerate(pairs):
            circular_tx = {
                'transaction_id': 999000 + i,
                'account_id': acc1,
                'timestamp': datetime.now() - timedelta(minutes=int(np.random.randint(15, 180))),
                'amount': float(np.random.uniform(500, 9000)),
                'direction': 'outbound',
                'transaction_type': 'wire',
                'counterparty_account': acc2,
                'counterparty_name': 'Network Counterparty',
                'balance_after': float(np.random.uniform(1000, 50000)),
                'channel': random.choice(['online', 'mobile', 'branch']),
                'device_id': f'DEV{np.random.randint(1000, 9999)}' if np.random.random() < 0.7 else 'SHARED001',
                'ip_address': f'192.168.{np.random.randint(1, 255)}.{np.random.randint(1, 255)}',
                'geo_location': random.choice(['US', 'UK', 'DE', 'NL', 'HK', 'SG']),
                'is_suspicious': bool(np.random.random() > 0.2),
                'mule_pattern': 'circular'
            }
            df = pd.concat([df, pd.DataFrame([circular_tx])], ignore_index=True)
        return df
