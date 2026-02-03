# backend/services/mule_detection/feature_engine.py
"""
Feature Engine: Derives behavioral features from raw transaction data
All features computed on-demand, no pre-computation
"""
import pandas as pd
import numpy as np
from typing import Dict, List, Optional

class MuleFeatureEngine:
    """Computes mule detection features from transaction data"""
    
    def __init__(self):
        self.feature_catalog = {
            'pass_through_ratio': 'Ratio of outgoing to incoming funds',
            'retention_ratio': 'Percentage of funds retained',
            'holding_time_avg': 'Average time between credit and debit (hours)',
            'same_day_pass_through': 'Percentage of same-day transfers',
            'unique_senders': 'Number of unique sending accounts',
            'unique_receivers': 'Number of unique receiving accounts',
            'fan_in_score': 'Aggregation pattern strength',
            'fan_out_score': 'Distribution pattern strength',
            'channel_entropy': 'Diversity of channels used',
            'channel_switching': 'Frequency of channel changes',
            'activity_spike': 'Sudden increase in activity',
            'dormancy_period': 'Days of inactivity before spike',
            'velocity': 'Transaction frequency (txns/day)',
            'turnover_ratio': 'Flow vs expected turnover'
        }
    
    def compute_account_features(self, df: pd.DataFrame, account_id: str, 
                                 account_meta: Optional[Dict] = None) -> Dict:
        """
        Compute all features for a single account
        
        Args:
            df: Full transaction dataframe
            account_id: Target account ID
            account_meta: Optional account metadata (occupation, expected_turnover, etc.)
        
        Returns:
            Dictionary of computed features
        """
        # Filter account transactions
        account_df = df[df['account_id'] == account_id].copy()
        
        if len(account_df) == 0:
            return self._empty_features()
        
        # Parse timestamps
        account_df['txn_timestamp'] = pd.to_datetime(account_df['txn_timestamp'])
        account_df = account_df.sort_values('txn_timestamp')
        
        # Split credits/debits
        credits = account_df[account_df['direction'] == 'credit']
        debits = account_df[account_df['direction'] == 'debit']
        
        features = {}
        
        # === FLOW FEATURES ===
        features.update(self._compute_flow_features(credits, debits))
        
        # === STRUCTURE FEATURES ===
        features.update(self._compute_structure_features(credits, debits))
        
        # === TIMING FEATURES ===
        features.update(self._compute_timing_features(account_df, credits, debits))
        
        # === CHANNEL FEATURES ===
        features.update(self._compute_channel_features(account_df))
        
        # === ECONOMIC PLAUSIBILITY ===
        if account_meta:
            features.update(self._compute_economic_features(
                credits, debits, account_meta
            ))
        
        return features
    
    def _compute_flow_features(self, credits: pd.DataFrame, debits: pd.DataFrame) -> Dict:
        """Compute pass-through and retention features"""
        total_credit = credits['amount'].sum()
        total_debit = debits['amount'].sum()
        
        pass_through = total_debit / total_credit if total_credit > 0 else 0
        retention = (total_credit - total_debit) / total_credit if total_credit > 0 else 0
        
        return {
            'total_credit': float(total_credit),
            'total_debit': float(total_debit),
            'pass_through_ratio': float(pass_through),
            'retention_ratio': float(retention),
            'net_balance': float(total_credit - total_debit)
        }
    
    def _compute_structure_features(self, credits: pd.DataFrame, debits: pd.DataFrame) -> Dict:
        """Compute fan-in/fan-out and counterparty features"""
        unique_senders = credits['counterparty_account'].nunique() if 'counterparty_account' in credits.columns else 0
        unique_receivers = debits['counterparty_account'].nunique() if 'counterparty_account' in debits.columns else 0
        
        # Fan-in: Many senders -> One account
        fan_in_score = unique_senders / len(credits) if len(credits) > 0 else 0
        
        # Fan-out: One account -> Many receivers
        fan_out_score = unique_receivers / len(debits) if len(debits) > 0 else 0
        
        # Sender/Receiver concentration (Gini-like)
        sender_concentration = self._compute_concentration(
            credits, 'counterparty_account', 'amount'
        ) if len(credits) > 0 else 0
        
        receiver_concentration = self._compute_concentration(
            debits, 'counterparty_account', 'amount'
        ) if len(debits) > 0 else 0
        
        return {
            'unique_senders': int(unique_senders),
            'unique_receivers': int(unique_receivers),
            'fan_in_score': float(fan_in_score),
            'fan_out_score': float(fan_out_score),
            'sender_concentration': float(sender_concentration),
            'receiver_concentration': float(receiver_concentration)
        }
    
    def _compute_timing_features(self, account_df: pd.DataFrame, 
                                 credits: pd.DataFrame, debits: pd.DataFrame) -> Dict:
        """Compute holding time and activity spike features"""
        # Holding time: credit -> debit
        holding_times = []
        same_day_count = 0
        
        for _, credit in credits.iterrows():
            credit_time = credit['txn_timestamp']
            
            # Find next debit
            future_debits = debits[debits['txn_timestamp'] > credit_time]
            
            if len(future_debits) > 0:
                first_debit = future_debits.iloc[0]
                time_diff = (first_debit['txn_timestamp'] - credit_time).total_seconds() / 3600
                holding_times.append(time_diff)
                
                if time_diff < 24:
                    same_day_count += 1
        
        avg_holding = np.mean(holding_times) if holding_times else 0
        same_day_pct = same_day_count / len(credits) if len(credits) > 0 else 0
        
        # Activity spike detection
        date_range = (account_df['txn_timestamp'].max() - account_df['txn_timestamp'].min()).days
        velocity = len(account_df) / max(date_range, 1)
        
        # Check for dormancy
        account_df['date'] = account_df['txn_timestamp'].dt.date
        daily_counts = account_df.groupby('date').size()
        
        dormancy_days = 0
        if len(daily_counts) > 1:
            date_gaps = pd.Series(daily_counts.index).diff().dt.days
            dormancy_days = date_gaps.max() if len(date_gaps) > 0 else 0
        
        return {
            'holding_time_avg': float(avg_holding),
            'same_day_pass_through': float(same_day_pct),
            'velocity': float(velocity),
            'dormancy_period': int(dormancy_days),
            'activity_spike': self._detect_spike(daily_counts)
        }
    
    def _compute_channel_features(self, account_df: pd.DataFrame) -> Dict:
        """Compute channel diversity and switching features"""
        if 'channel' not in account_df.columns:
            return {
                'channel_entropy': 0.0,
                'channel_switching': 0.0,
                'unique_channels': 0
            }
        
        # Channel entropy (Shannon)
        channel_counts = account_df['channel'].value_counts(normalize=True)
        entropy = -sum(p * np.log2(p) for p in channel_counts if p > 0)
        
        # Channel switching frequency
        account_df = account_df.sort_values('txn_timestamp')
        switches = (account_df['channel'] != account_df['channel'].shift()).sum() - 1
        switching_rate = switches / max(len(account_df) - 1, 1)
        
        return {
            'channel_entropy': float(entropy),
            'channel_switching': float(switching_rate),
            'unique_channels': int(account_df['channel'].nunique())
        }
    
    def _compute_economic_features(self, credits: pd.DataFrame, debits: pd.DataFrame, 
                                   account_meta: Dict) -> Dict:
        """Compute economic plausibility features"""
        expected_turnover = account_meta.get('expected_turnover', 0)
        occupation = account_meta.get('occupation', '')
        
        actual_turnover = credits['amount'].sum()
        
        turnover_ratio = actual_turnover / expected_turnover if expected_turnover > 0 else 0
        turnover_excess = actual_turnover - expected_turnover
        
        return {
            'expected_turnover': float(expected_turnover),
            'actual_turnover': float(actual_turnover),
            'turnover_ratio': float(turnover_ratio),
            'turnover_excess': float(turnover_excess),
            'occupation': occupation
        }
    
    def _compute_concentration(self, df: pd.DataFrame, group_col: str, value_col: str) -> float:
        """Compute Gini-like concentration coefficient"""
        if len(df) == 0:
            return 0.0
        
        grouped = df.groupby(group_col)[value_col].sum().sort_values()
        n = len(grouped)
        
        if n == 1:
            return 1.0
        
        # Gini coefficient
        cumsum = grouped.cumsum()
        gini = (2 * sum((i + 1) * v for i, v in enumerate(grouped)) / (n * cumsum.iloc[-1])) - (n + 1) / n
        
        return float(gini)
    
    def _detect_spike(self, daily_counts: pd.Series) -> bool:
        """Detect if there's an activity spike"""
        if len(daily_counts) < 3:
            return False
        
        mean = daily_counts.mean()
        std = daily_counts.std()
        
        # Spike: any day > mean + 2*std
        return bool((daily_counts > mean + 2 * std).any())
    
    def _empty_features(self) -> Dict:
        """Return empty feature set"""
        return {
            'total_credit': 0.0,
            'total_debit': 0.0,
            'pass_through_ratio': 0.0,
            'retention_ratio': 0.0,
            'unique_senders': 0,
            'unique_receivers': 0,
            'holding_time_avg': 0.0,
            'channel_entropy': 0.0
        }