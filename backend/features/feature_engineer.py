import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Any, Tuple
import networkx as nx
from collections import defaultdict
import warnings
warnings.filterwarnings('ignore')

class FeatureEngineer:
    def __init__(self, feature_store=None):
        self.feature_store = feature_store
        self.feature_cache = {}
        self._network_ctx = None
    
    def engineer_all_features(self, transactions_df: pd.DataFrame, accounts_df: pd.DataFrame, progress_cb=None) -> pd.DataFrame:
        """Engineer all features from transaction and account data"""
        if accounts_df is None or len(accounts_df) == 0:
            accounts_df = pd.DataFrame({"account_id": transactions_df["account_id"].dropna().astype(str).unique().tolist()})
        
        # Ensure timestamp is datetime
        transactions_df['timestamp'] = pd.to_datetime(transactions_df['timestamp'])
        transactions_df = transactions_df.sort_values('timestamp')

        self._prepare_network_ctx(transactions_df)
        
        # Group by account
        account_features = []
        
        accounts_indexed = accounts_df.copy()
        if 'account_open_date' in accounts_indexed.columns:
            accounts_indexed['account_open_date'] = pd.to_datetime(accounts_indexed['account_open_date'], errors='coerce')
        accounts_indexed = accounts_indexed.set_index('account_id', drop=False)

        groups = list(transactions_df.groupby('account_id'))
        total_accounts = len(groups)
        last_progress_at = datetime.now()
        for idx, (account_id, account_txn_df) in enumerate(groups, start=1):
            account_row = accounts_indexed.loc[account_id] if account_id in accounts_indexed.index else None
            features = self._engineer_features_for_account(account_id, account_txn_df, transactions_df, account_row)
            account_features.append(features)
            if progress_cb is not None and (idx == 1 or idx == total_accounts or idx % 10 == 0):
                now = datetime.now()
                if (now - last_progress_at).total_seconds() >= 0.25 or idx == total_accounts:
                    progress_cb(idx, total_accounts)
                    last_progress_at = now
        
        features_df = pd.DataFrame(account_features)
        
        # Add derived features
        features_df = self._add_derived_features(features_df)
        
        return features_df

    @staticmethod
    def _safe_divide(numer, denom, default=0.0, cap=1_000_000.0) -> float:
        try:
            n = float(numer)
            d = float(denom)
            if d == 0 or np.isnan(d) or np.isinf(d):
                return float(default)
            v = n / d
            if np.isnan(v) or np.isinf(v):
                return float(default)
            if cap is not None:
                v = max(-float(cap), min(float(cap), float(v)))
            return float(v)
        except Exception:
            return float(default)

    def _prepare_network_ctx(self, all_df: pd.DataFrame) -> None:
        if self._network_ctx is not None:
            return

        df = all_df.copy()
        if 'direction' in df.columns:
            df['direction'] = df['direction'].astype(str).str.strip().str.lower()

        out_df = df[df['direction'] == 'outbound']
        G = nx.DiGraph()
        if len(out_df) > 0:
            src = out_df['account_id'].astype(str).to_numpy()
            dst = out_df['counterparty_account'].astype(str).to_numpy()
            amt = pd.to_numeric(out_df['amount'], errors='coerce').fillna(0.0).to_numpy()
            ts = pd.to_datetime(out_df['timestamp'], errors='coerce').to_numpy()
            for s, d, a, t in zip(src, dst, amt, ts):
                if not s or not d:
                    continue
                if G.has_edge(s, d):
                    G[s][d]['weight'] = float(G[s][d].get('weight', 0.0)) + float(a)
                    G[s][d]['timestamp'] = t
                else:
                    G.add_edge(s, d, weight=float(a), timestamp=t)

        try:
            degree_cent = nx.degree_centrality(G) if len(G) else {}
        except Exception:
            degree_cent = {}
        try:
            undirected = G.to_undirected()
            clustering = nx.clustering(undirected) if len(undirected) else {}
        except Exception:
            clustering = {}
        try:
            pagerank = nx.pagerank(G) if len(G) else {}
        except Exception:
            pagerank = {}

        neighbors = {}
        for n in G.nodes():
            neighbors[n] = set(G.successors(n)) | set(G.predecessors(n))

        internal_accounts = set(all_df['account_id'].dropna().astype(str).unique().tolist()) if 'account_id' in all_df.columns else set()

        self._network_ctx = {
            'G': G,
            'degree_cent': degree_cent,
            'clustering': clustering,
            'pagerank': pagerank,
            'neighbors': neighbors,
            'internal_accounts': internal_accounts,
        }
    
    def _engineer_features_for_account(self, account_id: str, account_df: pd.DataFrame,
                                      all_df: pd.DataFrame, account_row: pd.Series | None) -> Dict:
        """Engineer features for a single account"""
        
        features = {'account_id': account_id}
        
        # 1. Customer/KYC Features
        features.update(self._engineer_kyc_features(account_df, account_row))
        
        # 2. Account Behavior Features
        features.update(self._engineer_behavior_features(account_df))
        
        # 3. Transaction Velocity Features
        features.update(self._engineer_velocity_features(account_df))
        
        # 4. Network/Graph Features
        features.update(self._engineer_network_features(account_id, account_df))
        
        # 5. Device & Channel Features
        features.update(self._engineer_device_features(account_id, all_df))
        
        # 6. Circularity Features
        features.update(self._engineer_circularity_features(account_id, all_df))
        
        # 7. Rule-based Aggregates
        features.update(self._calculate_rule_scores(features))
        
        return features
    
    def _engineer_kyc_features(self, account_df: pd.DataFrame, account_row: pd.Series | None) -> Dict:
        """Engineer KYC features"""
        
        last_ts = account_df['timestamp'].max() if len(account_df) else None
        days_since_last_activity = (datetime.now() - last_ts).days if last_ts is not None else None

        account_open_date = None
        customer_type = None
        risk_rating = None
        occupation = None
        expected_turnover = None
        if account_row is not None:
            account_open_date = account_row.get('account_open_date')
            customer_type = account_row.get('customer_type')
            risk_rating = account_row.get('risk_rating')
            occupation = account_row.get('occupation')
            expected_turnover = account_row.get('expected_turnover')

        days_since_account_open = None
        if pd.notna(account_open_date):
            days_since_account_open = (datetime.now() - pd.to_datetime(account_open_date)).days

        return {
            'customer_type': customer_type,
            'risk_rating': risk_rating,
            'occupation': occupation,
            'expected_turnover': expected_turnover,
            'days_since_account_open': days_since_account_open,
            'days_since_last_activity': days_since_last_activity,
            'account_dormancy_flag': 1 if (days_since_last_activity is not None and days_since_last_activity > 90) else 0,
            'recent_account_open_flag': 1 if (days_since_account_open is not None and days_since_account_open <= 30) else 0,
            'profile_change_count_30d': 0
        }
    
    def _engineer_behavior_features(self, account_df: pd.DataFrame) -> Dict:
        """Engineer account behavior features"""
        
        now = datetime.now()
        twenty_four_hours_ago = now - timedelta(hours=24)
        thirty_days_ago = now - timedelta(days=30)
        
        # Filter recent transactions
        recent_24h = account_df[account_df['timestamp'] >= twenty_four_hours_ago]
        recent_30d = account_df[account_df['timestamp'] >= thirty_days_ago]
        
        inbound_24h = recent_24h[recent_24h['direction'] == 'inbound']['amount'].sum()
        outbound_24h = recent_24h[recent_24h['direction'] == 'outbound']['amount'].sum()
        
        inbound_30d = recent_30d[recent_30d['direction'] == 'inbound']['amount'].sum()
        outbound_30d = recent_30d[recent_30d['direction'] == 'outbound']['amount'].sum()
        
        # Unique counterparties
        unique_inbound = recent_30d[recent_30d['direction'] == 'inbound']['counterparty_account'].nunique()
        unique_outbound = recent_30d[recent_30d['direction'] == 'outbound']['counterparty_account'].nunique()
        
        return {
            'inbound_amount_24h': inbound_24h,
            'outbound_amount_24h': outbound_24h,
            'in_out_ratio': self._safe_divide(inbound_24h, outbound_24h, default=float(inbound_24h), cap=1_000_000.0),
            'unique_inbound_counterparties_30d': unique_inbound,
            'unique_outbound_counterparties_30d': unique_outbound,
            'counterparty_concentration_ratio': self._safe_divide(unique_inbound, max(unique_outbound, 1), default=0.0, cap=1_000_000.0),
            'tx_count_24h': len(recent_24h),
            'tx_count_7d': len(account_df[account_df['timestamp'] >= now - timedelta(days=7)]),
            'avg_time_between_in_and_out': self._calculate_avg_time_between_in_out(account_df),
            'avg_tx_amount': account_df['amount'].mean(),
            'tx_amount_stddev': account_df['amount'].std(),
            'pass_through_ratio': self._calculate_pass_through_ratio(account_df),
            'funds_exit_within_1h_flag': self._check_funds_exit_within_time(account_df, hours=1),
            'funds_exit_within_24h_flag': self._check_funds_exit_within_time(account_df, hours=24)
        }
    
    def _engineer_velocity_features(self, account_df: pd.DataFrame) -> Dict:
        """Engineer transaction velocity features"""
        
        # Calculate hourly transactions
        account_df['hour'] = account_df['timestamp'].dt.hour
        hourly_counts = account_df.groupby(account_df['timestamp'].dt.floor('h')).size()
        
        # Calculate daily transactions
        daily_counts = account_df.groupby(account_df['timestamp'].dt.date).size()
        
        return {
            'tx_count_1h': hourly_counts.max() if len(hourly_counts) > 0 else 0,
            'tx_velocity_ratio': self._calculate_velocity_ratio(account_df),
            'night_tx_ratio': len(account_df[(account_df['hour'] >= 22) | (account_df['hour'] <= 6)]) / len(account_df) if len(account_df) > 0 else 0,
            'weekend_tx_ratio': len(account_df[account_df['timestamp'].dt.dayofweek >= 5]) / len(account_df) if len(account_df) > 0 else 0,
            'round_amount_ratio': len(account_df[account_df['amount'] % 100 == 0]) / len(account_df) if len(account_df) > 0 else 0,
            'threshold_avoidance_flag': 1 if any((9500 < amt < 10000) for amt in account_df['amount']) else 0
        }
    
    def _engineer_network_features(self, account_id: str, all_df: pd.DataFrame) -> Dict:
        """Engineer network/graph features"""

        ctx = self._network_ctx or {}
        G = ctx.get('G')
        if G is None or account_id not in G:
            return {
                'degree_centrality': 0,
                'weighted_degree': 0,
                'clustering_coefficient': 0,
                'pagerank': 0,
                'shared_counterparty_count': 0
            }
        
        try:
            degree_cent = (ctx.get('degree_cent') or {}).get(account_id, 0)
            clustering = (ctx.get('clustering') or {}).get(account_id, 0)
            pagerank = (ctx.get('pagerank') or {}).get(account_id, 0)
            
            # Weighted degree (sum of transaction amounts)
            weighted_degree = sum(data['weight'] for _, _, data in G.edges(account_id, data=True))
            
            # Shared counterparties
            neighbors = (ctx.get('neighbors') or {}).get(account_id, set())
            shared_count = 0
            
            for neighbor in neighbors:
                if neighbor != account_id:
                    neighbor_neighbors = (ctx.get('neighbors') or {}).get(neighbor, set())
                    shared_count += len(neighbors.intersection(neighbor_neighbors))

            internal_accounts = ctx.get('internal_accounts') or set()
            internal_ratio = 0
            if len(all_df) > 0 and 'counterparty_account' in all_df.columns:
                internal_ratio = len(all_df[all_df['counterparty_account'].isin(internal_accounts)]) / len(all_df)
            
            return {
                'degree_centrality': degree_cent,
                'weighted_degree': weighted_degree,
                'clustering_coefficient': clustering,
                'pagerank': pagerank,
                'shared_counterparty_count': shared_count,
                'unique_neighbors_30d': len(neighbors),
                'internal_tx_ratio': internal_ratio,
                'funds_propagation_depth_24h': self._calculate_propagation_depth(account_id, G)
            }
            
        except Exception as e:
            return {
                'degree_centrality': 0,
                'weighted_degree': 0,
                'clustering_coefficient': 0,
                'pagerank': 0,
                'shared_counterparty_count': 0,
                'unique_neighbors_30d': 0,
                'internal_tx_ratio': 0,
                'funds_propagation_depth_24h': 0
            }
    
    def _engineer_device_features(self, account_id: str, all_df: pd.DataFrame) -> Dict:
        """Engineer device and channel features"""
        
        account_txs = all_df[all_df['account_id'] == account_id]
        
        if len(account_txs) == 0:
            return {
                'device_id_count_30d': 0,
                'accounts_per_device': 0,
                'shared_device_flag': 0,
                'ip_change_count': 0,
                'vpn_proxy_flag': 0
            }
        
        # Device analysis
        recent_txs = account_txs[account_txs['timestamp'] >= datetime.now() - timedelta(days=30)]
        unique_devices = recent_txs['device_id'].nunique()
        
        # Count accounts per device (for the primary device)
        primary_device = account_txs['device_id'].mode()[0] if len(account_txs['device_id'].mode()) > 0 else None
        
        if primary_device:
            accounts_on_device = all_df[all_df['device_id'] == primary_device]['account_id'].nunique()
            shared_device_flag = 1 if accounts_on_device > 1 else 0
        else:
            accounts_on_device = 0
            shared_device_flag = 0
        
        # IP analysis
        unique_ips = recent_txs['ip_address'].nunique()
        
        # Simple VPN detection (in production, use IP intelligence service)
        vpn_flag = 1 if unique_ips > 3 else 0
        
        return {
            'device_id_count_30d': unique_devices,
            'accounts_per_device': accounts_on_device,
            'shared_device_flag': shared_device_flag,
            'device_change_frequency': unique_devices / max(len(recent_txs), 1),
            'ip_change_count': unique_ips,
            'vpn_proxy_flag': vpn_flag,
            'geo_distance_between_logins': self._calculate_geo_distance(account_txs),
            'login_from_high_risk_geo_flag': self._check_high_risk_geo(account_txs)
        }
    
    def _engineer_circularity_features(self, account_id: str, all_df: pd.DataFrame) -> Dict:
        """Engineer circular transaction features"""
        
        # Simple cycle detection (A→B→A)
        simple_cycle = self._detect_simple_cycle(account_id, all_df)
        
        # Multi-hop cycle detection
        multi_hop_cycle = self._detect_multi_hop_cycle(account_id, all_df)
        
        # Round tripping
        round_tripping = self._detect_round_tripping(account_id, all_df)
        
        return {
            'simple_cycle_flag': 1 if simple_cycle else 0,
            'multi_hop_cycle_flag': 1 if multi_hop_cycle else 0,
            'cycle_length': self._calculate_cycle_length(account_id, all_df),
            'cycle_frequency_30d': self._calculate_cycle_frequency(account_id, all_df),
            'cycle_amount_similarity_ratio': self._calculate_cycle_amount_similarity(account_id, all_df),
            'round_tripping_flag': 1 if round_tripping else 0
        }
    
    def _calculate_rule_scores(self, features: Dict) -> Dict:
        """Calculate rule-based risk scores"""
        
        scores = {
            'velocity_risk_score': self._calculate_velocity_risk(features),
            'recency_risk_score': self._calculate_recency_risk(features),
            'network_risk_score': self._calculate_network_risk(features),
            'circularity_risk_score': self._calculate_circularity_risk(features),
            'device_risk_score': self._calculate_device_risk(features)
        }
        
        return scores
    
    # Helper methods for feature calculations
    def _calculate_avg_time_between_in_out(self, account_df: pd.DataFrame) -> float:
        """Calculate average time between inbound and outbound transactions"""
        inbound_times = account_df[account_df['direction'] == 'inbound']['timestamp']
        outbound_times = account_df[account_df['direction'] == 'outbound']['timestamp']
        
        if len(inbound_times) == 0 or len(outbound_times) == 0:
            return 0
        
        # Find closest outbound after each inbound
        total_seconds = 0
        count = 0
        
        for inbound_time in inbound_times:
            later_outbounds = outbound_times[outbound_times > inbound_time]
            if len(later_outbounds) > 0:
                closest_outbound = later_outbounds.min()
                total_seconds += (closest_outbound - inbound_time).total_seconds()
                count += 1
        
        return total_seconds / count if count > 0 else 0
    
    def _calculate_pass_through_ratio(self, account_df: pd.DataFrame) -> float:
        """Calculate pass-through ratio (funds in and out quickly)"""
        
        if len(account_df) < 2:
            return 0
        
        account_df = account_df.sort_values('timestamp')
        
        pass_through_count = 0
        total_inbound = 0
        
        for i in range(len(account_df) - 1):
            current = account_df.iloc[i]
            next_tx = account_df.iloc[i + 1]
            
            if current['direction'] == 'inbound' and next_tx['direction'] == 'outbound':
                time_diff = (next_tx['timestamp'] - current['timestamp']).total_seconds()
                if time_diff < 3600:  # Within 1 hour
                    pass_through_count += 1
                    total_inbound += current['amount']
        
        total_inbound_all = account_df[account_df['direction'] == 'inbound']['amount'].sum()
        
        return total_inbound / total_inbound_all if total_inbound_all > 0 else 0
    
    def _check_funds_exit_within_time(self, account_df: pd.DataFrame, hours: int) -> int:
        """Check if funds exit within specified hours"""
        
        account_df = account_df.sort_values('timestamp')
        
        for i in range(len(account_df) - 1):
            current = account_df.iloc[i]
            next_tx = account_df.iloc[i + 1]
            
            if current['direction'] == 'inbound' and next_tx['direction'] == 'outbound':
                time_diff = (next_tx['timestamp'] - current['timestamp']).total_seconds()
                if time_diff < hours * 3600:
                    return 1
        
        return 0
    
    def _calculate_velocity_ratio(self, account_df: pd.DataFrame) -> float:
        """Calculate transaction velocity ratio (recent vs baseline)"""
        
        if len(account_df) == 0:
            return 0
        
        now = datetime.now()
        last_24h = now - timedelta(hours=24)
        last_7d = now - timedelta(days=7)
        
        recent_24h = account_df[account_df['timestamp'] >= last_24h]
        baseline = account_df[(account_df['timestamp'] >= last_7d) & (account_df['timestamp'] < last_24h)]
        
        recent_count = len(recent_24h)
        baseline_count = len(baseline) / 6  # Normalize to 24h
        return self._safe_divide(recent_count, baseline_count, default=float(recent_count), cap=1_000_000.0)
    
    def _calculate_internal_tx_ratio(self, account_id: str, all_df: pd.DataFrame) -> float:
        """Calculate ratio of internal transactions"""
        
        account_txs = all_df[all_df['account_id'] == account_id]
        
        if len(account_txs) == 0:
            return 0
        
        # Get all counterparties
        counterparties = set(account_txs['counterparty_account'])
        
        # Check which counterparties are also in our dataset (internal)
        internal_counterparties = counterparties.intersection(set(all_df['account_id']))
        
        internal_txs = account_txs[account_txs['counterparty_account'].isin(internal_counterparties)]
        
        return len(internal_txs) / len(account_txs)
    
    def _calculate_propagation_depth(self, account_id: str, graph: nx.DiGraph) -> int:
        """Calculate funds propagation depth in 24 hours"""
        
        if account_id not in graph:
            return 0
        
        # BFS to find maximum depth
        visited = set()
        queue = [(account_id, 0)]
        max_depth = 0
        
        while queue:
            node, depth = queue.pop(0)
            
            if node not in visited:
                visited.add(node)
                max_depth = max(max_depth, depth)
                
                # Add neighbors (only outbound for fund flow)
                for neighbor in graph.successors(node):
                    if neighbor not in visited:
                        queue.append((neighbor, depth + 1))
        
        return max_depth
    
    def _calculate_geo_distance(self, account_txs: pd.DataFrame) -> float:
        """Calculate geographic distance between logins"""
        # Simplified - in production, use geolocation API
        return np.random.random()
    
    def _check_high_risk_geo(self, account_txs: pd.DataFrame) -> int:
        """Check if logins from high-risk geographies"""
        high_risk_countries = ['RU', 'CN', 'IR', 'KP', 'SY']
        
        if 'geo_location' in account_txs.columns:
            high_risk_logins = account_txs[account_txs['geo_location'].isin(high_risk_countries)]
            return 1 if len(high_risk_logins) > 0 else 0
        
        return 0
    
    def _detect_simple_cycle(self, account_id: str, all_df: pd.DataFrame) -> bool:
        """Detect simple A→B→A cycles"""
        
        # Get outbound transactions
        outbound = all_df[
            (all_df['account_id'] == account_id) & 
            (all_df['direction'] == 'outbound')
        ]
        
        for _, tx in outbound.iterrows():
            counterparty = tx['counterparty_account']
            
            # Check if counterparty sent money back
            return_tx = all_df[
                (all_df['account_id'] == counterparty) &
                (all_df['direction'] == 'outbound') &
                (all_df['counterparty_account'] == account_id)
            ]
            
            if len(return_tx) > 0:
                return True
        
        return False
    
    def _detect_multi_hop_cycle(self, account_id: str, all_df: pd.DataFrame) -> bool:
        """Detect multi-hop cycles (A→B→C→A)"""
        # Implement cycle detection algorithm
        return False
    
    def _detect_round_tripping(self, account_id: str, all_df: pd.DataFrame) -> bool:
        """Detect round tripping through multiple accounts"""
        # Implement round tripping detection
        return False
    
    def _calculate_cycle_length(self, account_id: str, all_df: pd.DataFrame) -> int:
        """Calculate average cycle length"""
        return 0
    
    def _calculate_cycle_frequency(self, account_id: str, all_df: pd.DataFrame) -> float:
        """Calculate cycle frequency"""
        return 0.0
    
    def _calculate_cycle_amount_similarity(self, account_id: str, all_df: pd.DataFrame) -> float:
        """Calculate similarity of amounts in cycles"""
        return 0.0
    
    # Risk calculation methods
    def _calculate_velocity_risk(self, features: Dict) -> float:
        """Calculate velocity-based risk score"""
        risk = 0
        
        if features.get('tx_count_24h', 0) > 10:
            risk += 0.3
        if features.get('tx_velocity_ratio', 0) > 5:
            risk += 0.4
        if features.get('funds_exit_within_1h_flag', 0) == 1:
            risk += 0.3
        
        return min(risk, 1.0)
    
    def _calculate_recency_risk(self, features: Dict) -> float:
        """Calculate recency-based risk score"""
        risk = 0
        
        if features.get('recent_account_open_flag', 0) == 1:
            risk += 0.4
        if features.get('account_dormancy_flag', 0) == 1:
            risk += 0.3
        if features.get('days_since_account_open', 365) < 30:
            risk += 0.3
        
        return min(risk, 1.0)
    
    def _calculate_network_risk(self, features: Dict) -> float:
        """Calculate network-based risk score"""
        risk = 0
        
        if features.get('degree_centrality', 0) > 0.5:
            risk += 0.4
        if features.get('shared_counterparty_count', 0) > 3:
            risk += 0.3
        if features.get('clustering_coefficient', 0) > 0.7:
            risk += 0.3
        
        return min(risk, 1.0)
    
    def _calculate_circularity_risk(self, features: Dict) -> float:
        """Calculate circularity-based risk score"""
        risk = 0
        
        if features.get('simple_cycle_flag', 0) == 1:
            risk += 0.5
        if features.get('multi_hop_cycle_flag', 0) == 1:
            risk += 0.3
        if features.get('round_tripping_flag', 0) == 1:
            risk += 0.2
        
        return min(risk, 1.0)
    
    def _calculate_device_risk(self, features: Dict) -> float:
        """Calculate device-based risk score"""
        risk = 0
        
        if features.get('shared_device_flag', 0) == 1:
            risk += 0.4
        if features.get('accounts_per_device', 0) > 3:
            risk += 0.3
        if features.get('vpn_proxy_flag', 0) == 1:
            risk += 0.3
        
        return min(risk, 1.0)
    
    def _add_derived_features(self, features_df: pd.DataFrame) -> pd.DataFrame:
        """Add derived/aggregated features"""
        
        # Normalize features
        numeric_cols = features_df.select_dtypes(include=[np.number]).columns
        
        for col in numeric_cols:
            if features_df[col].std() > 0:
                features_df[f'{col}_norm'] = (features_df[col] - features_df[col].mean()) / features_df[col].std()
        
        # Create interaction features
        if 'tx_count_24h' in features_df.columns and 'avg_tx_amount' in features_df.columns:
            features_df['tx_volume_24h'] = features_df['tx_count_24h'] * features_df['avg_tx_amount']
        
        if 'in_out_ratio' in features_df.columns and 'degree_centrality' in features_df.columns:
            features_df['network_flow_ratio'] = features_df['in_out_ratio'] * features_df['degree_centrality']
        
        return features_df
    
    def get_feature_categories(self) -> Dict[str, List[str]]:
        """Get features organized by category"""
        
        categories = {
            'kyc': ['days_since_account_open', 'days_since_last_activity', 
                   'recent_account_open_flag', 'profile_change_count_30d'],
            'behavior': ['tx_count_24h', 'in_out_ratio', 'avg_tx_amount',
                        'unique_inbound_counterparties_30d', 'pass_through_ratio'],
            'velocity': ['tx_count_1h', 'tx_velocity_ratio', 'night_tx_ratio',
                        'funds_exit_within_1h_flag'],
            'network': ['degree_centrality', 'clustering_coefficient', 'pagerank',
                       'shared_counterparty_count'],
            'device': ['accounts_per_device', 'shared_device_flag', 'vpn_proxy_flag'],
            'circularity': ['simple_cycle_flag', 'multi_hop_cycle_flag', 'round_tripping_flag'],
            'risk_scores': ['velocity_risk_score', 'recency_risk_score', 
                          'network_risk_score', 'circularity_risk_score', 'device_risk_score']
        }
        
        return categories
