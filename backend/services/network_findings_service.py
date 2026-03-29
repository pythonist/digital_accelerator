class NetworkFindingsService:
    def _network_risk_score(self, analytics, visibility):
        score = 20
        score += min(len(analytics.get("hubs") or []) * 8, 20)
        score += min(len(analytics.get("bridges") or []) * 10, 20)
        score += 15 if analytics.get("collectors") or analytics.get("distributors") else 0
        score += 18 if analytics.get("cycles") else 0
        score += min((analytics.get("temporal_signals") or {}).get("burst_count", 0) * 6, 12)
        score += min(len(analytics.get("high_risk_entities") or []) * 4, 12)
        if visibility.get("external_visibility_limited"):
            score -= 5
        return max(0, min(int(round(score)), 100))

    def build(self, case_id, graph_payload, analytics):
        graph = graph_payload.get("graph") or {}
        nodes = list(graph.get("nodes") or [])
        links = list(graph.get("links") or [])
        visibility = graph_payload.get("visibility") or {}

        risk_score = self._network_risk_score(analytics, visibility)
        funnel_flag = bool(analytics.get("collectors") or analytics.get("distributors"))
        circular_flag = bool(analytics.get("cycles"))
        visibility_note = visibility.get("coverage_note") or "Visibility is limited to currently available internal investigation data."

        suspicious_clusters = [
            component for component in (analytics.get("connected_components") or [])
            if len(component) >= 4
        ][:5]

        kpis = {
            "network_risk_score": risk_score,
            "visible_linked_entities": len(nodes),
            "suspicious_cluster_count": len(suspicious_clusters),
            "hub_entity_count": len(analytics.get("hubs") or []),
            "bridge_entity_count": len(analytics.get("bridges") or []),
            "funnel_pattern_flag": "Observed" if funnel_flag else "Not Observed",
            "circular_flow_flag": "Observed" if circular_flag else "Not Observed",
            "visibility_confidence": visibility.get("confidence") or "Moderate",
        }

        key_findings = []
        if suspicious_clusters:
            key_findings.append({
                "title": f"{len(suspicious_clusters)} suspicious sub-network(s) detected",
                "detail": "The focal case is linked to broader connected components rather than appearing fully isolated.",
                "severity": "high" if len(suspicious_clusters) >= 2 else "medium",
            })
        else:
            key_findings.append({
                "title": "Case appears largely isolated in visible network data",
                "detail": "No strong multi-entity cluster was detected in the currently visible relationship graph.",
                "severity": "low",
            })
        if analytics.get("hubs"):
            key_findings.append({
                "title": f"{len(analytics.get('hubs') or [])} hub entity signal(s) identified",
                "detail": "High-degree entities may represent concentration points, shared beneficiaries, or common destinations.",
                "severity": "medium",
            })
        if analytics.get("bridges"):
            key_findings.append({
                "title": f"{len(analytics.get('bridges') or [])} bridge/intermediary signal(s) identified",
                "detail": "High-betweenness entities may be acting as intermediaries or routing points across suspicious paths.",
                "severity": "high",
            })
        if funnel_flag:
            key_findings.append({
                "title": "Collector or distributor pattern observed",
                "detail": "Many-to-one or one-to-many relationship structures are visible in the current case network.",
                "severity": "high",
            })
        if circular_flag:
            key_findings.append({
                "title": "Circular movement detected in visible graph",
                "detail": "At least one cycle or round-tripping pattern was identified in the currently visible transaction network.",
                "severity": "high",
            })
        if not analytics.get("shortest_paths"):
            key_findings.append({
                "title": "No meaningful bridge path highlighted",
                "detail": "Shortest path analysis did not surface a strong intermediary route from the focal account to a high-risk node.",
                "severity": "low",
            })

        evidence = []
        for hub in (analytics.get("hubs") or [])[:5]:
            evidence.append({
                "type": "Hub Entity",
                "title": hub.get("label"),
                "why_it_matters": "This entity has a high number of direct links and may represent a concentration or collector point.",
                "source_records": [hub.get("node_id")],
                "strength": "Strong" if hub.get("degree_centrality", 0) >= 0.35 else "Moderate",
            })
        for bridge in (analytics.get("bridges") or [])[:5]:
            evidence.append({
                "type": "Bridge Entity",
                "title": bridge.get("label"),
                "why_it_matters": "This entity sits between multiple visible relationships and may link otherwise separate suspicious groups.",
                "source_records": [bridge.get("node_id")],
                "strength": "Strong" if bridge.get("betweenness", 0) >= 0.12 else "Moderate",
            })
        for path in (analytics.get("shortest_paths") or [])[:3]:
            evidence.append({
                "type": "Path Highlight",
                "title": "Visible intermediary path",
                "why_it_matters": "Shortest path analysis identified a visible relationship chain linking the focal account to another relevant network entity.",
                "source_records": path.get("path", []),
                "strength": "Moderate",
            })

        snippets = [
            "Network review identified visible relationship patterns that should be interpreted within the limits of internally available bank data.",
            "Hub, bridge, and cluster signals were reviewed to determine whether the focal case is isolated or connected to broader suspicious activity.",
        ]
        if funnel_flag:
            snippets.append("Collector or distributor behavior was observed, indicating possible funnel or concentration activity within the visible network.")
        if circular_flag:
            snippets.append("Visible graph review identified circular movement signals that may support escalation if corroborated by transaction and case evidence.")

        return {
            "kpis": kpis,
            "key_findings": key_findings,
            "evidence": evidence,
            "report_snippets": snippets,
            "suspicious_clusters": suspicious_clusters,
            "visibility_limitations": visibility_note,
            "network_risk_assessment": {
                "score": risk_score,
                "assessment": "Network evidence supports escalation review." if risk_score >= 70 else (
                    "Network evidence is notable but should be corroborated with non-network evidence." if risk_score >= 45
                    else "Current graph evidence alone does not materially strengthen suspicion."
                ),
            },
        }
