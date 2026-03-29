import json
from collections import Counter

from services.case_comparison_service import CaseComparisonService
from services.case_similarity_service import CaseSimilarityService
from services.network_report_adapter_service import NetworkReportAdapterService
from services.typology_history_service import TypologyHistoryService
from services.typology_report_adapter_service import TypologyReportAdapterService


class CaseDataAggregator:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.similarity_service = CaseSimilarityService(db_manager)
        self.comparison_service = CaseComparisonService(db_manager)
        self.network_adapter = NetworkReportAdapterService()
        self.typology_history = TypologyHistoryService()
        self.typology_adapter = TypologyReportAdapterService()

    def aggregate_case(self, case_id, analyst_name="Analyst"):
        conn = self.db_manager.connect()
        try:
            cursor = conn.cursor()
            case_row = self._load_case_row(cursor, case_id)
            alerts = self._load_alerts(cursor, case_id)
            transactions = self._load_transactions(cursor, case_id)
            support_file = self._load_support_file(cursor, case_id)
            source_payload = support_file.get("source_payload") if isinstance(support_file.get("source_payload"), dict) else {}

            total_amount = round(sum(float(item.get("amount") or 0) for item in transactions), 2)
            top_counterparties = Counter(str(item.get("counterparty") or "-") for item in transactions if item.get("counterparty")).most_common(5)
            rules = [str(item.get("rule") or "-") for item in alerts if item.get("rule")]
            similar = self._load_similar_cases(case_id)
            comparison = self._load_comparison(case_id, similar)

            evidence_items = support_file.get("evidence_items") or []
            indicator_list = [str(item.get("title") or item.get("why_it_matters") or "").strip() for item in evidence_items if str(item.get("title") or item.get("why_it_matters") or "").strip()]
            graph_payload = source_payload.get("graph") or {}
            lineage_payload = source_payload.get("lineage") or {}
            baseline_payload = source_payload.get("baseline") or {}
            ai_review = support_file.get("ai_review") or source_payload.get("ai_review") or {}
            saved_network = self.network_adapter.load_case_result(cursor, case_id)
            network_report = self.network_adapter.to_report_payload((saved_network or {}).get("payload") or {})
            saved_typology = self.typology_history.load_case_result(cursor, case_id)
            typology_report = self.typology_adapter.to_report_payload((saved_typology or {}).get("payload") or {})

            report_case = {
                "case_id": case_id,
                "cover": {
                    "case_id": case_id,
                    "customer_id": case_row.get("customer_id") or "-",
                    "account_id": case_row.get("account_id") or "-",
                    "risk_level": case_row.get("severity") or case_row.get("risk_tier") or "Pending",
                    "status": case_row.get("status") or support_file.get("decision", {}).get("analyst_status") or "Under Investigation",
                    "generated_date": self._now(),
                    "analyst_name": analyst_name,
                },
                "case_overview": {
                    "metadata": case_row,
                    "alerts": alerts,
                    "timeline": {
                        "created_at": case_row.get("created_at") or case_row.get("opened_at") or "-",
                        "updated_at": case_row.get("last_updated") or case_row.get("updated_at") or "-",
                        "resolved_at": case_row.get("closed_at") or support_file.get("audit", {}).get("updated_at") or "-",
                    },
                    "status": case_row.get("status") or support_file.get("decision", {}).get("analyst_status") or "Under Investigation",
                    "risk_level": case_row.get("severity") or case_row.get("risk_tier") or "Pending",
                },
                "evidence_summary": {
                    "indicator_list": indicator_list[:8],
                    "evidence_items": evidence_items[:10],
                    "narrative_seed": support_file.get("investigation_summary", {}).get("text") or "",
                },
                "transaction_ledger": {
                    "rows": transactions[:18],
                    "total_amount": total_amount,
                    "count": len(transactions),
                    "peak_activity": max([float(item.get("amount") or 0) for item in transactions], default=0),
                    "patterns": self._derive_patterns(transactions, baseline_payload, graph_payload),
                    "top_counterparties": [{"name": name, "count": count} for name, count in top_counterparties],
                },
                "copilot_insights": {
                    "risk_score": support_file.get("summary", {}).get("risk_score") or case_row.get("risk_score"),
                    "risk_profile": support_file.get("hypothesis", {}).get("pattern") or "Analyst review required",
                    "risk_drivers": support_file.get("case_synthesis", {}).get("supports_suspicion") or ai_review.get("draft_reasoning") or "",
                    "next_steps": support_file.get("case_synthesis", {}).get("requires_validation") or "",
                    "missing_evidence": support_file.get("case_synthesis", {}).get("weakens_suspicion") or "",
                },
                "lineage": {
                    "origin_chain": self._origin_chain(case_row, alerts, transactions),
                    "summary": lineage_payload.get("evidence_summary") or {},
                    "narrative": graph_payload.get("narrative") or lineage_payload.get("summary") or "Lineage and graph findings were not fully materialized for this case.",
                },
                "similar_cases": {
                    "matches": similar,
                    "comparison": comparison,
                },
                "graph_summary": {
                    "narrative": network_report.get("graph_summary") or graph_payload.get("narrative") or "Graph review did not return a narrative summary for this case.",
                    "entities": self._count_graph_entities(graph_payload) or len(network_report.get("top_entities") or []),
                    "clusters": len(network_report.get("suspicious_clusters") or []) or self._count_graph_clusters(graph_payload),
                    "central_nodes": [item.get("label") for item in (network_report.get("top_entities") or [])[:5]] or self._graph_central_nodes(graph_payload),
                    "hub_entities": network_report.get("hub_entities") or [],
                    "bridge_entities": network_report.get("bridge_entities") or [],
                    "visibility_limitations": network_report.get("visibility_limitations") or "",
                    "path_highlights": network_report.get("path_highlights") or [],
                    "network_risk_assessment": network_report.get("network_risk_assessment") or {},
                },
                "rule_typology": {
                    "rules": list(dict.fromkeys(rules))[:10],
                    "typologies": typology_report.get("supporting_typologies") or self._derive_typologies(case_row, support_file, rules),
                    "summary": typology_report or source_payload.get("case_pack", {}).get("typology_flags") or {},
                    "primary_typology": typology_report.get("primary_typology") or "",
                },
                "resolution": {
                    "final_action": support_file.get("decision", {}).get("final_action") or case_row.get("status") or "Pending",
                    "analyst_comments": support_file.get("analyst_notes") or "",
                    "justification": support_file.get("decision", {}).get("rationale") or "",
                    "escalation_reason": case_row.get("escalated_to") or "",
                    "sar_status": support_file.get("decision", {}).get("sar_status") or "Not Started",
                    "sar_accepted_at": support_file.get("decision", {}).get("sar_accepted_at") or "",
                    "sar_accepted_by": support_file.get("decision", {}).get("sar_accepted_by") or "",
                    "accepted_sar_draft": support_file.get("decision", {}).get("accepted_sar_draft") or support_file.get("sar_draft") or "",
                },
                "appendix": {
                    "alert_table": alerts[:12],
                    "transaction_table": transactions[:12],
                    "feature_summary": {
                        "risk_score": support_file.get("summary", {}).get("risk_score") or case_row.get("risk_score"),
                        "alert_count": len(alerts),
                        "transaction_count": len(transactions),
                        "total_amount": total_amount,
                    },
                    "source_metadata": {
                        "pipeline_name": case_row.get("source_pipeline_name") or "-",
                        "publish_label": case_row.get("source_publish_label") or "-",
                        "branch": case_row.get("branch_code") or "-",
                        "region": case_row.get("region") or "-",
                    },
                },
                "support_file": support_file,
            }

            report_case["llm_payload"] = {
                "case_id": case_id,
                "cover": report_case["cover"],
                "case_overview": report_case["case_overview"],
                "evidence_summary": report_case["evidence_summary"],
                "transaction_summary": report_case["transaction_ledger"],
                "copilot_insights": report_case["copilot_insights"],
                "lineage": report_case["lineage"],
                "similar_cases": report_case["similar_cases"],
                "graph_summary": report_case["graph_summary"],
                "rule_typology": report_case["rule_typology"],
                "resolution": report_case["resolution"],
            }
            return report_case
        finally:
            conn.close()

    def _now(self):
        from datetime import datetime
        return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

    def _table_exists(self, cursor, table_name):
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", (table_name,))
        return bool(cursor.fetchone())

    def _find_column(self, columns, candidates):
        lowered = {str(col).lower(): str(col) for col in columns}
        for name in candidates:
            if name.lower() in lowered:
                return lowered[name.lower()]
        return None

    def _quoted_columns(self, columns):
        return ", ".join([f'"{col}"' for col in columns if col])

    def _load_case_row(self, cursor, case_id):
        result = {
            "case_id": case_id,
            "customer_id": "-",
            "account_id": "-",
            "status": "Under Investigation",
            "risk_score": None,
            "severity": "Pending",
            "branch_code": "-",
            "region": "-",
            "scenario_name": "-",
            "alert_type": "-",
            "source_pipeline_name": "-",
            "source_publish_label": "-",
            "created_at": "-",
            "last_updated": "-",
            "closed_at": "-",
        }
        if not self._table_exists(cursor, "cases"):
            return result
        cursor.execute('PRAGMA table_info("cases")')
        columns = [row[1] for row in cursor.fetchall()]
        case_id_col = self._find_column(columns, ["CASE_ID", "case_id", "caseid"])
        if not case_id_col:
            return result
        candidate_map = {
            "customer_id": ["CUSTOMER_ID", "customer_id"],
            "account_id": ["ACCOUNT_ID", "account_id"],
            "status": ["STATUS", "status", "current_status"],
            "risk_score": ["RISK_SCORE", "risk_score"],
            "severity": ["SEVERITY", "severity", "risk_rating", "risk_level"],
            "branch_code": ["BRANCH_CODE", "branch_code", "branch"],
            "region": ["REGION", "region"],
            "scenario_name": ["SCENARIO_NAME", "scenario_name", "ALERT_NAME", "alert_name"],
            "alert_type": ["ALERT_TYPE", "alert_type", "RULE_TRIGGERED", "rule_triggered"],
            "source_pipeline_name": ["FCC_PIPELINE_NAME", "pipeline_name", "source_pipeline_name"],
            "source_publish_label": ["FCC_PUBLISH_LABEL", "publish_label", "source_publish_label"],
            "created_at": ["CREATED_AT", "created_at", "case_open_date", "opened_at"],
            "last_updated": ["LAST_UPDATED_AT", "updated_at", "last_updated"],
            "closed_at": ["CLOSED_AT", "closed_at"],
        }
        selected = [case_id_col]
        aliases = {}
        for target, candidates in candidate_map.items():
            found = self._find_column(columns, candidates)
            if found:
                selected.append(found)
                aliases[target] = found
        cursor.execute(
            f'SELECT {self._quoted_columns(selected)} FROM "cases" WHERE "{case_id_col}" = ? LIMIT 1',
            (case_id,),
        )
        row = cursor.fetchone()
        if not row:
            return result
        payload = dict(zip(selected, row))
        for target, source_col in aliases.items():
            result[target] = payload.get(source_col) if payload.get(source_col) not in (None, "") else result.get(target)
        return result

    def _load_alerts(self, cursor, case_id):
        if not self._table_exists(cursor, "alerts"):
            return []
        cursor.execute('PRAGMA table_info("alerts")')
        columns = [row[1] for row in cursor.fetchall()]
        case_id_col = self._find_column(columns, ["CASE_ID", "case_id", "caseid"])
        if not case_id_col:
            return []
        alert_id_col = self._find_column(columns, ["ALERT_ID", "alert_id"])
        rule_col = self._find_column(columns, ["RULE_TRIGGERED", "rule_triggered", "ALERT_TYPE", "alert_type"])
        date_col = self._find_column(columns, ["ALERT_DATE", "alert_date", "created_at"])
        risk_col = self._find_column(columns, ["RISK_SCORE", "risk_score", "severity"])
        selected = [col for col in [alert_id_col, rule_col, date_col, risk_col] if col]
        if not selected:
            return []
        order_col = date_col or selected[0]
        cursor.execute(
            f'SELECT {self._quoted_columns(selected)} FROM "alerts" WHERE "{case_id_col}" = ? ORDER BY "{order_col}" DESC LIMIT 20',
            (case_id,),
        )
        rows = cursor.fetchall()
        results = []
        for row in rows:
            payload = dict(zip(selected, row))
            results.append({
                "alert_id": payload.get(alert_id_col) if alert_id_col else "-",
                "rule": payload.get(rule_col) if rule_col else "-",
                "date": payload.get(date_col) if date_col else "-",
                "risk_score": payload.get(risk_col) if risk_col else None,
            })
        return results

    def _load_transactions(self, cursor, case_id):
        if not self._table_exists(cursor, "transactions"):
            return []
        cursor.execute('PRAGMA table_info("transactions")')
        columns = [row[1] for row in cursor.fetchall()]
        case_id_col = self._find_column(columns, ["CASE_ID", "case_id", "caseid"])
        if not case_id_col:
            return []
        ref_col = self._find_column(columns, ["TRANSACTION_ID", "transaction_id", "reference"])
        date_col = self._find_column(columns, ["TXN_TIMESTAMP", "txn_timestamp", "date", "ts"])
        amount_col = self._find_column(columns, ["TXN_AMOUNT", "txn_amount", "amount"])
        type_col = self._find_column(columns, ["TXN_TYPE", "txn_type", "type"])
        channel_col = self._find_column(columns, ["CHANNEL", "channel"])
        counterparty_col = self._find_column(columns, ["COUNTERPARTY", "counterparty", "BENEFICIARY_NAME", "beneficiary_name", "BENEFICIARY_COUNTRY"])
        selected = [col for col in [ref_col, date_col, amount_col, type_col, counterparty_col, channel_col] if col]
        if not selected:
            return []
        order_col = date_col or ref_col or selected[0]
        cursor.execute(
            f'SELECT {self._quoted_columns(selected)} FROM "transactions" WHERE "{case_id_col}" = ? ORDER BY "{order_col}" DESC LIMIT 50',
            (case_id,),
        )
        rows = cursor.fetchall()
        results = []
        for row in rows:
            payload = dict(zip(selected, row))
            results.append({
                "reference": payload.get(ref_col) if ref_col else "-",
                "date": payload.get(date_col) if date_col else "-",
                "amount": float(payload.get(amount_col) or 0),
                "type": payload.get(type_col) if type_col else "-",
                "counterparty": payload.get(counterparty_col) if counterparty_col else "-",
                "channel": payload.get(channel_col) if channel_col else "-",
            })
        return results

    def _load_support_file(self, cursor, case_id):
        if not self._table_exists(cursor, "case_resolution_workspaces"):
            return {}
        cursor.execute(
            """
            SELECT support_file_json, sar_draft
            FROM case_resolution_workspaces
            WHERE case_id = ?
            """,
            (case_id,),
        )
        row = cursor.fetchone()
        if not row:
            return {}
        payload = {}
        try:
            payload = json.loads(row[0] or "{}")
        except Exception:
            payload = {}
        if row[1] and not payload.get("sar_draft"):
            payload["sar_draft"] = row[1]
        return payload

    def _load_similar_cases(self, case_id):
        try:
            result = self.similarity_service.retrieve_similar_cases(case_id, mode="hybrid", top_k=3, threshold=0.15)
            return result.get("results", [])
        except Exception:
            return []

    def _load_comparison(self, case_id, similar_cases):
        if not similar_cases:
            return {}
        top_case = similar_cases[0].get("case_id")
        if not top_case:
            return {}
        try:
            return self.comparison_service.compare_cases([case_id, top_case], base_case_id=case_id)
        except Exception:
            return {}

    def _derive_patterns(self, transactions, baseline_payload, graph_payload):
        patterns = []
        if len(transactions) >= 5:
            patterns.append("Elevated suspicious transaction count")
        if sum(1 for item in transactions if float(item.get("amount") or 0) > 50000) >= 2:
            patterns.append("Repeated higher-value activity")
        if baseline_payload.get("deviations"):
            patterns.append("Baseline deviation observed")
        if graph_payload.get("narrative"):
            patterns.append("Graph linkage findings available")
        return patterns or ["Pattern review pending"]

    def _origin_chain(self, case_row, alerts, transactions):
        return {
            "rule_to_alert": ", ".join(sorted(set(item.get("rule") or "-" for item in alerts[:5]))),
            "alert_to_transaction": transactions[0].get("reference") if transactions else "-",
            "transaction_to_account": case_row.get("account_id") or "-",
            "account_to_customer": case_row.get("customer_id") or "-",
        }

    def _count_graph_entities(self, graph_payload):
        nodes = ((graph_payload.get("graph") or {}).get("nodes") or graph_payload.get("nodes") or [])
        return len(nodes)

    def _count_graph_clusters(self, graph_payload):
        clusters = ((graph_payload.get("graph") or {}).get("clusters") or graph_payload.get("clusters") or [])
        return len(clusters) if isinstance(clusters, list) else 0

    def _graph_central_nodes(self, graph_payload):
        nodes = ((graph_payload.get("graph") or {}).get("nodes") or graph_payload.get("nodes") or [])[:5]
        results = []
        for node in nodes:
            if isinstance(node, dict):
                results.append(node.get("label") or node.get("id") or "Node")
        return results

    def _derive_typologies(self, case_row, support_file, rules):
        typologies = []
        hypothesis = str((support_file.get("hypothesis") or {}).get("pattern") or "").strip()
        if hypothesis:
            typologies.append(hypothesis)
        for rule in rules:
            text = str(rule).lower()
            if "structur" in text:
                typologies.append("Structuring")
            if "layer" in text:
                typologies.append("Layering")
            if "mule" in text:
                typologies.append("Mule Activity")
            if "rapid" in text or "pass" in text:
                typologies.append("Pass-Through")
        scenario_name = str(case_row.get("scenario_name") or "")
        if "funnel" in scenario_name.lower():
            typologies.append("Funnel Behavior")
        return list(dict.fromkeys([item for item in typologies if item]))[:6]
