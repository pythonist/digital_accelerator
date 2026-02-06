import pandas as pd
import numpy as np
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


def _pick_col(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    for c in candidates:
        if c in df.columns:
            return c
    return None


def _to_float(v) -> Optional[float]:
    try:
        x = float(v)
        if np.isnan(x):
            return None
        return x
    except Exception:
        return None


def _risk_bucket(score: float) -> str:
    if score >= 0.7:
        return "HIGH"
    if score >= 0.4:
        return "MEDIUM"
    return "LOW"


@dataclass
class MoneyFlowConfig:
    window_hours: float = 48.0
    max_hops: int = 4
    amount_tolerance: float = 0.12
    max_edges: int = 350
    max_paths: int = 25
    pass_through_window_hours: float = 1.0


class MoneyFlowAnalyzer:
    def __init__(self, config: Optional[MoneyFlowConfig] = None):
        self.config = config or MoneyFlowConfig()

    def build_directed_edges(self, df: pd.DataFrame) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
        counterparty_col = _pick_col(
            df,
            ["counterparty_account", "counterparty", "to_account", "to_acct", "receiver_account", "beneficiary_account"],
        )
        ts_col = _pick_col(df, ["txn_timestamp", "timestamp", "txn_time", "transaction_time", "transaction_datetime", "created_at"])
        txn_id_col = _pick_col(df, ["txn_id", "transaction_id", "id"])
        direction_col = "direction" if "direction" in df.columns else None

        colmap = {
            "counterparty": counterparty_col,
            "timestamp": ts_col,
            "txn_id": txn_id_col,
            "direction": direction_col,
        }

        if counterparty_col is None or ts_col is None or direction_col is None:
            return [], colmap

        dfx = df.copy()
        dfx[ts_col] = pd.to_datetime(dfx[ts_col], errors="coerce")
        dfx = dfx.dropna(subset=[ts_col])

        edges: List[Dict[str, Any]] = []
        for idx, r in dfx.iterrows():
            acc = str(r.get("account_id") or "")
            cp = r.get(counterparty_col)
            if cp is None or (isinstance(cp, float) and np.isnan(cp)):
                continue
            cp = str(cp)
            if not acc or not cp:
                continue

            direction = str(r.get(direction_col) or "").strip().lower()
            amt = _to_float(r.get("amount"))
            if amt is None:
                continue
            ts = r.get(ts_col)
            if pd.isna(ts):
                continue

            if direction in {"outbound", "debit", "dr", "out"}:
                src, dst = acc, cp
            elif direction in {"inbound", "credit", "cr", "in"}:
                src, dst = cp, acc
            else:
                src, dst = acc, cp

            txn_id = r.get(txn_id_col) if txn_id_col else None
            if txn_id is None:
                txn_id = f"txn_{int(idx)}"

            edges.append(
                {
                    "id": str(txn_id),
                    "source": str(src),
                    "target": str(dst),
                    "amount": float(amt),
                    "ts": ts,
                    "raw_direction": direction,
                    "channel": r.get("channel"),
                    "txn_type": r.get("txn_type"),
                    "counterparty_bank": r.get("counterparty_bank"),
                    "device_id": r.get("device_id"),
                    "ip_address": r.get("ip_address"),
                    "geo_location": r.get("geo_location"),
                }
            )

        edges.sort(key=lambda e: e["ts"])
        return edges, colmap

    def _within_tol(self, a: float, b: float) -> bool:
        denom = max(abs(b), 1.0)
        return abs(a - b) / denom <= float(self.config.amount_tolerance)

    def build_account_flow_graph(
        self,
        df: pd.DataFrame,
        account_id: str,
        start_ts: Optional[str] = None,
        end_ts: Optional[str] = None,
    ) -> Dict[str, Any]:
        edges, colmap = self.build_directed_edges(df)
        if not edges:
            return {
                "success": False,
                "error": "transactions dataset missing required columns for flow graph",
                "required": ["direction", "amount", "txn_timestamp", "counterparty_account"],
                "colmap": colmap,
            }

        acct = str(account_id)
        t0 = pd.to_datetime(start_ts, errors="coerce") if start_ts else None
        t1 = pd.to_datetime(end_ts, errors="coerce") if end_ts else None

        if t0 is not None and not pd.isna(t0):
            edges = [e for e in edges if e["ts"] >= t0]
        if t1 is not None and not pd.isna(t1):
            edges = [e for e in edges if e["ts"] <= t1]

        out_adj: Dict[str, List[int]] = {}
        in_edges: List[int] = []
        out_edges: List[int] = []
        for i, e in enumerate(edges):
            out_adj.setdefault(e["source"], []).append(i)
            if e["target"] == acct:
                in_edges.append(i)
            if e["source"] == acct:
                out_edges.append(i)

        max_hops = int(self.config.max_hops)
        window_hours = float(self.config.window_hours)
        max_paths = int(self.config.max_paths)

        paths: List[Dict[str, Any]] = []

        def extend_path(
            start_time: pd.Timestamp,
            base_amount: float,
            path_edge_idx: List[int],
            node_path: List[str],
        ):
            if len(paths) >= max_paths:
                return
            if len(path_edge_idx) >= max_hops:
                return

            last_idx = path_edge_idx[-1]
            last_edge = edges[last_idx]
            cur_node = node_path[-1]

            for nxt_idx in out_adj.get(cur_node, []):
                if nxt_idx in path_edge_idx:
                    continue
                nxt = edges[nxt_idx]
                if nxt["ts"] < last_edge["ts"]:
                    continue
                dt = (nxt["ts"] - start_time).total_seconds() / 3600.0
                if dt > window_hours:
                    continue
                if not self._within_tol(float(nxt["amount"]), float(base_amount)):
                    continue

                new_nodes = node_path + [nxt["target"]]
                new_path = path_edge_idx + [nxt_idx]

                cycle = None
                if nxt["target"] in node_path:
                    cycle = {
                        "cycle_to": nxt["target"],
                        "cycle_start_index": int(node_path.index(nxt["target"])),
                    }

                paths.append(
                    {
                        "nodes": new_nodes,
                        "txn_ids": [edges[i]["id"] for i in new_path],
                        "hops": int(len(new_path)),
                        "start_time": start_time.isoformat(),
                        "end_time": nxt["ts"].isoformat(),
                        "amount": float(base_amount),
                        "cycle": cycle,
                    }
                )

                if cycle is None:
                    extend_path(start_time, base_amount, new_path, new_nodes)

        for idx0 in in_edges[:150]:
            e0 = edges[idx0]
            base_amount = float(e0["amount"])
            start_time = e0["ts"]
            seed_nodes = [e0["source"], e0["target"]]
            seed_edges = [idx0]
            extend_path(start_time, base_amount, seed_edges, seed_nodes)

        for idx0 in out_edges[:150]:
            e0 = edges[idx0]
            base_amount = float(e0["amount"])
            start_time = e0["ts"]
            seed_nodes = [e0["source"], e0["target"]]
            seed_edges = [idx0]
            extend_path(start_time, base_amount, seed_edges, seed_nodes)

        paths.sort(key=lambda p: (-(p.get("hops") or 0), -(p.get("amount") or 0), p.get("start_time") or ""))
        paths = paths[:max_paths]

        used_txn_ids = set()
        for p in paths:
            for tid in p.get("txn_ids") or []:
                used_txn_ids.add(str(tid))

        sub_edges = [e for e in edges if e["id"] in used_txn_ids]
        if not sub_edges:
            neighborhood = set([acct])
            for i in (in_edges + out_edges)[: self.config.max_edges]:
                neighborhood.add(edges[i]["source"])
                neighborhood.add(edges[i]["target"])
            sub_edges = [e for e in edges if e["source"] in neighborhood and e["target"] in neighborhood]
            sub_edges = sub_edges[-self.config.max_edges :]

        nodes = sorted(set([n for e in sub_edges for n in (e["source"], e["target"])]))
        nodes_out = [{"id": n, "label": n, "type": "account", "is_selected": n == acct} for n in nodes]
        edges_out = []
        for e in sub_edges[: self.config.max_edges]:
            edges_out.append(
                {
                    "id": e["id"],
                    "source": e["source"],
                    "target": e["target"],
                    "amount": float(e["amount"]),
                    "ts": e["ts"].isoformat(),
                    "channel": e.get("channel"),
                    "txn_type": e.get("txn_type"),
                    "device_id": e.get("device_id"),
                    "ip_address": e.get("ip_address"),
                    "geo_location": e.get("geo_location"),
                    "counterparty_bank": e.get("counterparty_bank"),
                }
            )

        patterns = self.compute_account_patterns(edges, acct)
        return {
            "success": True,
            "account_id": acct,
            "graph": {"nodes": nodes_out, "edges": edges_out},
            "paths": paths,
            "patterns": patterns,
            "flow_score": float(patterns.get("flow_score", 0.0)),
            "parameters": {
                "window_hours": self.config.window_hours,
                "max_hops": self.config.max_hops,
                "amount_tolerance": self.config.amount_tolerance,
                "pass_through_window_hours": self.config.pass_through_window_hours,
            },
        }

    def compute_account_patterns(self, edges: List[Dict[str, Any]], account_id: str) -> Dict[str, Any]:
        acct = str(account_id)
        inbound = [e for e in edges if e["target"] == acct]
        outbound = [e for e in edges if e["source"] == acct]
        inbound.sort(key=lambda e: e["ts"])
        outbound.sort(key=lambda e: e["ts"])

        pass_through_hits = 0
        for inc in inbound[-500:]:
            base_amt = float(inc["amount"])
            t0 = inc["ts"]
            t1 = t0 + pd.Timedelta(hours=float(self.config.pass_through_window_hours))
            ok = False
            for out in outbound:
                if out["ts"] < t0:
                    continue
                if out["ts"] > t1:
                    break
                if self._within_tol(float(out["amount"]), base_amt):
                    ok = True
                    break
            if ok:
                pass_through_hits += 1

        pass_through_rate = float(pass_through_hits / max(1, len(inbound))) if inbound else 0.0

        multi_hop = 0
        circular = 0
        burst = 0
        out_adj: Dict[str, List[int]] = {}
        for i, e in enumerate(edges):
            out_adj.setdefault(str(e["source"]), []).append(i)

        seeds = []
        for i, e in enumerate(edges):
            if e["target"] == acct or e["source"] == acct:
                seeds.append(i)
        seeds = seeds[-200:]

        max_hops = int(self.config.max_hops)
        window_hours = float(self.config.window_hours)
        seen_paths = 0

        for idx0 in seeds:
            if seen_paths >= 20:
                break
            e0 = edges[idx0]
            base_amount = float(e0["amount"])
            start_time = e0["ts"]
            node_path = [e0["source"], e0["target"]]
            path_idx = [idx0]

            stack = [(path_idx, node_path)]
            while stack and seen_paths < 20:
                cur_idx, cur_nodes = stack.pop()
                last = edges[cur_idx[-1]]
                if len(cur_idx) >= 2:
                    hops = len(cur_idx)
                    if hops >= 3:
                        multi_hop += 1
                    if cur_nodes[-1] in cur_nodes[:-1]:
                        circular += 1
                    times = [edges[i]["ts"] for i in cur_idx]
                    if len(times) >= 3:
                        dt = (max(times) - min(times)).total_seconds()
                        if dt <= 10 * 60:
                            burst += 1
                    seen_paths += 1

                if len(cur_idx) >= max_hops:
                    continue
                cur_node = cur_nodes[-1]
                for nxt_i in out_adj.get(cur_node, []):
                    if nxt_i in cur_idx:
                        continue
                    nxt = edges[nxt_i]
                    if nxt["ts"] < last["ts"]:
                        continue
                    dt = (nxt["ts"] - start_time).total_seconds() / 3600.0
                    if dt > window_hours:
                        continue
                    if not self._within_tol(float(nxt["amount"]), base_amount):
                        continue
                    stack.append((cur_idx + [nxt_i], cur_nodes + [nxt["target"]]))

        pass_score = min(1.0, pass_through_rate * 1.25)
        cycle_score = 1.0 if circular > 0 else 0.0
        hop_score = min(1.0, multi_hop / 5.0)
        burst_score = min(1.0, burst / 3.0)

        flow_score = float(0.35 * pass_score + 0.25 * cycle_score + 0.25 * hop_score + 0.15 * burst_score)

        return {
            "pass_through": {"count": int(pass_through_hits), "rate": float(pass_through_rate), "window_hours": float(self.config.pass_through_window_hours)},
            "multi_hop_chains": {"count": int(multi_hop)},
            "circular_chains": {"count": int(circular)},
            "velocity_bursts_in_chains": {"count": int(burst)},
            "flow_score": float(flow_score),
            "risk_level": _risk_bucket(flow_score),
        }

    def score_all_accounts(self, df: pd.DataFrame) -> Dict[str, float]:
        edges, _ = self.build_directed_edges(df)
        if not edges:
            return {}
        out: Dict[str, float] = {}
        nodes = sorted(set([e["source"] for e in edges] + [e["target"] for e in edges]))
        for acct in nodes:
            p = self.compute_account_patterns(edges, acct)
            out[str(acct)] = float(p.get("flow_score", 0.0))
        return out
