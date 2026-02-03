import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity

class ComparisonEngine:
    def __init__(self, db_manager):
        self.db_manager = db_manager

    def compare_cases(self, pack1, pack2):
        """
        Calculates forensic differences between two case packs.
        Returns deltas, similarity scores, and common entities.
        """
        # 1. Financial Deltas (Volume Difference %)
        # Safe access using .get with nested dicts
        fp1 = pack1.get('financial_profile') or {}
        fp2 = pack2.get('financial_profile') or {}

        vol1 = fp1.get('total_volume', 0)
        vol2 = fp2.get('total_volume', 0)
        
        # Calculate % Diff: (V1 - V2) / V2
        if vol2 > 0:
            vol_diff = round(((vol1 - vol2) / vol2) * 100, 1)
        elif vol1 > 0:
            vol_diff = 100 # Infinite growth if V2 is 0 but V1 has data
        else:
            vol_diff = 0

        # 2. Common Entity Search (Network Overlap)
        # We look at "Top Hubs" from the network graph
        ng1 = pack1.get('network_graph') or {}
        ng2 = pack2.get('network_graph') or {}
        
        # Extract lists of names
        hubs1 = {h.get('name') for h in ng1.get('top_hubs', []) if h.get('name')}
        hubs2 = {h.get('name') for h in ng2.get('top_hubs', []) if h.get('name')}
        
        # Find intersection
        common_entities = list(hubs1.intersection(hubs2))

        # 3. Cosine Similarity (Behavioral Match)
        # Create a vector [Volume, AlertCount, MaxTxn, RiskScore]
        def get_vector(p):
            f = p.get('financial_profile') or {}
            return [
                f.get('total_volume', 0),
                len(p.get('alerts', [])),
                f.get('max_transaction', 0),
                p.get('risk_score', 0)
            ]

        v1 = get_vector(pack1)
        v2 = get_vector(pack2)
        
        similarity = 0
        try:
            # Normalize vectors to prevent magnitude bias (simple normalization)
            # In a real ML system, you'd scale this properly
            if sum(v1) > 0 and sum(v2) > 0:
                vec1 = np.array(v1).reshape(1, -1)
                vec2 = np.array(v2).reshape(1, -1)
                similarity = cosine_similarity(vec1, vec2)[0][0] * 100
        except:
            pass

        return {
            "similarity_score": round(similarity, 1),
            "deltas": {
                "volume": vol_diff
            },
            "common_entities": common_entities,
            "risk_divergence": int(pack1.get('risk_score', 0) - pack2.get('risk_score', 0))
        }