import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd


def _to_float(v) -> Optional[float]:
    try:
        x = float(v)
        if np.isnan(x):
            return None
        return x
    except Exception:
        return None


def _pick_col(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    for c in candidates:
        if c in df.columns:
            return c
    lower = {str(c).lower(): c for c in df.columns}
    for c in candidates:
        if c.lower() in lower:
            return lower[c.lower()]
    return None


def _norm_dir(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip().lower()
    if s in {"outbound", "out", "debit", "dr", "d"}:
        return "DEBIT"
    if s in {"inbound", "in", "credit", "cr", "c"}:
        return "CREDIT"
    if s in {"debit", "credit"}:
        return s.upper()
    return s.upper()


def _risk_color(score: float) -> str:
    s = float(score or 0)
    if s >= 0.85:
        return "RED"
    if s >= 0.65:
        return "ORANGE"
    if s >= 0.4:
        return "YELLOW"
    return "BLUE"


def _similarity(a: float, b: float) -> float:
    denom = max(abs(b), 1.0)
    return max(0.0, 1.0 - abs(a - b) / denom)


@dataclass
class FlowWorkbenchConfig:
    window_hours: float = 48.0
    max_hops: int = 4
    amount_tolerance: float = 0.12
    max_paths: int = 25
    pass_through_window_minutes: float = 60.0
    circular_only: bool = False


class MoneyFlowGraphWorkbench:
    def __init__(self, config: Optional[FlowWorkbenchConfig] = None):
        self.config = config or FlowWorkbenchConfig()

    def _canonicalize(self, tx: pd.DataFrame) -> pd.DataFrame:
        if tx is None or tx.empty:
            return pd.DataFrame()

        df = tx.copy()
        df.columns = [str(c) for c in df.columns]

        col_txn_id = _pick_col(df, ["txn_id", "transaction_id", "id", "txnId"])
        col_acc = _pick_col(df, ["account_id", "acct_id", "accountid", "account_no", "account"])
        col_ts = _pick_col(df, ["txn_timestamp", "timestamp", "txn_time", "transaction_time", "transaction_datetime", "created_at", "date", "time"])
        col_amt = _pick_col(df, ["amount", "txn_amount", "transaction_amount", "amt", "value", "rule_metric"])
        col_dir = _pick_col(df, ["direction", "dr_cr", "debit_credit", "txn_direction", "type"])
        col_cp = _pick_col(df, ["counterparty_account", "counterparty", "to_account", "to_acct", "receiver_account", "beneficiary_account"])
        col_bank = _pick_col(df, ["counterparty_bank", "bank", "beneficiary_bank"])
        col_channel = _pick_col(df, ["channel", "txn_channel"])
        col_type = _pick_col(df, ["txn_type", "transaction_type", "type_code"])
        col_device = _pick_col(df, ["device_id", "device", "device_fingerprint"])
        col_ip = _pick_col(df, ["ip_address", "ip", "ipaddr"])
        col_geo = _pick_col(df, ["geo_location", "geo", "country", "location"])

        if not col_acc or not col_ts or not col_amt or not col_dir or not col_cp:
            return pd.DataFrame()

        out = pd.DataFrame()
        out["txn_id"] = df[col_txn_id].astype(str) if col_txn_id else df.index.map(lambda i: f"TXN_{int(i)}").astype(str)
        out["account_id"] = df[col_acc].astype(str)
        out["txn_timestamp"] = pd.to_datetime(df[col_ts], errors="coerce")
        out["amount"] = pd.to_numeric(df[col_amt], errors="coerce")
        out["direction"] = df[col_dir].map(_norm_dir)
        out["counterparty_account"] = df[col_cp].astype(str)
        out["counterparty_bank"] = df[col_bank] if col_bank else None
        out["channel"] = df[col_channel] if col_channel else None
        out["txn_type"] = df[col_type] if col_type else None
        out["device_id"] = df[col_device] if col_device else None
        out["ip_address"] = df[col_ip] if col_ip else None
        out["geo_location"] = df[col_geo] if col_geo else None

        out = out.dropna(subset=["txn_timestamp", "amount"])
        out = out[out["account_id"].astype(str).str.len() > 0]
        out = out[out["counterparty_account"].astype(str).str.len() > 0]
        out = out.sort_values("txn_timestamp").reset_index(drop=True)
        return out

    def _build_edges(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        edges: List[Dict[str, Any]] = []
        for _, r in df.iterrows():
            direction = str(r.get("direction") or "").upper()
            acc = str(r.get("account_id") or "")
            cp = str(r.get("counterparty_account") or "")
            if not acc or not cp:
                continue
            if direction == "DEBIT":
                src, dst = acc, cp
            elif direction == "CREDIT":
                src, dst = cp, acc
            else:
                src, dst = acc, cp

            amt = _to_float(r.get("amount"))
            if amt is None:
                continue
            ts = r.get("txn_timestamp")
            if pd.isna(ts):
                continue
            edges.append(
                {
                    "edge_id": str(r.get("txn_id")),
                    "from": str(src),
                    "to": str(dst),
                    "transaction": {
                        "txn_id": str(r.get("txn_id")),
                        "timestamp": pd.to_datetime(ts).isoformat(),
                        "amount": float(amt),
                        "currency": str(r.get("currency") or "NA"),
                        "direction": direction,
                        "channel": None if r.get("channel") is None else str(r.get("channel")),
                        "txn_type": None if r.get("txn_type") is None else str(r.get("txn_type")),
                        "counterparty_bank": None if r.get("counterparty_bank") is None else str(r.get("counterparty_bank")),
                        "device_id": None if r.get("device_id") is None else str(r.get("device_id")),
                        "ip_address": None if r.get("ip_address") is None else str(r.get("ip_address")),
                        "geo_location": None if r.get("geo_location") is None else str(r.get("geo_location")),
                    },
                    "_ts": pd.to_datetime(ts),
                    "_amount": float(amt),
                }
            )
        edges.sort(key=lambda e: e["_ts"])
        return edges

    def _build_feature_maps(self, df: pd.DataFrame) -> Dict[str, Any]:
        device_accounts: Dict[str, set] = {}
        ip_accounts: Dict[str, set] = {}
        acct_devices: Dict[str, set] = {}
        acct_ips: Dict[str, set] = {}
        acct_geo: Dict[str, str] = {}

        for _, r in df.iterrows():
            acct = str(r.get("account_id") or "")
            if not acct:
                continue
            dev = r.get("device_id")
            ip = r.get("ip_address")
            geo = r.get("geo_location")
            if dev is not None and str(dev).strip() != "":
                d = str(dev)
                device_accounts.setdefault(d, set()).add(acct)
                acct_devices.setdefault(acct, set()).add(d)
            if ip is not None and str(ip).strip() != "":
                i = str(ip)
                ip_accounts.setdefault(i, set()).add(acct)
                acct_ips.setdefault(acct, set()).add(i)
            if geo is not None and str(geo).strip() != "":
                acct_geo[acct] = str(geo)

        return {
            "device_accounts": device_accounts,
            "ip_accounts": ip_accounts,
            "acct_devices": acct_devices,
            "acct_ips": acct_ips,
            "acct_geo": acct_geo,
        }

    def _accounts_lookup(self, accounts_df: Optional[pd.DataFrame]) -> Dict[str, Dict[str, Any]]:
        if accounts_df is None or len(accounts_df) == 0:
            return {}
        df = accounts_df.copy()
        df.columns = [str(c) for c in df.columns]
        acc_col = _pick_col(df, ["account_id", "acct_id", "accountid", "account_no", "account"])
        if not acc_col:
            return {}
        out = {}
        for _, r in df.iterrows():
            aid = r.get(acc_col)
            if aid is None or str(aid).strip() == "":
                continue
            out[str(aid)] = {k: (None if (isinstance(v, float) and np.isnan(v)) else v) for k, v in r.to_dict().items()}
        return out

    def _within_tol(self, a: float, b: float) -> bool:
        denom = max(abs(b), 1.0)
        return abs(a - b) / denom <= float(self.config.amount_tolerance)

    def _node_object(
        self,
        account_id: str,
        role: str,
        account_meta: Dict[str, Any],
        feature_maps: Dict[str, Any],
        explain: List[str],
        risk_score: float,
    ) -> Dict[str, Any]:
        acct_devices = feature_maps.get("acct_devices") or {}
        acct_ips = feature_maps.get("acct_ips") or {}
        device_accounts = feature_maps.get("device_accounts") or {}
        ip_accounts = feature_maps.get("ip_accounts") or {}
        acct_geo = feature_maps.get("acct_geo") or {}

        devs = acct_devices.get(account_id) or set()
        ips = acct_ips.get(account_id) or set()

        accounts_per_device = 0
        for d in devs:
            accounts_per_device = max(accounts_per_device, len(device_accounts.get(d) or set()))
        accounts_per_ip = 0
        for i in ips:
            accounts_per_ip = max(accounts_per_ip, len(ip_accounts.get(i) or set()))

        rr = None
        for k in ["risk_rating", "risk_level", "rating"]:
            if k in account_meta and account_meta.get(k) not in [None, ""]:
                rr = str(account_meta.get(k)).upper()
                break

        attrs = {
            "risk_rating": rr,
            "accounts_per_device": int(accounts_per_device),
            "accounts_per_ip": int(accounts_per_ip),
            "geo_location": acct_geo.get(account_id),
        }

        is_mule = None
        for k in ["is_mule", "mule", "is_mule_flag"]:
            if k in account_meta and account_meta.get(k) not in [None, ""]:
                is_mule = bool(int(account_meta.get(k)) if str(account_meta.get(k)).isdigit() else str(account_meta.get(k)).strip().lower() in {"true", "yes", "y"})
                break
        if is_mule is not None:
            attrs["is_mule"] = bool(is_mule)

        color = _risk_color(risk_score)
        if role == "ORIGIN":
            color = "ORANGE" if color != "RED" else "RED"

        return {
            "node_id": account_id,
            "node_type": "ACCOUNT",
            "role_in_path": role,
            "attributes": attrs,
            "visual": {"color": color, "size": float(1.0 + min(max(risk_score, 0.0), 1.0) * 0.6), "icon": "account"},
            "explain": explain,
            "actions": {"expand_inbound": True, "expand_outbound": True, "expand_same_day": True},
        }

    def _edge_object(
        self,
        edge: Dict[str, Any],
        prev_edge: Optional[Dict[str, Any]],
        pass_through_flag: bool,
        sim_prev: Optional[float],
        risk_flags: List[str],
        explain: List[str],
        risk_score: float,
    ) -> Dict[str, Any]:
        ts = pd.to_datetime(edge.get("transaction", {}).get("timestamp"), errors="coerce")
        prev_ts = pd.to_datetime(prev_edge.get("transaction", {}).get("timestamp"), errors="coerce") if prev_edge else None
        time_delta_minutes = None
        if prev_ts is not None and not pd.isna(prev_ts) and ts is not None and not pd.isna(ts):
            time_delta_minutes = float((ts - prev_ts).total_seconds() / 60.0)

        thickness = float(min(max(float(edge.get("_amount") or 0) / 100000.0, 1.0), 4.0))
        color = _risk_color(risk_score)
        animation = "FAST_FLOW" if pass_through_flag or (time_delta_minutes is not None and time_delta_minutes <= 60) else "FLOW"

        return {
            "edge_id": edge["edge_id"],
            "from": edge["from"],
            "to": edge["to"],
            "transaction": {
                "txn_id": edge.get("transaction", {}).get("txn_id"),
                "timestamp": edge.get("transaction", {}).get("timestamp"),
                "amount": edge.get("transaction", {}).get("amount"),
                "currency": edge.get("transaction", {}).get("currency"),
                "direction": edge.get("transaction", {}).get("direction"),
                "channel": edge.get("transaction", {}).get("channel"),
            },
            "flow": {
                "time_delta_minutes": time_delta_minutes,
                "amount_similarity_prev": None if sim_prev is None else float(sim_prev),
                "pass_through_flag": bool(pass_through_flag),
            },
            "risk_flags": risk_flags,
            "visual": {"color": color, "thickness": thickness, "animation": animation},
            "explain": explain,
            "actions": {"expand_next_hop": True, "show_raw_transactions": True},
        }

    def _cycle_object(self, nodes: List[str], edges: List[Dict[str, Any]]) -> Dict[str, Any]:
        times = []
        amounts = []
        for e in edges:
            try:
                times.append(pd.to_datetime(e.get("transaction", {}).get("timestamp"), errors="coerce"))
            except Exception:
                pass
            try:
                amounts.append(float(e.get("transaction", {}).get("amount") or 0))
            except Exception:
                pass
        times = [t for t in times if t is not None and not pd.isna(t)]
        total_time_minutes = None
        if times:
            total_time_minutes = float((max(times) - min(times)).total_seconds() / 60.0)
        amount_similarity = None
        if len(amounts) >= 2:
            sims = []
            for i in range(1, len(amounts)):
                sims.append(_similarity(amounts[i], amounts[i - 1]))
            amount_similarity = float(sum(sims) / max(1, len(sims)))
        return {
            "cycle_id": f"CYCLE_{uuid.uuid4().hex[:6]}",
            "nodes": nodes,
            "metrics": {
                "cycle_length": int(max(0, len(nodes) - 1)),
                "total_time_minutes": total_time_minutes,
                "amount_similarity": amount_similarity,
                "frequency_30d": None,
            },
            "visual": {"style": "CLOSED_LOOP", "highlight": True},
        }

    def _risk_score_path(self, reasons: List[str], metrics: Dict[str, Any]) -> float:
        score = 0.0
        if "CIRCULAR_FLOW" in reasons:
            score += 0.35
        if "FAST_PASS_THROUGH" in reasons:
            score += 0.25
        if "AMOUNT_SIMILARITY" in reasons:
            score += 0.15
        if "SHARED_DEVICE" in reasons:
            score += 0.15
        if "SHARED_IP" in reasons:
            score += 0.1
        if "VELOCITY_BURST" in reasons:
            score += 0.1

        hop_count = int(metrics.get("hop_count") or 0)
        if hop_count >= 4:
            score += 0.05
        return float(max(0.0, min(score, 1.0)))

    def _build_candidate_paths(self, edges: List[Dict[str, Any]], focal: str) -> List[Dict[str, Any]]:
        out_adj: Dict[str, List[int]] = {}
        for i, e in enumerate(edges):
            out_adj.setdefault(str(e["from"]), []).append(i)

        for k, idxs in out_adj.items():
            idxs.sort(key=lambda i: edges[i]["_ts"])

        focal = str(focal)
        max_hops = int(self.config.max_hops)
        window_hours = float(self.config.window_hours)
        max_paths = int(self.config.max_paths)

        seed_idxs = [i for i, e in enumerate(edges) if e["from"] == focal or e["to"] == focal]
        seed_idxs.sort(key=lambda i: edges[i]["_ts"])
        seed_idxs = seed_idxs[-min(200, len(seed_idxs)) :]

        paths = []

        def extend(seed_idx: int):
            e0 = edges[seed_idx]
            start_time = e0["_ts"]
            base_amt = float(e0["_amount"])
            node_path = [e0["from"], e0["to"]]
            idx_path = [seed_idx]

            stack = [(idx_path, node_path)]
            while stack and len(paths) < max_paths:
                cur_idx, cur_nodes = stack.pop()
                last_edge = edges[cur_idx[-1]]
                cur_node = cur_nodes[-1]

                if len(cur_idx) >= 2:
                    paths.append({"edge_idxs": list(cur_idx), "nodes": list(cur_nodes)})

                if len(cur_idx) >= max_hops:
                    continue

                for nxt_i in out_adj.get(str(cur_node), []):
                    if nxt_i in cur_idx:
                        continue
                    nxt = edges[nxt_i]
                    if nxt["_ts"] < last_edge["_ts"]:
                        continue
                    dt = float((nxt["_ts"] - start_time).total_seconds() / 3600.0)
                    if dt > window_hours:
                        continue
                    if not self._within_tol(float(nxt["_amount"]), float(base_amt)):
                        continue
                    stack.append((cur_idx + [nxt_i], cur_nodes + [nxt["to"]]))

        for si in seed_idxs[::-1]:
            extend(si)
            if len(paths) >= max_paths:
                break

        uniq = []
        seen = set()
        for p in paths:
            key = tuple(edges[i]["edge_id"] for i in p["edge_idxs"])
            if key in seen:
                continue
            seen.add(key)
            uniq.append(p)
        return uniq[:max_paths]

    def _context_payload(
        self,
        df: pd.DataFrame,
        edges_raw: List[Dict[str, Any]],
        focal: str,
        candidates: List[Dict[str, Any]],
        feature_maps: Dict[str, Any],
        acc_lookup: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Any]:
        focal_edges = [e for e in edges_raw if str(e.get("from")) == focal or str(e.get("to")) == focal]
        inbound_count = int(sum(1 for e in focal_edges if str(e.get("to")) == focal))
        outbound_count = int(sum(1 for e in focal_edges if str(e.get("from")) == focal))

        counterparties = set()
        counterparty_stats: Dict[str, Dict[str, Any]] = {}
        for e in focal_edges:
            src = str(e.get("from"))
            dst = str(e.get("to"))
            cp = dst if src == focal else src
            if not cp:
                continue
            if cp != focal:
                counterparties.add(cp)
            stats = counterparty_stats.setdefault(cp, {"counterparty": cp, "total_amount": 0.0, "transaction_count": 0})
            stats["total_amount"] = float(stats["total_amount"]) + float(e.get("_amount") or 0.0)
            stats["transaction_count"] = int(stats["transaction_count"]) + 1

        times = [e.get("_ts") for e in focal_edges if e.get("_ts") is not None]
        t_min = min(times) if times else None
        t_max = max(times) if times else None
        time_range_days = float((t_max - t_min).total_seconds() / 86400.0) if t_min is not None and t_max is not None else 0.0

        top_counterparties = sorted(
            [v for v in counterparty_stats.values() if v.get("counterparty")],
            key=lambda x: (-(x.get("total_amount") or 0.0), -(x.get("transaction_count") or 0)),
        )[:8]

        hop_counts: Dict[int, int] = {}
        max_observed_hops = 0
        circular_candidates = 0
        pass_through_candidates = 0
        multi_hop_candidates = 0
        burst_candidates = 0
        candidate_paths = 0
        pass_window = float(self.config.pass_through_window_minutes)

        for p in candidates:
            edge_idxs = p.get("edge_idxs") or []
            node_seq = p.get("nodes") or []
            edges_seq = [edges_raw[i] for i in edge_idxs if i < len(edges_raw)]
            hop_count = int(len(edges_seq))
            if hop_count <= 0:
                continue
            candidate_paths += 1
            hop_counts[hop_count] = hop_counts.get(hop_count, 0) + 1
            max_observed_hops = max(max_observed_hops, hop_count)
            if hop_count >= 3:
                multi_hop_candidates += 1

            circular = False
            if len(node_seq) >= 4 and node_seq[0] in node_seq[1:-1]:
                circular = True
            if circular:
                circular_candidates += 1

            fast_exit = 0
            burst = 0
            for i2 in range(1, len(edges_seq)):
                dtm = float((edges_seq[i2]["_ts"] - edges_seq[i2 - 1]["_ts"]).total_seconds() / 60.0)
                if dtm <= pass_window and self._within_tol(float(edges_seq[i2]["_amount"]), float(edges_seq[i2 - 1]["_amount"])):
                    fast_exit += 1
                if dtm <= 10:
                    burst += 1
            if fast_exit > 0:
                pass_through_candidates += 1
            if burst >= 2:
                burst_candidates += 1

        max_hop_considered = int(max(max_observed_hops, 6))
        hop_impact = []
        for h in range(1, max_hop_considered + 1):
            count = int(sum(v for k, v in hop_counts.items() if k <= h))
            hop_impact.append({"max_hops": int(h), "path_count": count})

        time_window_activity = []
        if t_max is not None:
            for days in [7, 30, 90]:
                cutoff = t_max - pd.Timedelta(days=int(days))
                count = int(sum(1 for e in focal_edges if e.get("_ts") is not None and e.get("_ts") >= cutoff))
                time_window_activity.append({"days": int(days), "transactions": count})

        baseline_nodes = []
        if focal:
            baseline_nodes.append(self._node_object(str(focal), "ORIGIN", acc_lookup.get(str(focal), {}), feature_maps, [], 0.0))
        for cp in [r.get("counterparty") for r in top_counterparties]:
            if not cp or cp == focal:
                continue
            baseline_nodes.append(self._node_object(str(cp), "DESTINATION", acc_lookup.get(str(cp), {}), feature_maps, [], 0.0))

        baseline_node_ids = {str(n.get("node_id")) for n in baseline_nodes if n and n.get("node_id") is not None}
        baseline_edges = []
        for e in focal_edges:
            if str(e.get("from")) in baseline_node_ids and str(e.get("to")) in baseline_node_ids:
                baseline_edges.append(self._edge_object(e, None, False, None, [], [], 0.0))

        baseline_path = {
            "path_id": "BASELINE",
            "path_rank": 1,
            "path_type": "BASELINE",
            "risk_score": 0.0,
            "metrics": {
                "hop_count": 1,
                "total_amount": float(sum(float(e.get("_amount") or 0.0) for e in focal_edges)),
                "total_duration_minutes": float((t_max - t_min).total_seconds() / 60.0) if t_min is not None and t_max is not None else 0.0,
            },
            "risk_reasons": [],
            "nodes": baseline_nodes,
            "edges": baseline_edges,
            "cycles": [],
        }

        return {
            "context_summary": {
                "account_id": focal,
                "total_transactions": int(len(focal_edges)),
                "inbound_count": inbound_count,
                "outbound_count": outbound_count,
                "unique_counterparties": int(len(counterparties)),
                "max_observed_hops": int(max_observed_hops),
                "time_range": {
                    "start": None if t_min is None else pd.to_datetime(t_min).isoformat(),
                    "end": None if t_max is None else pd.to_datetime(t_max).isoformat(),
                    "days": float(time_range_days),
                },
                "top_counterparties": top_counterparties,
            },
            "availability": {
                "candidate_paths": int(candidate_paths),
                "circular_candidates": int(circular_candidates),
                "pass_through_candidates": int(pass_through_candidates),
                "multi_hop_candidates": int(multi_hop_candidates),
                "burst_candidates": int(burst_candidates),
                "hop_counts": {str(k): int(v) for k, v in hop_counts.items()},
                "hop_impact": hop_impact,
                "time_window_activity": time_window_activity,
            },
            "baseline": {
                "label": "Baseline Transaction Network (no suspicion filters applied)",
                "path": baseline_path,
            },
        }

    def build_graph_json(
        self,
        transactions_df: pd.DataFrame,
        accounts_df: Optional[pd.DataFrame],
        focal_account_id: str,
        start_ts: Optional[str] = None,
        end_ts: Optional[str] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        cfg = self.config
        df = self._canonicalize(transactions_df)
        if df.empty:
            return {"success": False, "error": "transactions dataset missing required columns for workbench"}

        t0 = pd.to_datetime(start_ts, errors="coerce") if start_ts else None
        t1 = pd.to_datetime(end_ts, errors="coerce") if end_ts else None
        if t0 is not None and not pd.isna(t0):
            df = df[df["txn_timestamp"] >= t0]
        if t1 is not None and not pd.isna(t1):
            df = df[df["txn_timestamp"] <= t1]
        if df.empty:
            return {"success": False, "error": "no transactions in selected time window"}

        edges_raw = self._build_edges(df)
        if not edges_raw:
            return {"success": False, "error": "no directed edges available for workbench"}

        feature_maps = self._build_feature_maps(df)
        acc_lookup = self._accounts_lookup(accounts_df)

        focal = str(focal_account_id)
        candidates = self._build_candidate_paths(edges_raw, focal)
        context_payload = self._context_payload(df, edges_raw, focal, candidates, feature_maps, acc_lookup)

        path_objs = []
        circular_paths = 0
        for idx, p in enumerate(candidates):
            edge_idxs = p["edge_idxs"]
            node_seq = p["nodes"]
            edges_seq = [edges_raw[i] for i in edge_idxs]

            hop_count = int(len(edges_seq))
            if hop_count <= 0:
                continue

            amounts = [float(e["_amount"]) for e in edges_seq]
            times = [e["_ts"] for e in edges_seq]
            total_duration_minutes = float((max(times) - min(times)).total_seconds() / 60.0) if times else 0.0

            retention = None
            if amounts:
                retention = float(amounts[-1] / max(amounts[0], 1.0))

            sim_avg = None
            if len(amounts) >= 2:
                sims = []
                for i2 in range(1, len(amounts)):
                    sims.append(_similarity(amounts[i2], amounts[i2 - 1]))
                sim_avg = float(sum(sims) / max(1, len(sims)))

            risk_reasons = []
            if sim_avg is not None and sim_avg >= 0.9:
                risk_reasons.append("AMOUNT_SIMILARITY")

            cycle_nodes = None
            for n in node_seq[1:]:
                if n in node_seq[:-1] and n == node_seq[0] and len(node_seq) >= 4:
                    cycle_nodes = node_seq[:]
                    break
            if cycle_nodes is not None:
                risk_reasons.append("CIRCULAR_FLOW")

            fast_exit = 0
            burst = 0
            pass_window = float(cfg.pass_through_window_minutes)
            for i2, e in enumerate(edges_seq):
                if i2 == 0:
                    continue
                dtm = float((edges_seq[i2]["_ts"] - edges_seq[i2 - 1]["_ts"]).total_seconds() / 60.0)
                if dtm <= pass_window and self._within_tol(float(edges_seq[i2]["_amount"]), float(edges_seq[i2 - 1]["_amount"])):
                    fast_exit += 1
                if dtm <= 10:
                    burst += 1
            if fast_exit > 0:
                risk_reasons.append("FAST_PASS_THROUGH")
            if burst >= 2:
                risk_reasons.append("VELOCITY_BURST")

            shared_device = False
            shared_ip = False
            for n in set(node_seq):
                devs = feature_maps.get("acct_devices", {}).get(n) or set()
                ips = feature_maps.get("acct_ips", {}).get(n) or set()
                for d in devs:
                    if len(feature_maps.get("device_accounts", {}).get(d) or set()) >= 3:
                        shared_device = True
                for ip in ips:
                    if len(feature_maps.get("ip_accounts", {}).get(ip) or set()) >= 3:
                        shared_ip = True
            if shared_device:
                risk_reasons.append("SHARED_DEVICE")
            if shared_ip:
                risk_reasons.append("SHARED_IP")

            metrics = {
                "hop_count": hop_count,
                "total_amount": float(amounts[0]) if amounts else 0.0,
                "amount_retention_ratio": retention,
                "total_duration_minutes": float(total_duration_minutes),
                "cycle_frequency_30d": None,
            }

            risk_score = self._risk_score_path(risk_reasons, metrics)

            path_type = "LINEAR"
            if "CIRCULAR_FLOW" in risk_reasons:
                path_type = "CIRCULAR"
            elif "FAST_PASS_THROUGH" in risk_reasons:
                path_type = "PASS_THROUGH"

            if cfg.circular_only and path_type != "CIRCULAR":
                continue

            node_objs = []
            for j, n in enumerate(node_seq):
                role = "INTERMEDIARY"
                if j == 0:
                    role = "ORIGIN"
                elif j == len(node_seq) - 1:
                    role = "DESTINATION"

                meta = acc_lookup.get(str(n), {})
                explain = []
                devs = feature_maps.get("acct_devices", {}).get(str(n)) or set()
                ips = feature_maps.get("acct_ips", {}).get(str(n)) or set()
                for d in devs:
                    if len(feature_maps.get("device_accounts", {}).get(d) or set()) >= 3:
                        explain.append("Shared device with multiple accounts")
                        break
                for ip in ips:
                    if len(feature_maps.get("ip_accounts", {}).get(ip) or set()) >= 3:
                        explain.append("Shared IP with multiple accounts")
                        break
                if "FAST_PASS_THROUGH" in risk_reasons and role == "INTERMEDIARY":
                    explain.append("Fast pass-through behavior on this path")
                if "CIRCULAR_FLOW" in risk_reasons and str(n) == str(focal):
                    explain.append("Account participates in a circular fund movement")

                node_objs.append(self._node_object(str(n), role, meta, feature_maps, explain, risk_score))

            edge_objs = []
            for j, e in enumerate(edges_seq):
                prev = edges_seq[j - 1] if j > 0 else None
                sim_prev = None
                if prev is not None:
                    sim_prev = _similarity(float(e["_amount"]), float(prev["_amount"]))
                pass_flag = False
                risk_flags = []
                explain = []
                if prev is not None:
                    dtm = float((e["_ts"] - prev["_ts"]).total_seconds() / 60.0)
                    if dtm <= pass_window and self._within_tol(float(e["_amount"]), float(prev["_amount"])):
                        pass_flag = True
                        risk_flags.append("FAST_EXIT")
                        explain.append(f"Funds exited within {int(dtm)} minutes")
                    if sim_prev is not None and sim_prev >= 0.9:
                        risk_flags.append("AMOUNT_MATCH")
                        explain.append("Amount closely matches previous hop")
                if "CIRCULAR_FLOW" in risk_reasons and (e["to"] in node_seq[:-1]):
                    risk_flags.append("CYCLE_STEP")
                edge_objs.append(self._edge_object(e, prev, pass_flag, sim_prev, risk_flags, explain, risk_score))

            cycles = []
            if path_type == "CIRCULAR" and cycle_nodes is not None:
                cycles.append(self._cycle_object(cycle_nodes, edge_objs))
                circular_paths += 1

            path_objs.append(
                {
                    "path_id": f"PATH_{idx + 1:03d}",
                    "path_rank": int(idx + 1),
                    "path_type": path_type,
                    "risk_score": float(risk_score),
                    "metrics": metrics,
                    "risk_reasons": risk_reasons,
                    "nodes": node_objs,
                    "edges": edge_objs,
                    "cycles": cycles,
                }
            )

        path_objs.sort(key=lambda p: (-(p.get("risk_score") or 0.0), -(p.get("metrics", {}).get("hop_count") or 0), p.get("path_id") or ""))
        for i, p in enumerate(path_objs):
            p["path_rank"] = int(i + 1)

        overall = float(max((p.get("risk_score") or 0.0) for p in path_objs)) if path_objs else 0.0

        graph_json = {
            "success": True,
            "graph_id": f"graph_{focal}",
            "account_id": focal,
            "context": {
                "start_ts": start_ts,
                "end_ts": end_ts,
                "filters": filters or {},
                "window_hours": float(cfg.window_hours),
                "max_hops": int(cfg.max_hops),
                "amount_tolerance": float(cfg.amount_tolerance),
                "pass_through_window_minutes": float(cfg.pass_through_window_minutes),
                "circular_only": bool(cfg.circular_only),
            },
            "summary": {
                "total_paths": int(len(path_objs)),
                "circular_paths": int(sum(1 for p in path_objs if p.get("path_type") == "CIRCULAR")),
                "overall_risk_score": overall,
                "candidate_paths": int(context_payload.get("availability", {}).get("candidate_paths") or 0),
            },
            "paths": path_objs,
        }
        graph_json.update(context_payload)
        return graph_json

    def build_context_json(
        self,
        transactions_df: pd.DataFrame,
        accounts_df: Optional[pd.DataFrame],
        focal_account_id: str,
        start_ts: Optional[str] = None,
        end_ts: Optional[str] = None,
    ) -> Dict[str, Any]:
        df = self._canonicalize(transactions_df)
        if df.empty:
            return {"success": False, "error": "transactions dataset missing required columns for workbench"}

        t0 = pd.to_datetime(start_ts, errors="coerce") if start_ts else None
        t1 = pd.to_datetime(end_ts, errors="coerce") if end_ts else None
        if t0 is not None and not pd.isna(t0):
            df = df[df["txn_timestamp"] >= t0]
        if t1 is not None and not pd.isna(t1):
            df = df[df["txn_timestamp"] <= t1]
        if df.empty:
            return {"success": False, "error": "no transactions in selected time window"}

        edges_raw = self._build_edges(df)
        if not edges_raw:
            return {"success": False, "error": "no directed edges available for workbench"}

        feature_maps = self._build_feature_maps(df)
        acc_lookup = self._accounts_lookup(accounts_df)
        focal = str(focal_account_id)
        candidates = self._build_candidate_paths(edges_raw, focal)
        payload = self._context_payload(df, edges_raw, focal, candidates, feature_maps, acc_lookup)
        return {"success": True, "account_id": focal, **payload}

