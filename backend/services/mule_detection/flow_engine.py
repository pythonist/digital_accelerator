# backend/services/mule_detection/flow_engine.py
"""
Flow Engine: Analyzes money flow patterns (credit -> debit chains)
Computes flow chains on-demand with configurable matching logic
"""
import pandas as pd
from typing import Dict, List, Optional
from datetime import timedelta

class MuleFlowEngine:
    """Analyzes transaction flow patterns for mule detection"""
    
    def __init__(self):
        self.default_match_window = 24  # hours
        self.amount_tolerance = 0.05  # 5% tolerance for amount matching
    
    def analyze_flows(self, df: pd.DataFrame, account_id: str, 
                     match_window_hours: int = 24,
                     match_by_amount: bool = False) -> Dict:
        """
        Analyze credit -> debit flow patterns
        
        Args:
            df: Transaction dataframe
            account_id: Target account
            match_window_hours: Time window for pairing credits/debits
            match_by_amount: Whether to match by similar amounts
        
        Returns:
            Flow analysis results
        """
        account_df = df[df['account_id'] == account_id].copy()
        account_df['txn_timestamp'] = pd.to_datetime(account_df['txn_timestamp'])
        account_df = account_df.sort_values('txn_timestamp')
        
        credits = account_df[account_df['direction'] == 'credit']
        debits = account_df[account_df['direction'] == 'debit']
        
        flows = []
        unmatched_credits = []
        
        for _, credit in credits.iterrows():
            matched = self._find_matching_debit(
                credit, debits, match_window_hours, match_by_amount
            )
            
            if matched is not None:
                flows.append(matched)
            else:
                unmatched_credits.append({
                    'timestamp': credit['txn_timestamp'].isoformat(),
                    'amount': float(credit['amount']),
                    'counterparty': credit.get('counterparty_account', 'Unknown')
                })
        
        # Calculate flow metrics
        metrics = self._calculate_flow_metrics(flows, credits, debits)
        
        return {
            'flows': flows,
            'metrics': metrics,
            'unmatched_credits': unmatched_credits
        }
    
    def _find_matching_debit(self, credit: pd.Series, debits: pd.DataFrame,
                            window_hours: int, match_amount: bool) -> Optional[Dict]:
        """Find debit that matches credit within time/amount constraints"""
        credit_time = credit['txn_timestamp']
        credit_amount = credit['amount']
        
        # Filter debits within time window
        window_end = credit_time + timedelta(hours=window_hours)
        candidate_debits = debits[
            (debits['txn_timestamp'] >= credit_time) &
            (debits['txn_timestamp'] <= window_end)
        ]
        
        if len(candidate_debits) == 0:
            return None
        
        # If amount matching enabled, filter by similar amounts
        if match_amount:
            tolerance = credit_amount * self.amount_tolerance
            candidate_debits = candidate_debits[
                (candidate_debits['amount'] >= credit_amount - tolerance) &
                (candidate_debits['amount'] <= credit_amount + tolerance)
            ]
            
            if len(candidate_debits) == 0:
                return None
        
        # Take first matching debit
        debit = candidate_debits.iloc[0]
        
        time_diff = (debit['txn_timestamp'] - credit_time).total_seconds() / 3600
        
        return {
            'credit_time': credit_time.isoformat(),
            'debit_time': debit['txn_timestamp'].isoformat(),
            'credit_amount': float(credit_amount),
            'debit_amount': float(debit['amount']),
            'time_diff_hours': float(time_diff),
            'credit_counterparty': credit.get('counterparty_account', 'Unknown'),
            'debit_counterparty': debit.get('counterparty_account', 'Unknown'),
            'credit_channel': credit.get('channel', 'Unknown'),
            'debit_channel': debit.get('channel', 'Unknown'),
            'is_same_day': time_diff < 24,
            'is_same_channel': credit.get('channel') == debit.get('channel'),
            'amount_match': abs(credit_amount - debit['amount']) / credit_amount < 0.05 if credit_amount > 0 else False
        }
    
    def _calculate_flow_metrics(self, flows: List[Dict], 
                                credits: pd.DataFrame, debits: pd.DataFrame) -> Dict:
        """Calculate aggregate flow metrics"""
        if not flows:
            return {
                'total_flows': 0,
                'same_day_flows': 0,
                'same_day_percentage': 0.0,
                'avg_holding_time': 0.0,
                'median_holding_time': 0.0,
                'channel_switching_flows': 0,
                'amount_matched_flows': 0
            }
        
        holding_times = [f['time_diff_hours'] for f in flows]
        same_day_count = sum(1 for f in flows if f['is_same_day'])
        channel_switch_count = sum(1 for f in flows if not f['is_same_channel'])
        amount_match_count = sum(1 for f in flows if f['amount_match'])
        
        return {
            'total_flows': len(flows),
            'same_day_flows': same_day_count,
            'same_day_percentage': float(same_day_count / len(flows) * 100),
            'avg_holding_time': float(sum(holding_times) / len(holding_times)),
            'median_holding_time': float(sorted(holding_times)[len(holding_times) // 2]),
            'min_holding_time': float(min(holding_times)),
            'max_holding_time': float(max(holding_times)),
            'channel_switching_flows': channel_switch_count,
            'channel_switching_percentage': float(channel_switch_count / len(flows) * 100),
            'amount_matched_flows': amount_match_count,
            'amount_matched_percentage': float(amount_match_count / len(flows) * 100),
            'unmatched_credit_count': len(credits) - len(flows),
            'unmatched_credit_percentage': float((len(credits) - len(flows)) / len(credits) * 100) if len(credits) > 0 else 0
        }
    
    def build_flow_timeline(self, df: pd.DataFrame, account_id: str) -> List[Dict]:
        """
        Build complete transaction timeline with flow annotations
        
        Returns:
            Timeline with flow connections marked
        """
        account_df = df[df['account_id'] == account_id].copy()
        account_df['txn_timestamp'] = pd.to_datetime(account_df['txn_timestamp'])
        account_df = account_df.sort_values('txn_timestamp')
        
        timeline = []
        
        for idx, row in account_df.iterrows():
            timeline.append({
                'timestamp': row['txn_timestamp'].isoformat(),
                'direction': row['direction'],
                'amount': float(row['amount']),
                'channel': row.get('channel', 'Unknown'),
                'counterparty': row.get('counterparty_account', 'Unknown'),
                'balance_after': None  # Can compute running balance if needed
            })
        
        return timeline
    
    def detect_layering(self, df: pd.DataFrame, account_id: str, 
                       min_hops: int = 3) -> Dict:
        """
        Detect layering patterns (multiple sequential transfers)
        
        Args:
            df: Transaction dataframe
            account_id: Target account
            min_hops: Minimum hops to qualify as layering
        
        Returns:
            Layering detection results
        """
        account_df = df[df['account_id'] == account_id].copy()
        account_df['txn_timestamp'] = pd.to_datetime(account_df['txn_timestamp'])
        account_df = account_df.sort_values('txn_timestamp')
        
        # Look for sequences: credit -> debit -> (same counterparty) -> debit -> ...
        sequences = []
        current_sequence = []
        
        for idx, row in account_df.iterrows():
            if row['direction'] == 'credit':
                if current_sequence:
                    if len(current_sequence) >= min_hops:
                        sequences.append(current_sequence)
                current_sequence = [row]
            elif row['direction'] == 'debit' and current_sequence:
                current_sequence.append(row)
        
        # Check last sequence
        if len(current_sequence) >= min_hops:
            sequences.append(current_sequence)
        
        return {
            'detected': len(sequences) > 0,
            'sequence_count': len(sequences),
            'max_hops': max([len(s) for s in sequences]) if sequences else 0,
            'sequences': [
                {
                    'hop_count': len(seq),
                    'start_time': seq[0]['txn_timestamp'].isoformat(),
                    'end_time': seq[-1]['txn_timestamp'].isoformat(),
                    'total_amount': sum(row['amount'] for row in seq)
                }
                for seq in sequences
            ]
        }