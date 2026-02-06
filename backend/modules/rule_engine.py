import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Any, Tuple
import re

class RuleEngine:
    def __init__(self, config=None):
        self.config = self._merge_config(config or {})
        self.rule_catalog = self._build_rule_catalog()
        
    @staticmethod
    def default_config():
        return {
            "rule_weights": {"velocity": 0.3, "recency": 0.2, "circularity": 0.3, "device": 0.2},
            "rules": {
                "velocity": {
                    "rapid_fund_movement": {"enabled": True, "weight": 0.8},
                    "transaction_burst": {"enabled": True, "weight": 0.6},
                    "multi_rail_transfers": {"enabled": True, "weight": 0.7},
                },
                "recency": {
                    "new_account_flag": {"enabled": True, "weight": 0.5},
                    "dormant_to_active": {"enabled": True, "weight": 0.7},
                    "profile_change_activity": {"enabled": True, "weight": 0.6},
                },
                "circularity": {
                    "simple_cycle": {"enabled": True, "weight": 0.9},
                    "round_tripping": {"enabled": True, "weight": 0.8},
                    "repeated_loops": {"enabled": True, "weight": 0.85},
                },
                "device": {
                    "shared_device": {"enabled": True, "weight": 0.8},
                    "device_change_frequency": {"enabled": True, "weight": 0.6},
                    "ip_vpn_anomalies": {"enabled": False, "weight": 0.4},
                },
            },
        }

    def _merge_config(self, cfg: Dict) -> Dict:
        base = self.default_config()
        merged = {
            "rule_weights": {**base.get("rule_weights", {}), **(cfg.get("rule_weights") or {})},
            "rules": base.get("rules", {}),
        }
        incoming_rules = cfg.get("rules") or {}
        for cat, rules in merged["rules"].items():
            inc_cat = incoming_rules.get(cat) or {}
            for rid, spec in rules.items():
                inc_spec = inc_cat.get(rid) or {}
                spec["enabled"] = bool(inc_spec.get("enabled", spec.get("enabled", True)))
                if "weight" in inc_spec:
                    try:
                        spec["weight"] = float(inc_spec["weight"])
                    except Exception:
                        pass
        return merged

    def _build_rule_catalog(self):
        return {
            "velocity": [
                {"id": "rapid_fund_movement", "title": "Rapid Fund Movement", "fn": self._velocity_rule_1},
                {"id": "transaction_burst", "title": "Transaction Burst", "fn": self._velocity_rule_2},
                {"id": "multi_rail_transfers", "title": "Multi-Rail Transfers", "fn": self._velocity_rule_3},
            ],
            "recency": [
                {"id": "new_account_flag", "title": "New Account Flag", "fn": self._recency_rule_1},
                {"id": "dormant_to_active", "title": "Dormant-to-Active", "fn": self._recency_rule_2},
                {"id": "profile_change_activity", "title": "Profile Change + Activity", "fn": self._recency_rule_3},
            ],
            "circularity": [
                {"id": "simple_cycle", "title": "Simple Cycle", "fn": self._circularity_rule_1},
                {"id": "round_tripping", "title": "Round-Tripping", "fn": self._circularity_rule_2},
                {"id": "repeated_loops", "title": "Repeated Loops", "fn": self._circularity_rule_3},
            ],
            "device": [
                {"id": "shared_device", "title": "Shared Device", "fn": self._device_rule_1},
                {"id": "device_change_frequency", "title": "Device Change Frequency", "fn": self._device_rule_2},
                {"id": "ip_vpn_anomalies", "title": "IP/VPN Anomalies", "fn": self._device_rule_3},
            ],
        }
    
    def apply_all_rules(self, transactions_df: pd.DataFrame) -> Dict[str, Dict]:
        """Apply all rules to transaction data"""
        
        results = {}
        
        for account_id, account_df in transactions_df.groupby('account_id'):
            account_results = self._apply_rules_to_account(account_id, account_df, transactions_df)
            results[account_id] = account_results
        
        return results
    
    def _apply_rules_to_account(self, account_id: str, account_df: pd.DataFrame, 
                               all_df: pd.DataFrame) -> Dict:
        """Apply rules to a single account"""
        
        results = {
            'rule_scores': {},
            'triggered_rules': [],
            'triggered_by_category': {"velocity": [], "recency": [], "circularity": [], "device": []},
            'rule_details': {"velocity": [], "recency": [], "circularity": [], "device": []},
            'risk_score': 0,
            'risk_category': 'Low'
        }

        category_scores = {}
        for cat, rules in self.rule_catalog.items():
            cat_conf = (self.config.get("rules") or {}).get(cat) or {}
            sum_w = 0.0
            sum_ws = 0.0
            for spec in rules:
                rid = spec["id"]
                fn = spec["fn"]
                conf = cat_conf.get(rid) or {}
                enabled = bool(conf.get("enabled", True))
                weight = float(conf.get("weight", 1.0) or 0.0)
                base_score = 0.0
                triggered = False
                if enabled and weight > 0:
                    base_score, triggered = fn(account_df, all_df)
                weighted_score = float(base_score) * float(weight)
                if enabled and weight > 0:
                    sum_w += float(weight)
                    sum_ws += float(weighted_score)
                detail = {
                    "id": rid,
                    "title": spec.get("title"),
                    "enabled": enabled,
                    "weight": float(weight),
                    "score": float(base_score),
                    "weighted_score": float(weighted_score),
                    "triggered": bool(triggered),
                }
                results["rule_details"][cat].append(detail)
                if triggered:
                    results["triggered_rules"].append(rid)
                    results["triggered_by_category"][cat].append(rid)
            if sum_w <= 0:
                category_scores[cat] = 0.0
            else:
                category_scores[cat] = float(min(1.0, sum_ws / sum_w))

        results["rule_scores"] = dict(category_scores)

        weights = self.config.get("rule_weights") or {}
        overall_score = (
            float(category_scores.get("velocity", 0)) * float(weights.get("velocity", 0.3)) +
            float(category_scores.get("recency", 0)) * float(weights.get("recency", 0.2)) +
            float(category_scores.get("circularity", 0)) * float(weights.get("circularity", 0.3)) +
            float(category_scores.get("device", 0)) * float(weights.get("device", 0.2))
        )

        results["risk_score"] = float(min(overall_score, 1.0))
        
        # Determine risk category
        if results["risk_score"] >= 0.7:
            results["risk_category"] = "High"
        elif results["risk_score"] >= 0.3:
            results["risk_category"] = "Medium"
        else:
            results["risk_category"] = "Low"
        
        return results
    
    # ==================== VELOCITY RULES ====================
    
    def _velocity_rule_1(self, account_df: pd.DataFrame, all_df: pd.DataFrame) -> Tuple[float, bool]:
        """Rule 1: Rapid fund movement (large transactions in short time)"""
        
        if len(account_df) < 2:
            return 0.0, False
        
        # Sort by timestamp
        account_df = account_df.sort_values('timestamp')
        
        # Calculate time between large transactions (> $5000)
        large_txs = account_df[account_df['amount'] > 5000]
        
        if len(large_txs) < 2:
            return 0.0, False
        
        time_diffs = []
        for i in range(1, len(large_txs)):
            time_diff = (large_txs.iloc[i]['timestamp'] - large_txs.iloc[i-1]['timestamp']).total_seconds()
            time_diffs.append(time_diff)
        
        avg_time_diff = np.mean(time_diffs) if time_diffs else float('inf')
        
        # Score based on frequency (more frequent = higher risk)
        if avg_time_diff < 3600:  # Less than 1 hour
            return 0.8, True
        elif avg_time_diff < 86400:  # Less than 1 day
            return 0.5, True
        else:
            return 0.0, False
    
    def _velocity_rule_2(self, account_df: pd.DataFrame, all_df: pd.DataFrame) -> Tuple[float, bool]:
        """Rule 2: Transaction bursts (many transactions in short period)"""
        
        if len(account_df) < 5:
            return 0.0, False
        
        # Group by hour
        account_df['hour_group'] = account_df['timestamp'].dt.floor('H')
        hourly_counts = account_df.groupby('hour_group').size()
        
        # Check for bursts (more than 5 transactions per hour)
        burst_hours = hourly_counts[hourly_counts > 5]
        
        if len(burst_hours) == 0:
            return 0.0, False
        
        # Score based on number of burst hours
        if len(burst_hours) >= 3:
            return 0.9, True
        elif len(burst_hours) >= 2:
            return 0.6, True
        else:
            return 0.3, True
    
    def _velocity_rule_3(self, account_df: pd.DataFrame, all_df: pd.DataFrame) -> Tuple[float, bool]:
        """Rule 3: Multi-rail transfers (using multiple payment methods)"""
        
        if 'transaction_type' not in account_df.columns:
            return 0.0, False
        
        # Count unique transaction types in last 24 hours
        now = datetime.now()
        recent_txs = account_df[account_df['timestamp'] >= now - timedelta(hours=24)]
        
        unique_types = recent_txs['transaction_type'].nunique()
        
        if unique_types >= 3:
            return 0.7, True
        elif unique_types == 2:
            return 0.4, True
        else:
            return 0.0, False
    
    # ==================== RECENCY RULES ====================
    
    def _recency_rule_1(self, account_df: pd.DataFrame, all_df: pd.DataFrame) -> Tuple[float, bool]:
        """Rule 1: New account with high activity"""
        
        # Check if account is new (< 30 days)
        if len(account_df) == 0:
            return 0.0, False
        
        first_tx = account_df['timestamp'].min()
        account_age = (datetime.now() - first_tx).days
        
        if account_age > 30:
            return 0.0, False
        
        # Check activity level
        recent_txs = account_df[account_df['timestamp'] >= datetime.now() - timedelta(days=7)]
        tx_count = len(recent_txs)
        
        if tx_count > 10:
            return 0.8, True
        elif tx_count > 5:
            return 0.5, True
        else:
            return 0.2, True
    
    def _recency_rule_2(self, account_df: pd.DataFrame, all_df: pd.DataFrame) -> Tuple[float, bool]:
        """Rule 2: Dormant account becomes active"""
        
        if len(account_df) < 10:
            return 0.0, False
        
        # Sort by timestamp
        account_df = account_df.sort_values('timestamp')
        
        # Find longest gap
        time_diffs = []
        for i in range(1, len(account_df)):
            time_diff = (account_df.iloc[i]['timestamp'] - account_df.iloc[i-1]['timestamp']).days
            time_diffs.append(time_diff)
        
        if not time_diffs:
            return 0.0, False
        
        max_gap = max(time_diffs)
        
        if max_gap > 90:  # Dormant for more than 90 days
            # Check if recent activity after dormancy
            last_tx = account_df.iloc[-1]['timestamp']
            if (datetime.now() - last_tx).days < 7:
                return 0.7, True
        
        return 0.0, False
    
    def _recency_rule_3(self, account_df: pd.DataFrame, all_df: pd.DataFrame) -> Tuple[float, bool]:
        """Rule 3: Profile change followed by activity"""
        
        # In production, this would check actual profile changes
        # For now, we'll use a simplified version
        
        if 'profile_change_flag' not in account_df.columns:
            return 0.0, False
        
        # Check if there was a recent profile change
        recent_changes = account_df[account_df['profile_change_flag'] == True]
        
        if len(recent_changes) == 0:
            return 0.0, False
        
        last_change = recent_changes['timestamp'].max()
        
        # Check transactions after profile change
        txs_after_change = account_df[account_df['timestamp'] > last_change]
        
        if len(txs_after_change) > 5:
            return 0.6, True
        elif len(txs_after_change) > 2:
            return 0.3, True
        else:
            return 0.0, False
    
    # ==================== CIRCULARITY RULES ====================
    
    def _circularity_rule_1(self, account_df: pd.DataFrame, all_df: pd.DataFrame) -> Tuple[float, bool]:
        """Rule 1: Simple circular transactions (A→B→A)"""
        
        # Get outbound transactions
        outbound = account_df[account_df['direction'] == 'outbound']
        
        circular_count = 0
        
        for _, tx in outbound.iterrows():
            counterparty = tx['counterparty_account']
            
            # Check if counterparty sent money back
            return_tx = all_df[
                (all_df['account_id'] == counterparty) &
                (all_df['direction'] == 'outbound') &
                (all_df['counterparty_account'] == account_df.iloc[0]['account_id'])
            ]
            
            if len(return_tx) > 0:
                circular_count += 1
        
        if circular_count >= 3:
            return 0.9, True
        elif circular_count >= 2:
            return 0.6, True
        elif circular_count >= 1:
            return 0.3, True
        else:
            return 0.0, False
    
    def _circularity_rule_2(self, account_df: pd.DataFrame, all_df: pd.DataFrame) -> Tuple[float, bool]:
        """Rule 2: Round-tripping through multiple accounts"""
        
        # Build transaction graph for this account
        G = self._build_transaction_graph(account_df, all_df)
        
        if len(G) == 0:
            return 0.0, False
        
        # Find cycles of length 3-5 (multi-hop round tripping)
        try:
            cycles = list(nx.simple_cycles(G))
            
            # Filter cycles of appropriate length
            multi_hop_cycles = [cycle for cycle in cycles if 3 <= len(cycle) <= 5]
            
            if len(multi_hop_cycles) >= 2:
                return 0.8, True
            elif len(multi_hop_cycles) >= 1:
                return 0.5, True
            else:
                return 0.0, False
                
        except:
            return 0.0, False
    
    def _circularity_rule_3(self, account_df: pd.DataFrame, all_df: pd.DataFrame) -> Tuple[float, bool]:
        """Rule 3: Repeated circular patterns"""
        
        # Check for repeated circular transactions with same counterparties
        outbound = account_df[account_df['direction'] == 'outbound']
        
        counterparty_counts = outbound['counterparty_account'].value_counts()
        
        # Count counterparties with multiple circular transactions
        repeated_circular = 0
        
        for counterparty, count in counterparty_counts.items():
            if count >= 3:
                # Check if circular
                return_txs = all_df[
                    (all_df['account_id'] == counterparty) &
                    (all_df['direction'] == 'outbound') &
                    (all_df['counterparty_account'] == account_df.iloc[0]['account_id'])
                ]
                
                if len(return_txs) >= 2:
                    repeated_circular += 1
        
        if repeated_circular >= 2:
            return 0.7, True
        elif repeated_circular >= 1:
            return 0.4, True
        else:
            return 0.0, False
    
    # ==================== DEVICE RULES ====================
    
    def _device_rule_1(self, account_df: pd.DataFrame, all_df: pd.DataFrame) -> Tuple[float, bool]:
        """Rule 1: Shared device usage"""
        
        if 'device_id' not in account_df.columns:
            return 0.0, False
        
        # Get primary device
        device_counts = account_df['device_id'].value_counts()
        
        if len(device_counts) == 0:
            return 0.0, False
        
        primary_device = device_counts.index[0]
        
        # Count other accounts using same device
        other_accounts = all_df[
            (all_df['device_id'] == primary_device) &
            (all_df['account_id'] != account_df.iloc[0]['account_id'])
        ]['account_id'].nunique()
        
        if other_accounts >= 5:
            return 0.9, True
        elif other_accounts >= 3:
            return 0.6, True
        elif other_accounts >= 1:
            return 0.3, True
        else:
            return 0.0, False
    
    def _device_rule_2(self, account_df: pd.DataFrame, all_df: pd.DataFrame) -> Tuple[float, bool]:
        """Rule 2: Frequent device changes"""
        
        if 'device_id' not in account_df.columns:
            return 0.0, False
        
        # Count unique devices in last 7 days
        recent_txs = account_df[account_df['timestamp'] >= datetime.now() - timedelta(days=7)]
        
        if len(recent_txs) < 3:
            return 0.0, False
        
        unique_devices = recent_txs['device_id'].nunique()
        
        if unique_devices >= 4:
            return 0.8, True
        elif unique_devices >= 3:
            return 0.5, True
        elif unique_devices >= 2:
            return 0.2, True
        else:
            return 0.0, False
    
    def _device_rule_3(self, account_df: pd.DataFrame, all_df: pd.DataFrame) -> Tuple[float, bool]:
        """Rule 3: IP/VPN anomalies"""
        
        if 'ip_address' not in account_df.columns:
            return 0.0, False
        
        # Check for VPN/proxy patterns
        ip_counts = account_df['ip_address'].value_counts()
        
        # Known VPN patterns (simplified)
        vpn_patterns = [
            r'^192\.168\.',  # Private IP
            r'^10\.',        # Private IP
            r'^172\.(1[6-9]|2[0-9]|3[0-1])\.',  # Private IP
            r'vpn', 'proxy', 'tor'  # Keywords in IP/hostname
        ]
        
        vpn_ips = []
        for ip in ip_counts.index:
            ip_str = str(ip).lower()
            for pattern in vpn_patterns:
                if re.search(pattern, ip_str):
                    vpn_ips.append(ip)
                    break
        
        if len(vpn_ips) >= 2:
            return 0.7, True
        elif len(vpn_ips) >= 1:
            # Check if VPN used for significant transactions
            vpn_txs = account_df[account_df['ip_address'].isin(vpn_ips)]
            if vpn_txs['amount'].sum() > 10000:
                return 0.5, True
            else:
                return 0.2, True
        else:
            return 0.0, False
    
    def _build_transaction_graph(self, account_df: pd.DataFrame, all_df: pd.DataFrame):
        """Build transaction graph for circularity analysis"""
        
        import networkx as nx
        
        G = nx.DiGraph()
        
        # Add edges for this account's transactions
        for _, tx in account_df.iterrows():
            if tx['direction'] == 'outbound':
                G.add_edge(
                    tx['account_id'],
                    tx['counterparty_account'],
                    amount=tx['amount'],
                    timestamp=tx['timestamp']
                )
        
        return G
    
    def generate_alert_narrative(self, account_id: str, rule_results: Dict) -> str:
        """Generate human-readable alert narrative"""
        
        triggered_rules = rule_results.get('triggered_rules', [])
        risk_score = rule_results.get('risk_score', 0)
        risk_category = rule_results.get('risk_category', 'Low')
        
        if not triggered_rules:
            return f"Account {account_id}: No suspicious activity detected."
        
        # Map rule names to readable descriptions
        rule_descriptions = {
            '_velocity_rule_1': 'Rapid fund movement detected',
            '_velocity_rule_2': 'Transaction burst pattern identified',
            '_velocity_rule_3': 'Multi-payment rail usage observed',
            '_recency_rule_1': 'New account with high activity',
            '_recency_rule_2': 'Dormant account reactivated with suspicious activity',
            '_recency_rule_3': 'Profile changes followed by unusual transactions',
            '_circularity_rule_1': 'Circular transaction patterns detected',
            '_circularity_rule_2': 'Round-tripping through multiple accounts',
            '_circularity_rule_3': 'Repeated circular transaction patterns',
            '_device_rule_1': 'Device sharing across multiple accounts',
            '_device_rule_2': 'Frequent device changes',
            '_device_rule_3': 'VPN/Proxy usage for transactions'
        }
        
        # Generate narrative
        narrative = f"ALERT: Account {account_id} flagged as {risk_category} risk (Score: {risk_score:.2f})\n\n"
        narrative += "Triggered Detection Rules:\n"
        
        for rule in triggered_rules:
            description = rule_descriptions.get(rule, rule.replace('_', ' ').title())
            narrative += f"• {description}\n"
        
        # Add risk drivers
        rule_scores = rule_results.get('rule_scores', {})
        primary_risk = max(rule_scores.items(), key=lambda x: x[1]) if rule_scores else ('None', 0)
        
        narrative += f"\nPrimary Risk Driver: {primary_risk[0].replace('_score', '').title()} "
        narrative += f"(Score: {primary_risk[1]:.2f})\n"
        
        # Add recommendations
        narrative += "\nRecommended Actions:\n"
        
        if risk_category == 'High':
            narrative += "1. Immediate account freeze\n"
            narrative += "2. Enhanced due diligence required\n"
            narrative += "3. File SAR/STR if thresholds exceeded\n"
        elif risk_category == 'Medium':
            narrative += "1. Additional monitoring required\n"
            narrative += "2. Request additional KYC documentation\n"
            narrative += "3. Set transaction limits\n"
        else:
            narrative += "1. Continue normal monitoring\n"
            narrative += "2. Review in next periodic assessment\n"
        
        return narrative
