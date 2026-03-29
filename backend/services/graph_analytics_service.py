from collections import defaultdict, deque
from datetime import datetime


class GraphAnalyticsService:
    def _build_adjacency(self, nodes, links):
        undirected = defaultdict(set)
        directed = defaultdict(list)
        edge_lookup = {}
        for link in links:
            source = str(link.get("source") or "")
            target = str(link.get("target") or "")
            if not source or not target:
                continue
            undirected[source].add(target)
            undirected[target].add(source)
            directed[source].append(target)
            edge_lookup[(source, target)] = link
        for node in nodes:
            undirected.setdefault(str(node.get("id") or ""), set())
            directed.setdefault(str(node.get("id") or ""), [])
        return undirected, directed, edge_lookup

    def _connected_components(self, adjacency):
        visited = set()
        components = []
        for node_id in adjacency:
            if node_id in visited:
                continue
            queue = deque([node_id])
            component = []
            visited.add(node_id)
            while queue:
                current = queue.popleft()
                component.append(current)
                for neighbour in adjacency[current]:
                    if neighbour in visited:
                        continue
                    visited.add(neighbour)
                    queue.append(neighbour)
            components.append(component)
        return sorted(components, key=len, reverse=True)

    def _degree_centrality(self, adjacency):
        total = max(1, len(adjacency) - 1)
        return {
            node_id: round(len(neighbours) / total, 4)
            for node_id, neighbours in adjacency.items()
        }

    def _betweenness_centrality(self, adjacency):
        nodes = list(adjacency.keys())
        centrality = {node: 0.0 for node in nodes}
        for source in nodes:
            stack = []
            predecessors = {node: [] for node in nodes}
            sigma = dict.fromkeys(nodes, 0.0)
            sigma[source] = 1.0
            distance = dict.fromkeys(nodes, -1)
            distance[source] = 0
            queue = deque([source])
            while queue:
                vertex = queue.popleft()
                stack.append(vertex)
                for neighbour in adjacency[vertex]:
                    if distance[neighbour] < 0:
                        queue.append(neighbour)
                        distance[neighbour] = distance[vertex] + 1
                    if distance[neighbour] == distance[vertex] + 1:
                        sigma[neighbour] += sigma[vertex]
                        predecessors[neighbour].append(vertex)

            dependency = dict.fromkeys(nodes, 0.0)
            while stack:
                node = stack.pop()
                for predecessor in predecessors[node]:
                    if sigma[node]:
                        dependency[predecessor] += (sigma[predecessor] / sigma[node]) * (1 + dependency[node])
                if node != source:
                    centrality[node] += dependency[node]

        scale = 1 / max(1, (len(nodes) - 1) * (len(nodes) - 2))
        return {node: round(value * scale, 4) for node, value in centrality.items()}

    def _shortest_path(self, adjacency, start, end):
        start = str(start or "")
        end = str(end or "")
        if not start or not end or start not in adjacency or end not in adjacency:
            return []
        queue = deque([[start]])
        visited = {start}
        while queue:
            path = queue.popleft()
            current = path[-1]
            if current == end:
                return path
            for neighbour in adjacency[current]:
                if neighbour in visited:
                    continue
                visited.add(neighbour)
                queue.append(path + [neighbour])
        return []

    def _detect_cycles(self, directed):
        cycles = []
        path = []
        visiting = set()
        visited = set()

        def dfs(node, depth=0):
            if depth > 6:
                return
            visiting.add(node)
            path.append(node)
            for neighbour in directed.get(node, []):
                if neighbour in visiting:
                    cycle = path[path.index(neighbour):] + [neighbour]
                    if len(cycle) > 2:
                        cycles.append(cycle)
                elif neighbour not in visited:
                    dfs(neighbour, depth + 1)
            path.pop()
            visiting.discard(node)
            visited.add(node)

        for node in directed:
            if node not in visited:
                dfs(node)

        deduped = []
        seen = set()
        for cycle in cycles:
            key = tuple(sorted(cycle))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(cycle)
        return deduped[:10]

    def _temporal_signals(self, links):
        timestamps = []
        for link in links:
            raw = link.get("timestamp")
            if not raw:
                continue
            try:
                timestamps.append(datetime.fromisoformat(str(raw).replace("Z", "+00:00")))
            except Exception:
                continue
        timestamps.sort()
        if len(timestamps) < 3:
            return {"bursts": [], "burst_count": 0}
        bursts = []
        current = [timestamps[0]]
        for ts in timestamps[1:]:
            if (ts - current[-1]).total_seconds() <= 6 * 3600:
                current.append(ts)
            else:
                if len(current) >= 3:
                    bursts.append((current[0], current[-1], len(current)))
                current = [ts]
        if len(current) >= 3:
            bursts.append((current[0], current[-1], len(current)))
        return {
            "bursts": [
                {
                    "start": item[0].isoformat(),
                    "end": item[1].isoformat(),
                    "count": item[2],
                }
                for item in bursts[:5]
            ],
            "burst_count": len(bursts),
        }

    def analyze(self, graph_payload):
        graph = graph_payload.get("graph") or {}
        nodes = list(graph.get("nodes") or [])
        links = list(graph.get("links") or [])
        focal_account_id = str(graph_payload.get("focal_account_id") or "")

        adjacency, directed, edge_lookup = self._build_adjacency(nodes, links)
        node_lookup = {str(node.get("id") or ""): node for node in nodes}
        components = self._connected_components(adjacency)
        degree = self._degree_centrality(adjacency)
        betweenness = self._betweenness_centrality(adjacency)
        cycles = self._detect_cycles(directed)
        temporal = self._temporal_signals(links)

        inbound = defaultdict(set)
        outbound = defaultdict(set)
        for link in links:
            source = str(link.get("source") or "")
            target = str(link.get("target") or "")
            if source and target:
                outbound[source].add(target)
                inbound[target].add(source)

        hubs = sorted(
            [
                {
                    "node_id": node_id,
                    "label": node_lookup.get(node_id, {}).get("label") or node_id,
                    "degree_centrality": degree.get(node_id, 0),
                    "txn_count": node_lookup.get(node_id, {}).get("txn_count") or 0,
                    "type": node_lookup.get(node_id, {}).get("type"),
                }
                for node_id in adjacency
                if len(adjacency[node_id]) >= 3
            ],
            key=lambda item: (item["degree_centrality"], item["txn_count"]),
            reverse=True,
        )[:10]

        bridges = sorted(
            [
                {
                    "node_id": node_id,
                    "label": node_lookup.get(node_id, {}).get("label") or node_id,
                    "betweenness": betweenness.get(node_id, 0),
                    "type": node_lookup.get(node_id, {}).get("type"),
                }
                for node_id in adjacency
                if betweenness.get(node_id, 0) > 0
            ],
            key=lambda item: item["betweenness"],
            reverse=True,
        )[:10]

        collectors = []
        distributors = []
        for node_id in adjacency:
            many_in = len(inbound.get(node_id, set()))
            many_out = len(outbound.get(node_id, set()))
            if many_in >= 3:
                collectors.append({"node_id": node_id, "label": node_lookup.get(node_id, {}).get("label") or node_id, "source_count": many_in})
            if many_out >= 3:
                distributors.append({"node_id": node_id, "label": node_lookup.get(node_id, {}).get("label") or node_id, "target_count": many_out})

        high_risk_entities = []
        for node in nodes:
            score = float(node.get("risk_score") or 0)
            if score >= 60 or node.get("pep_flag") or node.get("sanctions_flag") or node.get("adverse_media_flag"):
                high_risk_entities.append(
                    {
                        "node_id": node.get("id"),
                        "label": node.get("label"),
                        "entity_type": node.get("type"),
                        "risk_score": score,
                        "flags": [
                            label for label, flag in (
                                ("PEP", node.get("pep_flag")),
                                ("Sanctions", node.get("sanctions_flag")),
                                ("Adverse Media", node.get("adverse_media_flag")),
                            ) if flag
                        ],
                    }
                )
        high_risk_entities = sorted(high_risk_entities, key=lambda item: item.get("risk_score") or 0, reverse=True)[:10]

        matrix_nodes = [item["node_id"] for item in hubs[:5]] or [node.get("id") for node in nodes[:5]]
        relationship_matrix = []
        for row_id in matrix_nodes:
            row = {"node_id": row_id, "label": node_lookup.get(row_id, {}).get("label") or row_id, "links": []}
            for col_id in matrix_nodes:
                if row_id == col_id:
                    score = len(adjacency.get(row_id, set()))
                else:
                    score = 1 if col_id in adjacency.get(row_id, set()) else 0
                row["links"].append({"target_id": col_id, "score": score})
            relationship_matrix.append(row)

        shortest_paths = []
        risky_targets = [item["node_id"] for item in (bridges[:3] + hubs[:3]) if item["node_id"] != focal_account_id]
        focal_node_id = f"ACCOUNT::{focal_account_id}" if focal_account_id and not focal_account_id.startswith("ACCOUNT::") else focal_account_id
        for target in risky_targets[:4]:
            path = self._shortest_path(adjacency, focal_node_id, target)
            if path:
                shortest_paths.append(
                    {
                        "start": focal_node_id,
                        "end": target,
                        "path": path,
                        "path_labels": [node_lookup.get(item, {}).get("label") or item for item in path],
                        "length": max(0, len(path) - 1),
                    }
                )

        visible_component = next((component for component in components if focal_node_id in component), components[:1] or [[]])
        return {
            "connected_components": components,
            "component_count": len(components),
            "visible_component_size": len(visible_component),
            "degree_centrality": degree,
            "betweenness_centrality": betweenness,
            "hubs": hubs,
            "bridges": bridges,
            "collectors": collectors[:6],
            "distributors": distributors[:6],
            "cycles": cycles,
            "temporal_signals": temporal,
            "high_risk_entities": high_risk_entities,
            "relationship_matrix": relationship_matrix,
            "shortest_paths": shortest_paths,
        }
