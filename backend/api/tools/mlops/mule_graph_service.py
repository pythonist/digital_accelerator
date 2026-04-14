from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import networkx as nx
import pandas as pd

from api.tools.mlops.duckdb_manager import get_connection
from api.tools.mlops.path_utils import resolve_data_file_path


def _txt(value: Any) -> str:
    return str(value or "").strip()


def _low(value: Any) -> str:
    return _txt(value).lower()


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _first(columns: Iterable[str], candidates: Iterable[str]) -> Optional[str]:
    lookup = {str(col).strip().lower(): str(col) for col in columns}
    for candidate in candidates:
        hit = lookup.get(str(candidate).strip().lower())
        if hit:
            return hit
    return None


def _load_frame(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    return pd.read_csv(path)


class MuleGraphService:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)

    def _env_root(self) -> Path:
        return self.db_path.resolve().parents[2]

    def _load_dataset_by_type(
        self,
        tenant_id: str,
        env_id: str,
        dataset_types: Iterable[str],
        pipeline_id: Optional[int] = None,
    ) -> Optional[pd.DataFrame]:
        wanted = {str(item).strip().lower() for item in dataset_types if str(item).strip()}
        with get_connection(self.db_path) as conn:
            if pipeline_id is not None:
                rows = conn.execute(
                    """
                    SELECT dataset_type, file_path
                    FROM mlops_dataset_registry
                    WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule' AND pipeline_id = ?
                    ORDER BY updated_at DESC, dataset_id DESC
                    """,
                    [tenant_id, env_id, int(pipeline_id)],
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT dataset_type, file_path
                    FROM mlops_dataset_registry
                    WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule'
                    ORDER BY updated_at DESC, dataset_id DESC
                    """,
                    [tenant_id, env_id],
                ).fetchall()
        for dataset_type, file_path in rows:
            if _low(dataset_type) not in wanted:
                continue
            path = resolve_data_file_path(Path(file_path), env_root=self._env_root())
            if not path.exists():
                continue
            try:
                frame = _load_frame(path)
            except Exception:
                continue
            if not frame.empty:
                return frame
        return None

    def _shared_device_links(self, device_logs: Optional[pd.DataFrame]) -> Dict[str, int]:
        if device_logs is None or device_logs.empty:
            return {}
        account_col = _first(device_logs.columns, ["account_id"])
        device_col = _first(device_logs.columns, ["device_id", "device_fingerprint_hash"])
        if not account_col or not device_col:
            return {}
        device_usage = device_logs.groupby(device_col)[account_col].nunique()
        shared_devices = {device for device, count in device_usage.items() if int(count) > 1}
        if not shared_devices:
            return {}
        subset = device_logs[device_logs[device_col].isin(shared_devices)]
        result: Dict[str, int] = {}
        for account_id, count in subset.groupby(account_col)[device_col].nunique().items():
            result[str(account_id)] = int(count)
        return result

    def _empty_result(self, account_ids: List[str], reason: str = "") -> Dict[str, Any]:
        rows = pd.DataFrame({"account_id": account_ids})
        for column, value in (
            ("graph_cluster_id", ""),
            ("cluster_size", 0),
            ("suspicious_neighbor_count", 0),
            ("shared_device_links", 0),
            ("graph_degree", 0),
            ("graph_pagerank", 0.0),
            ("graph_risk_score", 0.0),
        ):
            rows[column] = value
        return {
            "enabled": False,
            "summary": {"enabled": False, "reason": reason},
            "rows": rows,
            "payload": {"nodes": [], "links": [], "clusters": [], "focus_cluster_id": "", "truncated": False},
        }

    def analyze(
        self,
        tenant_id: str,
        env_id: str,
        account_frame: Optional[pd.DataFrame] = None,
        *,
        pipeline_id: Optional[int] = None,
        max_nodes: int = 140,
        max_edges: int = 260,
        max_clusters: int = 4,
    ) -> Dict[str, Any]:
        if account_frame is None or account_frame.empty or "account_id" not in account_frame.columns:
            return self._empty_result([], "Account-level Mule output is not available yet")

        focus_frame = account_frame.copy()
        focus_frame["account_id"] = focus_frame["account_id"].astype(str)
        focus_frame = focus_frame.drop_duplicates(subset=["account_id"], keep="first")
        account_ids = focus_frame["account_id"].astype(str).tolist()
        if not account_ids:
            return self._empty_result([], "No account rows available for graph analysis")

        graph_nodes = self._load_dataset_by_type(tenant_id, env_id, ["graph_nodes"], pipeline_id=pipeline_id)
        graph_edges = self._load_dataset_by_type(tenant_id, env_id, ["graph_edges"], pipeline_id=pipeline_id)
        device_logs = self._load_dataset_by_type(tenant_id, env_id, ["device_logs"], pipeline_id=pipeline_id)
        if graph_nodes is None or graph_edges is None:
            return self._empty_result(account_ids, "Graph source tables are not available")

        node_id_col = _first(graph_nodes.columns, ["node_id"])
        entity_col = _first(graph_nodes.columns, ["entity_id"])
        node_type_col = _first(graph_nodes.columns, ["node_type"])
        risk_band_col = _first(graph_nodes.columns, ["risk_band"])
        mule_flag_col = _first(graph_nodes.columns, ["mule_flag_if_applicable"])
        source_col = _first(graph_edges.columns, ["source_node_id"])
        target_col = _first(graph_edges.columns, ["target_node_id"])
        edge_type_col = _first(graph_edges.columns, ["edge_type"])
        edge_weight_col = _first(graph_edges.columns, ["edge_weight"])
        suspicious_edge_col = _first(graph_edges.columns, ["suspicious_link_flag"])
        if not all([node_id_col, entity_col, node_type_col, source_col, target_col]):
            return self._empty_result(account_ids, "Graph source columns are incomplete")

        graph = nx.Graph()
        node_to_account: Dict[str, str] = {}
        account_to_node: Dict[str, str] = {}
        node_attributes: Dict[str, Dict[str, Any]] = {}
        risk_lookup: Dict[str, int] = {}

        for row in graph_nodes.itertuples(index=False):
            node_id = _txt(getattr(row, node_id_col))
            if not node_id:
                continue
            entity_id = _txt(getattr(row, entity_col))
            node_type = _low(getattr(row, node_type_col))
            risk_band = _txt(getattr(row, risk_band_col)) if risk_band_col else ""
            mule_flag = _safe_int(getattr(row, mule_flag_col), 0) if mule_flag_col else 0
            attrs = {
                "node_type": node_type or "entity",
                "entity_id": entity_id or node_id,
                "risk_band": risk_band,
                "mule_flag_if_applicable": int(mule_flag),
            }
            node_attributes[node_id] = attrs
            graph.add_node(node_id, **attrs)
            if node_type == "account" and entity_id:
                node_to_account[node_id] = entity_id
                account_to_node[entity_id] = node_id
            risk_lookup[node_id] = 1 if risk_band.upper() in {"HIGH", "VERY_HIGH"} or mule_flag >= 1 else 0

        for row in graph_edges.itertuples(index=False):
            source = _txt(getattr(row, source_col))
            target = _txt(getattr(row, target_col))
            if not source or not target:
                continue
            graph.add_edge(
                source,
                target,
                edge_type=_txt(getattr(row, edge_type_col)) if edge_type_col else "",
                edge_weight=_safe_float(getattr(row, edge_weight_col), 1.0) if edge_weight_col else 1.0,
                suspicious_link_flag=bool(_safe_int(getattr(row, suspicious_edge_col), 0)) if suspicious_edge_col else False,
            )

        if graph.number_of_nodes() <= 0 or graph.number_of_edges() <= 0:
            return self._empty_result(account_ids, "Graph edges are empty")

        focus_accounts = set(account_ids)
        focus_scores = {
            str(row.account_id): {
                "mule_risk_score": _safe_float(getattr(row, "mule_risk_score", 0.0), 0.0),
                "predicted_mule_flag": _safe_int(getattr(row, "predicted_mule_flag", 0), 0),
                "risk_band_output": _txt(getattr(row, "risk_band", "")),
            }
            for row in focus_frame.itertuples(index=False)
        }
        focus_nodes = {account_to_node[account_id] for account_id in focus_accounts if account_id in account_to_node}
        if not focus_nodes:
            return self._empty_result(account_ids, "No account nodes matched the uploaded graph")

        shared_device_links = self._shared_device_links(device_logs)
        degree_centrality = nx.degree_centrality(graph)
        try:
            pagerank_scores = nx.pagerank(graph, alpha=0.85, max_iter=200)
        except Exception:
            pagerank_scores = {node_id: 0.0 for node_id in graph.nodes()}

        component_records: List[Dict[str, Any]] = []
        for nodes in nx.connected_components(graph):
            node_set = set(nodes)
            if not focus_nodes.intersection(node_set):
                continue
            account_members = sorted(
                {node_to_account[node_id] for node_id in node_set if node_id in node_to_account},
                key=lambda account_id: (-focus_scores.get(account_id, {}).get("mule_risk_score", 0.0), account_id),
            )
            suspicious_nodes = int(sum(risk_lookup.get(node_id, 0) for node_id in node_set))
            subgraph = graph.subgraph(node_set)
            suspicious_edges = int(sum(1 for _, _, data in subgraph.edges(data=True) if bool(data.get("suspicious_link_flag"))))
            edge_types = {}
            for _, _, data in subgraph.edges(data=True):
                edge_type = _txt(data.get("edge_type")) or "linked"
                edge_types[edge_type] = int(edge_types.get(edge_type, 0)) + 1
            avg_model_score = 0.0
            if account_members:
                avg_model_score = float(sum(focus_scores.get(account_id, {}).get("mule_risk_score", 0.0) for account_id in account_members) / max(len(account_members), 1))
            shared_device_accounts = int(sum(1 for account_id in account_members if shared_device_links.get(account_id, 0) > 0))
            component_records.append(
                {
                    "nodes": node_set,
                    "node_count": int(len(node_set)),
                    "account_members": account_members,
                    "account_count": int(len(account_members)),
                    "suspicious_nodes": suspicious_nodes,
                    "suspicious_edges": suspicious_edges,
                    "avg_model_score": float(avg_model_score),
                    "shared_device_accounts": shared_device_accounts,
                    "pattern_tags": [item[0] for item in sorted(edge_types.items(), key=lambda pair: (-pair[1], pair[0]))[:3]],
                }
            )

        component_records.sort(
            key=lambda item: (
                -float(item["avg_model_score"]),
                -int(item["suspicious_nodes"]),
                -int(item["account_count"]),
                -int(item["node_count"]),
                ",".join(item["account_members"][:3]),
            )
        )

        node_to_cluster: Dict[str, str] = {}
        cluster_lookup: Dict[str, Dict[str, Any]] = {}
        cluster_summaries: List[Dict[str, Any]] = []
        for index, component in enumerate(component_records, start=1):
            cluster_id = f"RING-{index:04d}"
            component["cluster_id"] = cluster_id
            cluster_lookup[cluster_id] = component
            for node_id in component["nodes"]:
                node_to_cluster[node_id] = cluster_id
            cluster_summaries.append(
                {
                    "cluster_id": cluster_id,
                    "account_count": int(component["account_count"]),
                    "node_count": int(component["node_count"]),
                    "suspicious_nodes": int(component["suspicious_nodes"]),
                    "suspicious_edges": int(component["suspicious_edges"]),
                    "shared_device_accounts": int(component["shared_device_accounts"]),
                    "avg_model_score": float(component["avg_model_score"]),
                    "pattern_tags": component["pattern_tags"],
                    "sample_accounts": component["account_members"][:6],
                }
            )

        rows: List[Dict[str, Any]] = []
        for account_id in account_ids:
            node_id = account_to_node.get(account_id)
            if not node_id or node_id not in graph:
                rows.append(
                    {
                        "account_id": account_id,
                        "graph_cluster_id": "",
                        "cluster_size": 0,
                        "suspicious_neighbor_count": 0,
                        "shared_device_links": int(shared_device_links.get(account_id, 0)),
                        "graph_degree": 0,
                        "graph_pagerank": 0.0,
                        "graph_risk_score": 0.0,
                    }
                )
                continue
            neighbors = list(graph.neighbors(node_id))
            suspicious_neighbors = int(sum(risk_lookup.get(neighbor, 0) for neighbor in neighbors))
            cluster_id = node_to_cluster.get(node_id, "")
            component = cluster_lookup.get(cluster_id, {})
            cluster_size = int(component.get("account_count", 0))
            shared_devices = int(shared_device_links.get(account_id, 0))
            graph_degree = int(graph.degree(node_id))
            pagerank_value = float(pagerank_scores.get(node_id, 0.0))
            centrality_value = float(degree_centrality.get(node_id, 0.0))
            graph_risk_score = min(
                1.0,
                (min(cluster_size, 12) / 12.0) * 0.28
                + (min(suspicious_neighbors, 8) / 8.0) * 0.27
                + (min(shared_devices, 5) / 5.0) * 0.2
                + min(centrality_value * 4.0, 1.0) * 0.15
                + min(pagerank_value * 10.0, 1.0) * 0.10,
            )
            rows.append(
                {
                    "account_id": account_id,
                    "graph_cluster_id": cluster_id,
                    "cluster_size": cluster_size,
                    "suspicious_neighbor_count": suspicious_neighbors,
                    "shared_device_links": shared_devices,
                    "graph_degree": graph_degree,
                    "graph_pagerank": pagerank_value,
                    "graph_risk_score": float(graph_risk_score),
                }
            )

        graph_rows = pd.DataFrame(rows)
        focus_cluster_ids = [item["cluster_id"] for item in cluster_summaries[:max_clusters]]
        selected_nodes = set()
        selected_edges: List[Dict[str, Any]] = []
        truncated = False
        for cluster_id in focus_cluster_ids:
            component = cluster_lookup.get(cluster_id) or {}
            component_nodes = list(component.get("nodes") or [])
            component_nodes.sort(
                key=lambda node_id: (
                    0 if node_attributes.get(node_id, {}).get("node_type") == "account" else 1,
                    -risk_lookup.get(node_id, 0),
                    node_id,
                )
            )
            remaining_slots = max_nodes - len(selected_nodes)
            if remaining_slots <= 0:
                truncated = True
                break
            if len(component_nodes) > remaining_slots:
                component_nodes = component_nodes[:remaining_slots]
                truncated = True
            selected_nodes.update(component_nodes)
        for cluster_id in focus_cluster_ids:
            component = cluster_lookup.get(cluster_id) or {}
            subgraph = graph.subgraph(component.get("nodes") or [])
            for source, target, data in subgraph.edges(data=True):
                if source not in selected_nodes or target not in selected_nodes:
                    continue
                if len(selected_edges) >= max_edges:
                    truncated = True
                    break
                selected_edges.append(
                    {
                        "source": source,
                        "target": target,
                        "edge_type": _txt(data.get("edge_type")) or "linked",
                        "edge_weight": float(_safe_float(data.get("edge_weight"), 1.0)),
                        "suspicious_link_flag": bool(data.get("suspicious_link_flag")),
                        "cluster_id": cluster_id,
                    }
                )
            if len(selected_edges) >= max_edges:
                break

        payload_nodes = []
        for node_id in selected_nodes:
            attrs = node_attributes.get(node_id) or {}
            account_id = node_to_account.get(node_id, "")
            account_state = focus_scores.get(account_id, {})
            payload_nodes.append(
                {
                    "id": node_id,
                    "label": attrs.get("entity_id") or node_id,
                    "display_name": f"{(attrs.get('node_type') or 'entity').replace('_', ' ').title()}: {attrs.get('entity_id') or node_id}",
                    "node_type": attrs.get("node_type") or "entity",
                    "entity_id": attrs.get("entity_id") or node_id,
                    "risk_band": attrs.get("risk_band") or "",
                    "mule_flag_if_applicable": int(_safe_int(attrs.get("mule_flag_if_applicable"), 0)),
                    "cluster_id": node_to_cluster.get(node_id, ""),
                    "is_account": bool(account_id),
                    "account_id": account_id,
                    "is_scored_account": account_id in focus_scores,
                    "mule_risk_score": float(account_state.get("mule_risk_score", 0.0)),
                    "predicted_mule_flag": int(account_state.get("predicted_mule_flag", 0)),
                    "risk_band_output": account_state.get("risk_band_output", ""),
                }
            )
        payload_nodes.sort(key=lambda item: (item.get("cluster_id") or "", 0 if item.get("is_account") else 1, -(item.get("mule_risk_score") or 0.0), item.get("id")))

        summary = {
            "enabled": True,
            "graph_node_count": int(graph.number_of_nodes()),
            "graph_edge_count": int(graph.number_of_edges()),
            "rings_detected": int(sum(1 for item in cluster_summaries if item.get("account_count", 0) > 1)),
            "max_cluster_size": int(max((item.get("account_count", 0) for item in cluster_summaries), default=0)),
            "accounts_with_shared_devices": int(sum(1 for account_id in account_ids if shared_device_links.get(account_id, 0) > 0)),
            "highest_graph_risk_score": float(graph_rows["graph_risk_score"].max() if not graph_rows.empty else 0.0),
            "top_clusters": cluster_summaries[:max_clusters],
        }

        payload = {
            "nodes": payload_nodes,
            "links": selected_edges,
            "clusters": cluster_summaries[:max_clusters],
            "focus_cluster_id": focus_cluster_ids[0] if focus_cluster_ids else "",
            "truncated": bool(truncated),
        }
        return {"enabled": True, "summary": summary, "rows": graph_rows, "payload": payload}
