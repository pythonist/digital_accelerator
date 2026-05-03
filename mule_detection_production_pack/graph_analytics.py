import numpy as np
import pandas as pd
import networkx as nx
from utils import print_step

FAST_MODE = True  # Toggle False to revert to original row-iteration mode

class GraphAnalytics:
    def model1_graph_analytics(self, df):
        print_step("STEP 8: MODEL1 GRAPH ANALYTICS")
        if FAST_MODE:
            return self._model1_fast(df)
        return self._model1_full(df)

    def _model1_fast(self, df):
        sample = df.sample(min(50_000, len(df)), random_state=42) if len(df) > 50_000 else df
        ip_col = "device_ip_address" if "device_ip_address" in sample.columns else "ip_address"

        UG = nx.Graph()

        def nk(prefix, series):
            return prefix + "::" + series.astype(str)

        def add_edges(u_series, v_series, weight_series):
            frame = pd.DataFrame({"u": u_series.values, "v": v_series.values, "w": weight_series.values})
            frame = frame.dropna()
            for row in frame.itertuples(index=False):
                if UG.has_edge(row.u, row.v):
                    UG[row.u][row.v]["weight"] += float(row.w)
                else:
                    UG.add_edge(row.u, row.v, weight=float(row.w))

        w = sample["amount"].fillna(0).astype(float)
        cust = nk("cust", sample["customer_id"])
        acct = nk("acct", sample["account_id"])
        add_edges(cust, acct, w)
        if "device_id" in sample.columns:
            add_edges(cust, nk("dev", sample["device_id"]), w)
        if ip_col in sample.columns:
            add_edges(cust, nk("ip", sample[ip_col]), w)
        if "counterparty_id" in sample.columns:
            add_edges(acct, nk("cp", sample["counterparty_id"]), w)
        if "merchant_id" in sample.columns:
            add_edges(cust, nk("mch", sample["merchant_id"]), w)

        pagerank    = nx.pagerank(UG, weight="weight") if UG.number_of_nodes() > 0 else {}
        clustering  = nx.clustering(UG)               if UG.number_of_nodes() > 0 else {}
        degree_cent = nx.degree_centrality(UG)        if UG.number_of_nodes() > 0 else {}
        communities = list(nx.community.greedy_modularity_communities(UG)) if UG.number_of_nodes() > 0 else []
        community_map = {n: i for i, comm in enumerate(communities) for n in comm}

        sub_nodes = list(UG.nodes())[:5_000]
        sub_set = set(sub_nodes)
        DG = nx.DiGraph()
        for u, v in UG.edges():
            if u in sub_set and v in sub_set:
                DG.add_edge(u, v)
        cycles = list(nx.simple_cycles(DG))
        cycle_nodes = set(n for cyc in cycles[:500] for n in cyc)

        gf = pd.DataFrame({
            "node_id":                list(UG.nodes()),
            "graph_pagerank":         [pagerank.get(n, 0)      for n in UG.nodes()],
            "graph_clustering":       [clustering.get(n, 0)    for n in UG.nodes()],
            "graph_degree_centrality":[degree_cent.get(n, 0)   for n in UG.nodes()],
            "graph_community_id":     [community_map.get(n,-1) for n in UG.nodes()],
            "graph_cycle_flag":       [int(n in cycle_nodes)   for n in UG.nodes()],
        })

        out = df.copy()
        gf_idx = gf.set_index("node_id")
        for prefix, raw_col in [("cust","customer_id"),("acct","account_id"),("dev","device_id"),
                                 ("ip", ip_col),("cp","counterparty_id"),("mch","merchant_id")]:
            if raw_col in out.columns:
                node_col = f"{prefix}_node"
                out[node_col] = prefix + "::" + out[raw_col].astype(str)
                tmp = gf_idx.reindex(out[node_col]).reset_index(drop=True).add_prefix(f"{prefix}_")
                out = pd.concat([out.reset_index(drop=True), tmp.reset_index(drop=True)], axis=1)
        return out, gf

    def _model1_full(self, df):
        G = nx.MultiDiGraph()
        def nk(prefix, x):
            if pd.isna(x): return None
            return f"{prefix}::{x}"
        for _, r in df.iterrows():
            cust  = nk("cust",  r.get("customer_id"))
            acct  = nk("acct",  r.get("account_id"))
            dev   = nk("dev",   r.get("device_id"))
            ip    = nk("ip",    r.get("device_ip_address", r.get("ip_address")))
            cp    = nk("cp",    r.get("counterparty_id"))
            mch   = nk("mch",   r.get("merchant_id"))
            phone = nk("phone", r.get("customer_phone_number"))
            email = nk("email", r.get("customer_email"))
            addr  = nk("addr",  r.get("customer_address_line1"))
            for n, typ in [(cust,"customer"),(acct,"account"),(dev,"device"),(ip,"ip"),(cp,"counterparty"),
                           (mch,"merchant"),(phone,"phone"),(email,"email"),(addr,"address")]:
                if n: G.add_node(n, ntype=typ)
            for u, v, et in [(cust,acct,"owns"),(cust,dev,"uses_device"),(cust,ip,"uses_ip"),
                             (cust,phone,"uses_phone"),(cust,email,"uses_email"),(cust,addr,"lives_at"),
                             (acct,cp,"transfers_to"),(cust,mch,"merchant_interaction"),(dev,ip,"connects_from")]:
                if u and v:
                    G.add_edge(u, v, edge_type=et, weight=float(r["amount"]) if pd.notna(r.get("amount")) else 0.0)
        UG = nx.Graph()
        for u, v, d in G.edges(data=True):
            w = d.get("weight", 1.0)
            if UG.has_edge(u, v): UG[u][v]["weight"] += w
            else: UG.add_edge(u, v, weight=w)
        pagerank    = nx.pagerank(UG, weight="weight") if UG.number_of_nodes() > 0 else {}
        clustering  = nx.clustering(UG)               if UG.number_of_nodes() > 0 else {}
        degree_cent = nx.degree_centrality(UG)        if UG.number_of_nodes() > 0 else {}
        communities = list(nx.community.greedy_modularity_communities(UG)) if UG.number_of_nodes() > 0 else []
        community_map = {n: i for i, comm in enumerate(communities) for n in comm}
        DG_simple = nx.DiGraph()
        for u, v, _ in G.edges(data=True):
            if not DG_simple.has_edge(u, v): DG_simple.add_edge(u, v)
        cycles = list(nx.simple_cycles(DG_simple))
        cycle_nodes = set(n for cyc in cycles[:500] for n in cyc)
        gf = pd.DataFrame({
            "node_id":                list(UG.nodes()),
            "graph_pagerank":         [pagerank.get(n, 0)      for n in UG.nodes()],
            "graph_clustering":       [clustering.get(n, 0)    for n in UG.nodes()],
            "graph_degree_centrality":[degree_cent.get(n, 0)   for n in UG.nodes()],
            "graph_community_id":     [community_map.get(n,-1) for n in UG.nodes()],
            "graph_cycle_flag":       [int(n in cycle_nodes)   for n in UG.nodes()],
        })
        out = df.copy()
        gf_idx = gf.set_index("node_id")
        ip_col = "device_ip_address" if "device_ip_address" in out.columns else "ip_address"
        for prefix, raw_col in [("cust","customer_id"),("acct","account_id"),("dev","device_id"),
                                 ("ip", ip_col),("cp","counterparty_id"),("mch","merchant_id")]:
            if raw_col in out.columns:
                node_col = f"{prefix}_node"
                out[node_col] = prefix + "::" + out[raw_col].astype(str)
                tmp = gf_idx.reindex(out[node_col]).reset_index(drop=True).add_prefix(f"{prefix}_")
                out = pd.concat([out.reset_index(drop=True), tmp.reset_index(drop=True)], axis=1)
        return out, gf

    def model2_ring_detection(self, df):
        print_step("STEP 9: MODEL2 RING DETECTION")
        flow_df = df.copy()
        flow_df["src_node"] = np.where(
            flow_df["transaction_type"].astype(str).str.contains("IN", case=False, na=False),
            flow_df["counterparty_id"].astype(str), flow_df["account_id"].astype(str))
        flow_df["dst_node"] = np.where(
            flow_df["transaction_type"].astype(str).str.contains("OUT", case=False, na=False),
            flow_df["counterparty_id"].astype(str), flow_df["account_id"].astype(str))
        sample = flow_df.sample(min(20_000, len(flow_df)), random_state=42) if len(flow_df) > 20_000 else flow_df
        FG = nx.DiGraph()
        for _, row in sample.iterrows():
            u, v = f"node::{row['src_node']}", f"node::{row['dst_node']}"
            amt = float(row["amount"]) if pd.notna(row["amount"]) else 0.0
            if FG.has_edge(u, v):
                FG[u][v]["weight"] += amt
                FG[u][v]["count"]  += 1
            else:
                FG.add_edge(u, v, weight=amt, count=1)
        cycles = list(nx.simple_cycles(FG))
        ring_rows = []
        for i, cyc in enumerate(cycles[:1000]):
            cyc2    = cyc + [cyc[0]]
            amounts = [FG[cyc2[j]][cyc2[j+1]]["weight"] for j in range(len(cyc2)-1) if FG.has_edge(cyc2[j], cyc2[j+1])]
            ring_rows.append({
                "ring_id":             f"RING_{i:05d}",
                "ring_path_signature": "->".join(cyc),
                "ring_member_count":   len(cyc),
                "ring_total_amount":   float(np.sum(amounts))  if amounts else 0.0,
                "ring_avg_amount":     float(np.mean(amounts)) if amounts else 0.0,
                "ring_risk_score":     len(cyc) * (float(np.mean(amounts)) if amounts else 0.0),
            })
        ring_df = pd.DataFrame(ring_rows)
        node_ring_map = {}
        for _, row in ring_df.iterrows():
            for n in row["ring_path_signature"].split("->"):
                node_ring_map.setdefault(n, []).append({
                    "ring_id":            row["ring_id"],
                    "ring_member_count":  row["ring_member_count"],
                    "ring_risk_score":    row["ring_risk_score"],
                })
        def extract_ring_metrics(account_id):
            nk_str = f"node::{account_id}"
            vals   = node_ring_map.get(nk_str, [])
            if not vals:
                return pd.Series({"ring_count": 0, "ring_max_risk_score": 0, "ring_max_member_count": 0})
            return pd.Series({
                "ring_count":            len(vals),
                "ring_max_risk_score":   max(v["ring_risk_score"]   for v in vals),
                "ring_max_member_count": max(v["ring_member_count"] for v in vals),
            })
        ring_metrics = df["account_id"].astype(str).apply(extract_ring_metrics)
        out = pd.concat([df.reset_index(drop=True), ring_metrics.reset_index(drop=True)], axis=1)
        return out, ring_df