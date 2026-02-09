import pandas as pd
import numpy as np
import networkx as nx
from datetime import datetime, timedelta
from typing import Dict, List, Any, Tuple, Set
try:
    import community as community_louvain
except Exception:
    community_louvain = None
from collections import defaultdict, Counter

class NetworkAnalyzer:
    def __init__(self):
        self.transaction_graph = nx.DiGraph()
        self.account_communities = {}
        self.centrality_metrics = {}
        
    def analyze_transaction_network(self, transactions_df: pd.DataFrame) -> Dict[str, Dict]:
        """Analyze transaction network and extract features"""
        # Build graph
        self._build_transaction_graph(transactions_df)
        self._compute_global_metrics()
        
        # Analyze network
        network_metrics = {}
        
        for account_id in self.transaction_graph.nodes():
            metrics = self._calculate_account_metrics(account_id)
            network_metrics[account_id] = metrics
        
        return network_metrics

    def _compute_global_metrics(self) -> None:
        G = self.transaction_graph
        if G is None or len(G) == 0:
            self.centrality_metrics = {}
            return

        try:
            degree_cent = nx.degree_centrality(G)
        except Exception:
            degree_cent = {}

        try:
            k = min(100, max(1, len(G) - 1))
            betweenness = nx.betweenness_centrality(G, k=k, seed=42)
        except Exception:
            betweenness = {}

        try:
            closeness = nx.closeness_centrality(G)
        except Exception:
            closeness = {}

        try:
            pagerank = nx.pagerank(G, alpha=0.85)
        except Exception:
            pagerank = {}

        try:
            clustering = nx.clustering(G.to_undirected())
        except Exception:
            clustering = {}

        out_degrees = [d for _n, d in G.out_degree()]
        bet_vals = list(betweenness.values()) if betweenness else [0.0]
        out_p90 = float(np.percentile(out_degrees, 90)) if out_degrees else 0.0
        bet_p90 = float(np.percentile(bet_vals, 90)) if bet_vals else 0.0

        self.centrality_metrics = {
            "degree_centrality": degree_cent,
            "betweenness_centrality": betweenness,
            "closeness_centrality": closeness,
            "pagerank": pagerank,
            "clustering": clustering,
            "out_degree_p90": out_p90,
            "betweenness_p90": bet_p90,
        }
    
    def _build_transaction_graph(self, transactions_df: pd.DataFrame):
        """Build directed transaction graph"""
        
        self.transaction_graph = nx.DiGraph()
        
        # Add nodes and edges
        for _, tx in transactions_df.iterrows():
            if tx['direction'] == 'outbound':
                # Add nodes
                self.transaction_graph.add_node(tx['account_id'], type='account')
                self.transaction_graph.add_node(tx['counterparty_account'], type='counterparty')
                
                # Add edge with transaction attributes
                self.transaction_graph.add_edge(
                    tx['account_id'],
                    tx['counterparty_account'],
                    amount=tx['amount'],
                    timestamp=tx['timestamp'],
                    transaction_id=tx.get('transaction_id', ''),
                    direction='outbound'
                )
        
        return
    
    def _calculate_account_metrics(self, account_id: str) -> Dict:
        """Calculate network metrics for an account"""
        
        if account_id not in self.transaction_graph:
            return self._get_default_metrics()
        
        try:
            # Basic metrics
            out_degree = self.transaction_graph.out_degree(account_id)
            in_degree = self.transaction_graph.in_degree(account_id)
            total_degree = out_degree + in_degree
            
            # Weighted degree (transaction amount sum)
            out_amount = sum(self.transaction_graph[account_id][succ].get('amount', 0) 
                           for succ in self.transaction_graph.successors(account_id))
            in_amount = sum(self.transaction_graph[pred][account_id].get('amount', 0) 
                          for pred in self.transaction_graph.predecessors(account_id))
            
            # Centrality measures
            cm = self.centrality_metrics or {}
            degree_cent = float((cm.get("degree_centrality") or {}).get(account_id, 0) or 0)
            betweenness = float((cm.get("betweenness_centrality") or {}).get(account_id, 0) or 0)
            closeness = float((cm.get("closeness_centrality") or {}).get(account_id, 0) or 0)
            pagerank = float((cm.get("pagerank") or {}).get(account_id, 0) or 0)
            clustering = float((cm.get("clustering") or {}).get(account_id, 0) or 0)
            
            # Community detection (Louvain)
            community_id = self._get_community(account_id)
            
            # Transaction patterns
            patterns = self._analyze_transaction_patterns(account_id)
            
            # Risk score based on network metrics
            risk_score = self._calculate_network_risk_score({
                'degree_centrality': degree_cent,
                'betweenness': betweenness,
                'clustering': clustering,
                'community_size': self._get_community_size(community_id),
                'transaction_patterns': patterns
            })
            
            return {
                'degree_centrality': float(degree_cent),
                'betweenness_centrality': float(betweenness),
                'closeness_centrality': float(closeness),
                'pagerank': float(pagerank),
                'clustering_coefficient': float(clustering),
                'out_degree': int(out_degree),
                'in_degree': int(in_degree),
                'total_degree': int(total_degree),
                'out_amount': float(out_amount),
                'in_amount': float(in_amount),
                'community_id': int(community_id) if community_id is not None else -1,
                'transaction_patterns': patterns,
                'network_risk_score': float(risk_score),
                'is_hub': out_degree > float((cm.get("out_degree_p90") or 0.0)),
                'is_bridge': betweenness > float((cm.get("betweenness_p90") or 0.0))
            }
            
        except Exception as e:
            print(f"Error calculating metrics for {account_id}: {e}")
            return self._get_default_metrics()
    
    def _get_default_metrics(self):
        """Return default metrics for accounts not in graph"""
        return {
            'degree_centrality': 0,
            'betweenness_centrality': 0,
            'closeness_centrality': 0,
            'pagerank': 0,
            'clustering_coefficient': 0,
            'out_degree': 0,
            'in_degree': 0,
            'total_degree': 0,
            'out_amount': 0,
            'in_amount': 0,
            'community_id': -1,
            'transaction_patterns': {},
            'network_risk_score': 0,
            'is_hub': False,
            'is_bridge': False
        }
    
    def _get_community(self, account_id: str) -> int:
        """Detect community using Louvain algorithm"""
        
        if community_louvain is None or not hasattr(community_louvain, "best_partition"):
            return None

        if not self.account_communities:
            # Convert to undirected for community detection
            undirected_graph = self.transaction_graph.to_undirected()
            
            # Use largest connected component for community detection
            if nx.number_connected_components(undirected_graph) > 1:
                largest_cc = max(nx.connected_components(undirected_graph), key=len)
                subgraph = undirected_graph.subgraph(largest_cc)
            else:
                subgraph = undirected_graph
            
            # Detect communities
            if len(subgraph) > 0:
                partition = community_louvain.best_partition(subgraph)
                self.account_communities = partition
            else:
                self.account_communities = {}
        
        return self.account_communities.get(account_id)
    
    def _get_community_size(self, community_id: int) -> int:
        """Get size of a community"""
        
        if community_id is None:
            return 0
        
        community_counts = Counter(self.account_communities.values())
        return community_counts.get(community_id, 0)
    
    def _analyze_transaction_patterns(self, account_id: str) -> Dict:
        """Analyze transaction patterns for an account"""
        
        patterns = {
            'fan_in': 0,      # Many incoming from few sources
            'fan_out': 0,     # Many outgoing to few destinations
            'mixer': 0,       # Both fan_in and fan_out
            'isolated': 0,    # Few connections
            'hub': 0          # Connected to many others
        }
        
        if account_id not in self.transaction_graph:
            patterns['isolated'] = 1
            return patterns
        
        out_neighbors = list(self.transaction_graph.successors(account_id))
        in_neighbors = list(self.transaction_graph.predecessors(account_id))
        
        total_neighbors = len(set(out_neighbors + in_neighbors))
        
        # Pattern detection
        if len(in_neighbors) > 5 and len(out_neighbors) < 3:
            patterns['fan_in'] = 1
        
        if len(out_neighbors) > 5 and len(in_neighbors) < 3:
            patterns['fan_out'] = 1
        
        if len(in_neighbors) > 3 and len(out_neighbors) > 3:
            patterns['mixer'] = 1
        
        if total_neighbors > 10:
            patterns['hub'] = 1
        
        if total_neighbors <= 2:
            patterns['isolated'] = 1
        
        return patterns
    
    def _calculate_network_risk_score(self, metrics: Dict) -> float:
        """Calculate risk score based on network metrics"""
        
        risk_score = 0
        
        # High degree centrality is suspicious
        if metrics['degree_centrality'] > 0.3:
            risk_score += 0.3
        
        # High betweenness (bridge nodes) are risky
        if metrics['betweenness'] > 0.2:
            risk_score += 0.2
        
        # Low clustering (unusual in social networks)
        if metrics['clustering'] < 0.1 and metrics['degree_centrality'] > 0.1:
            risk_score += 0.2
        
        # Large community size (organized groups)
        if metrics['community_size'] > 10:
            risk_score += 0.2
        
        # Mixer pattern (money mixing)
        if metrics['transaction_patterns'].get('mixer', 0) == 1:
            risk_score += 0.1
        
        return min(risk_score, 1.0)
    
    def detect_mule_clusters(self, min_cluster_size: int = 3) -> List[Dict]:
        """Detect clusters of potential money mule accounts"""
        
        clusters = []
        
        if not self.account_communities:
            return clusters
        
        # Group accounts by community
        community_groups = defaultdict(list)
        for account, community in self.account_communities.items():
            community_groups[community].append(account)
        
        # Analyze each community
        for community_id, accounts in community_groups.items():
            if len(accounts) < min_cluster_size:
                continue
            
            # Calculate cluster metrics
            cluster_metrics = self._analyze_cluster(accounts)
            
            # Check if cluster shows mule-like patterns
            if self._is_suspicious_cluster(cluster_metrics):
                clusters.append({
                    'cluster_id': community_id,
                    'accounts': accounts,
                    'size': len(accounts),
                    'metrics': cluster_metrics,
                    'risk_score': cluster_metrics.get('cluster_risk_score', 0),
                    'suspicion_reason': cluster_metrics.get('suspicion_reasons', [])
                })
        
        # Sort by risk score
        clusters.sort(key=lambda x: x['risk_score'], reverse=True)
        
        return clusters
    
    def _analyze_cluster(self, accounts: List[str]) -> Dict:
        """Analyze a cluster of accounts"""
        
        subgraph = self.transaction_graph.subgraph(accounts)
        
        if len(subgraph) == 0:
            return {}
        
        metrics = {
            'internal_edges': subgraph.number_of_edges(),
            'external_edges': 0,
            'density': nx.density(subgraph),
            'avg_clustering': nx.average_clustering(subgraph.to_undirected()),
            'assortativity': nx.degree_assortativity_coefficient(subgraph.to_undirected()) 
                           if len(subgraph) > 1 else 0
        }
        
        # Count external connections
        for account in accounts:
            for neighbor in self.transaction_graph.successors(account):
                if neighbor not in accounts:
                    metrics['external_edges'] += 1
        
        # Calculate cluster risk score
        risk_score = 0
        
        # High internal connectivity with low external connectivity (closed group)
        if metrics['internal_edges'] > len(accounts) * 2 and metrics['external_edges'] < len(accounts):
            risk_score += 0.4
        
        # High density (tightly connected)
        if metrics['density'] > 0.3:
            risk_score += 0.3
        
        # Negative assortativity (hubs connect to non-hubs)
        if metrics['assortativity'] < -0.2:
            risk_score += 0.3
        
        metrics['cluster_risk_score'] = min(risk_score, 1.0)
        
        # Suspicion reasons
        suspicion_reasons = []
        if risk_score > 0.6:
            suspicion_reasons.append("Highly interconnected closed group")
        if metrics['density'] > 0.5:
            suspicion_reasons.append("Extremely dense transaction network")
        if metrics['assortativity'] < -0.3:
            suspicion_reasons.append("Hub-and-spoke pattern detected")
        
        metrics['suspicion_reasons'] = suspicion_reasons
        
        return metrics
    
    def _is_suspicious_cluster(self, cluster_metrics: Dict) -> bool:
        """Check if cluster shows suspicious patterns"""
        
        if not cluster_metrics:
            return False
        
        risk_score = cluster_metrics.get('cluster_risk_score', 0)
        suspicion_reasons = cluster_metrics.get('suspicion_reasons', [])
        
        return risk_score > 0.5 or len(suspicion_reasons) > 1
    
    def get_visualization_data(self, max_nodes: int = 100) -> Dict:
        """Prepare data for network visualization"""
        
        if len(self.transaction_graph) == 0:
            return {'nodes': [], 'edges': [], 'clusters': []}
        
        # Sample graph if too large
        if len(self.transaction_graph) > max_nodes:
            # Get most connected nodes
            degrees = dict(self.transaction_graph.degree())
            top_nodes = sorted(degrees.items(), key=lambda x: x[1], reverse=True)[:max_nodes]
            node_list = [node for node, _ in top_nodes]
            
            # Create subgraph
            visualization_graph = self.transaction_graph.subgraph(node_list)
        else:
            visualization_graph = self.transaction_graph
        
        # Prepare nodes
        nodes = []
        for node in visualization_graph.nodes():
            node_data = {
                'id': node,
                'label': node[:8] + '...' if len(node) > 8 else node,
                'size': visualization_graph.degree(node) + 5,
                'community': self.account_communities.get(node, 0),
                'type': visualization_graph.nodes[node].get('type', 'account')
            }
            nodes.append(node_data)
        
        # Prepare edges
        edges = []
        for source, target, data in visualization_graph.edges(data=True):
            edge_data = {
                'source': source,
                'target': target,
                'amount': data.get('amount', 0),
                'width': min(data.get('amount', 0) / 1000, 10)  # Scale for visualization
            }
            edges.append(edge_data)
        
        # Get clusters
        clusters = self.detect_mule_clusters(min_cluster_size=2)
        
        return {
            'nodes': nodes,
            'edges': edges,
            'clusters': clusters[:5],  # Top 5 clusters
            'total_nodes': len(nodes),
            'total_edges': len(edges)
        }
    
    def export_network_report(self, output_path: str = 'network_analysis_report.json'):
        """Export comprehensive network analysis report"""
        
        report = {
            'timestamp': datetime.now().isoformat(),
            'graph_metrics': {
                'total_nodes': self.transaction_graph.number_of_nodes(),
                'total_edges': self.transaction_graph.number_of_edges(),
                'density': nx.density(self.transaction_graph),
                'avg_clustering': nx.average_clustering(self.transaction_graph.to_undirected()),
                'is_directed': nx.is_directed(self.transaction_graph),
                'is_connected': nx.is_weakly_connected(self.transaction_graph)
            },
            'detected_clusters': self.detect_mule_clusters(),
            'high_risk_accounts': self._get_high_risk_accounts(),
            'central_hubs': self._get_central_hubs(),
            'key_bridges': self._get_key_bridges()
        }
        
        import json
        with open(output_path, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        
        print(f"Network report exported to {output_path}")
        return report
    
    def _get_high_risk_accounts(self, top_n: int = 20) -> List[Dict]:
        """Get accounts with highest network risk scores"""
        
        high_risk = []
        
        for account_id in self.transaction_graph.nodes():
            metrics = self._calculate_account_metrics(account_id)
            risk_score = metrics.get('network_risk_score', 0)
            
            if risk_score > 0.5:
                high_risk.append({
                    'account_id': account_id,
                    'risk_score': risk_score,
                    'degree_centrality': metrics.get('degree_centrality', 0),
                    'betweenness': metrics.get('betweenness_centrality', 0),
                    'community_id': metrics.get('community_id', -1)
                })
        
        # Sort by risk score
        high_risk.sort(key=lambda x: x['risk_score'], reverse=True)
        
        return high_risk[:top_n]
    
    def _get_central_hubs(self, top_n: int = 10) -> List[Dict]:
        """Get most central hubs in the network"""
        
        if len(self.transaction_graph) == 0:
            return []
        
        # Calculate degree centrality
        degree_cent = nx.degree_centrality(self.transaction_graph)
        
        # Get top hubs
        hubs = sorted(degree_cent.items(), key=lambda x: x[1], reverse=True)[:top_n]
        
        return [{'account_id': hub, 'centrality': cent} for hub, cent in hubs]
    
    def _get_key_bridges(self, top_n: int = 10) -> List[Dict]:
        """Get key bridge accounts (high betweenness)"""
        
        if len(self.transaction_graph) < 3:
            return []
        
        # Calculate betweenness centrality
        betweenness = nx.betweenness_centrality(self.transaction_graph, k=min(100, len(self.transaction_graph)))
        
        # Get top bridges
        bridges = sorted(betweenness.items(), key=lambda x: x[1], reverse=True)[:top_n]
        
        return [{'account_id': bridge, 'betweenness': bet} for bridge, bet in bridges]
