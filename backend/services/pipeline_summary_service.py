from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService
from api.tools.mlops.path_utils import resolve_env_root
from services.case_queue_service import CaseQueueService


class PipelineSummaryService:
    def __init__(self, services: Any, tenant_id: str = "default", env_id: str = ""):
        self.services = services
        self.tenant_id = str(tenant_id or "default")
        self.env_id = str(env_id or "")

    def get_summary(
        self,
        *,
        run_id: Optional[str] = None,
        pipeline_id: Optional[str] = None,
        publish_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        report, resolved_run_id, resolved_pipeline_id = self._load_fcc_report(
            run_id=run_id,
            pipeline_id=pipeline_id,
            publish_id=publish_id,
        )
        sentinel = self._build_sentinel_summary(
            run_id=resolved_run_id,
            pipeline_id=resolved_pipeline_id,
            publish_id=publish_id,
        )

        alert_stats = self._build_alert_stats(report, sentinel)
        hero = self._build_hero(alert_stats, sentinel)
        timeline_steps = self._build_timeline_steps(alert_stats, report, sentinel)

        return {
            "meta": {
                "tenant_id": self.tenant_id,
                "env_id": self.env_id,
                "run_id": resolved_run_id,
                "pipeline_id": resolved_pipeline_id,
                "publish_id": publish_id,
                "generated_at": self._now_iso(),
                "source": "fcc_to_sentinel",
            },
            "hero": hero,
            "alert_stats": alert_stats,
            "timeline_steps": timeline_steps,
            "graph_summary": {
                "headline": hero.get("headline"),
                "subheadline": hero.get("subheadline"),
            },
            "loading_story": [
                "Reading FCC run outcome and workload controls",
                "Reconciling retained-alert flow into Sentinel",
                "Summarizing case decisions and escalation outcomes",
                "Building executive storyline and workflow graph",
            ],
        }

    def get_graph_flow_payload(
        self,
        *,
        run_id: Optional[str] = None,
        pipeline_id: Optional[str] = None,
        publish_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        summary = self.get_summary(run_id=run_id, pipeline_id=pipeline_id, publish_id=publish_id)
        alert_stats = summary.get("alert_stats") or {}
        sentinel = self._build_sentinel_summary(
            run_id=summary.get("meta", {}).get("run_id"),
            pipeline_id=summary.get("meta", {}).get("pipeline_id"),
            publish_id=publish_id,
        )
        return self._build_graph_payload(alert_stats, sentinel)

    def _load_fcc_report(
        self,
        *,
        run_id: Optional[str],
        pipeline_id: Optional[str],
        publish_id: Optional[str],
    ) -> Tuple[Dict[str, Any], str, Optional[str]]:
        if not self.env_id:
            return {}, str(run_id or ""), pipeline_id

        env_root = resolve_env_root(self.env_id, self.tenant_id, create_if_missing=True)
        mlops_db = Path(env_root) / "mlops" / "duckdb" / "mlops.duckdb"
        service = MLOpsWorkbenchService(mlops_db)

        resolved_run_id = str(run_id or "").strip()
        resolved_pipeline_id = str(pipeline_id or "").strip() or None

        if not resolved_run_id:
            scoped = self._infer_scope_from_cases(publish_id=publish_id)
            resolved_run_id = scoped.get("run_id") or ""
            if not resolved_pipeline_id:
                resolved_pipeline_id = scoped.get("pipeline_id")

        if not resolved_run_id:
            candidates = service.list_run_reports(self.tenant_id, self.env_id, limit=50)
            if resolved_pipeline_id:
                candidates = [
                    row for row in candidates
                    if str(row.get("pipeline_id") or "").strip() == str(resolved_pipeline_id)
                ]
            if candidates:
                resolved_run_id = str(candidates[0].get("run_id") or "").strip()
                resolved_pipeline_id = resolved_pipeline_id or str(candidates[0].get("pipeline_id") or "").strip() or None

        if not resolved_run_id:
            return {}, "", resolved_pipeline_id

        report = service.get_run_report(self.tenant_id, self.env_id, resolved_run_id)
        if not report:
            try:
                report = service.generate_run_report(
                    tenant_id=self.tenant_id,
                    env_id=self.env_id,
                    run_id=resolved_run_id,
                    pipeline_id=resolved_pipeline_id,
                )
            except Exception:
                report = {}

        if not isinstance(report, dict):
            report = {}
        return report, resolved_run_id, resolved_pipeline_id

    def _build_sentinel_summary(
        self,
        *,
        run_id: Optional[str],
        pipeline_id: Optional[str],
        publish_id: Optional[str],
    ) -> Dict[str, Any]:
        db_manager = self._get_investigation_db_manager()
        if not db_manager:
            return self._empty_sentinel_summary()

        queue_service = CaseQueueService(db_manager)
        queue_result = queue_service.list_queue({"page": 1, "page_size": 500})
        queue_rows = list(queue_result.get("rows") or [])

        conn = db_manager.connect()
        try:
            cursor = conn.cursor()
            scoped_case_ids, scope_meta = self._resolve_case_scope(
                cursor,
                run_id=run_id,
                pipeline_id=pipeline_id,
                publish_id=publish_id,
            )
            if scoped_case_ids:
                case_id_set = set(scoped_case_ids)
                queue_rows = [row for row in queue_rows if str(row.get("case_id") or "") in case_id_set]
            support_files = self._load_support_files(cursor, scoped_case_ids)
            case_rows = self._load_case_rows(cursor, scoped_case_ids)
        finally:
            db_manager.close_connection(conn)

        total_cases = len(queue_rows)
        statuses = Counter(str(row.get("current_status") or "Open") for row in queue_rows)
        stages = Counter(str(row.get("current_stage") or "Detection") for row in queue_rows)
        decision_rows = [
            row for row in queue_rows
            if str(row.get("current_status") or "") in {
                "Draft Prepared",
                "Pending L2 Review",
                "Pending BM Review",
                "Pending Vigilance Review",
                "Escalated",
                "Awaiting Response",
                "SAR Recommended",
                "Closed",
                "Rejected / No Further Action",
            }
        ]

        accepted_sar = 0
        drafted_sar = 0
        risk_driver_counter: Counter[str] = Counter()
        typology_counter: Counter[str] = Counter()
        scenario_counter: Counter[str] = Counter()
        for support in support_files.values():
            decision = support.get("decision") if isinstance(support.get("decision"), dict) else {}
            sar_status = str(decision.get("sar_status") or "").strip().lower()
            if sar_status == "accepted":
                accepted_sar += 1
            if support.get("sar_draft"):
                drafted_sar += 1
            for item in self._normalize_list((support.get("case_synthesis") or {}).get("supports_suspicion")):
                risk_driver_counter[item] += 1
            hypothesis = str((support.get("hypothesis") or {}).get("pattern") or "").strip()
            if hypothesis:
                typology_counter[hypothesis] += 1

        for case_row in case_rows:
            scenario_name = str(case_row.get("scenario_name") or case_row.get("alert_type") or "").strip()
            if scenario_name:
                scenario_counter[scenario_name] += 1

        if not risk_driver_counter:
            for scenario_name, count in scenario_counter.most_common(5):
                risk_driver_counter[self._friendly_scenario(scenario_name)] += count
        if not typology_counter and risk_driver_counter:
            for label, count in risk_driver_counter.most_common(4):
                typology_counter[label] += count

        limited_visibility = total_cases == 0 or not support_files
        visibility_note = (
            "Sentinel findings are based on the imported FCC case scope and the bank-visible investigation data available in this environment."
            if not limited_visibility
            else "Sentinel visibility is currently limited because only a small or empty case scope is available for this run."
        )

        return {
            "scope_meta": scope_meta,
            "queue_rows": queue_rows,
            "support_files": support_files,
            "case_rows": case_rows,
            "total_cases": total_cases,
            "statuses": statuses,
            "stages": stages,
            "cases_reviewed": sum(1 for row in queue_rows if str(row.get("current_status") or "") != "Open"),
            "cases_investigated": sum(1 for row in queue_rows if str(row.get("current_stage") or "") in {"Investigation", "Evidence Review", "Resolution Draft", "Escalation", "Final Decision", "Closure"}),
            "cases_in_decision": len(decision_rows),
            "closed_cases": statuses.get("Closed", 0) + statuses.get("Rejected / No Further Action", 0),
            "escalated_cases": statuses.get("Escalated", 0) + statuses.get("Pending L2 Review", 0) + statuses.get("Pending BM Review", 0) + statuses.get("Pending Vigilance Review", 0),
            "awaiting_response": statuses.get("Awaiting Response", 0),
            "sar_recommended": statuses.get("SAR Recommended", 0),
            "sar_drafted": drafted_sar,
            "sar_accepted": accepted_sar,
            "top_risk_drivers": [item for item, _ in risk_driver_counter.most_common(5)],
            "top_typologies": [item for item, _ in typology_counter.most_common(4)],
            "top_scenarios": [item for item, _ in scenario_counter.most_common(4)],
            "visibility_note": visibility_note,
        }

    def _build_alert_stats(self, report: Dict[str, Any], sentinel: Dict[str, Any]) -> Dict[str, Any]:
        impact = report.get("business_impact") if isinstance(report.get("business_impact"), dict) else {}
        threshold = report.get("threshold_analysis") if isinstance(report.get("threshold_analysis"), dict) else {}
        data_summary = report.get("data_summary") if isinstance(report.get("data_summary"), dict) else {}
        narratives = report.get("narratives") if isinstance(report.get("narratives"), dict) else {}

        total_alerts = self._to_int(impact.get("total_alerts")) or self._to_int(data_summary.get("total_rows"))
        suppressed = self._to_int(impact.get("alerts_suppressed"))
        remaining = self._to_int(impact.get("alerts_escalated"))
        workload_reduction_pct = self._to_float(impact.get("workload_reduction_pct"))
        estimated_risk_missed_pct = self._to_float(impact.get("event_loss_pct")) or self._to_float(threshold.get("recommended_event_loss_pct"))
        threshold_value = self._to_float(threshold.get("recommended_threshold"), 0.5)

        retained_pct = round((remaining / total_alerts) * 100.0, 1) if total_alerts else 0.0
        decision_goal = str(narratives.get("problem") or narratives.get("impact") or "").strip()

        return {
            "total_alerts": total_alerts,
            "suppressed": suppressed,
            "remaining": remaining,
            "retained_pct": retained_pct,
            "workload_reduction_pct": workload_reduction_pct,
            "estimated_risk_missed_pct": estimated_risk_missed_pct,
            "threshold": threshold_value,
            "cases_reviewed": self._to_int(sentinel.get("cases_reviewed")),
            "sar_recommended": self._to_int(sentinel.get("sar_recommended")),
            "escalated_cases": self._to_int(sentinel.get("escalated_cases")),
            "decision_goal": decision_goal,
            "labelled_rows": self._to_int(data_summary.get("labelled_rows")),
            "str_rate_overall_pct": round(self._to_float(data_summary.get("str_rate_overall")) * 100.0, 2) if data_summary.get("str_rate_overall") is not None else None,
        }

    def _build_hero(self, alert_stats: Dict[str, Any], sentinel: Dict[str, Any]) -> Dict[str, Any]:
        total_alerts = self._to_int(alert_stats.get("total_alerts"))
        suppressed = self._to_int(alert_stats.get("suppressed"))
        remaining = self._to_int(alert_stats.get("remaining"))
        workload_reduction_pct = self._to_float(alert_stats.get("workload_reduction_pct"))
        cases_reviewed = self._to_int(sentinel.get("cases_reviewed"))
        escalated_cases = self._to_int(sentinel.get("escalated_cases"))
        sar_recommended = self._to_int(sentinel.get("sar_recommended"))

        return {
            "headline": "FCC reduced alert noise before Sentinel investigation, then Sentinel turned the retained workload into reviewed decisions and escalation actions.",
            "subheadline": (
                f"FCC reviewed {total_alerts:,} alerts, removed {suppressed:,} lower-value cases from manual effort, "
                f"and forwarded {remaining:,} alerts into Sentinel. Sentinel has already reviewed {cases_reviewed:,} cases, "
                f"with {escalated_cases:,} escalations and {sar_recommended:,} SAR recommendations or near-final decisions in scope."
            ),
            "phase_kpis": [
                {"phase": "FCC", "label": "Workload removed before investigation", "value": f"{workload_reduction_pct:.1f}%", "tone": "positive"},
                {"phase": "Bridge", "label": "Alerts forwarded into Sentinel", "value": f"{remaining:,}", "tone": "warning"},
                {"phase": "Sentinel", "label": "Cases already reviewed", "value": f"{cases_reviewed:,}", "tone": "default"},
                {"phase": "Decision", "label": "Escalations and SAR actions", "value": f"{(escalated_cases + sar_recommended):,}", "tone": "risk"},
            ],
        }

    def _build_timeline_steps(self, alert_stats: Dict[str, Any], report: Dict[str, Any], sentinel: Dict[str, Any]) -> List[Dict[str, Any]]:
        threshold = report.get("threshold_analysis") if isinstance(report.get("threshold_analysis"), dict) else {}
        narratives = report.get("narratives") if isinstance(report.get("narratives"), dict) else {}
        total_alerts = self._to_int(alert_stats.get("total_alerts"))
        suppressed = self._to_int(alert_stats.get("suppressed"))
        remaining = self._to_int(alert_stats.get("remaining"))
        workload_reduction_pct = self._to_float(alert_stats.get("workload_reduction_pct"))
        event_loss_pct = self._to_float(alert_stats.get("estimated_risk_missed_pct"))
        threshold_value = self._to_float(alert_stats.get("threshold"), 0.5)
        labelled_rows = self._to_int(alert_stats.get("labelled_rows"))
        reviewed_cases = self._to_int(sentinel.get("cases_reviewed"))
        escalated_cases = self._to_int(sentinel.get("escalated_cases"))
        sar_recommended = self._to_int(sentinel.get("sar_recommended"))
        closed_cases = self._to_int(sentinel.get("closed_cases"))
        visibility_note = str(sentinel.get("visibility_note") or "").strip()
        top_risk_drivers = list(sentinel.get("top_risk_drivers") or [])
        top_typologies = list(sentinel.get("top_typologies") or [])

        return [
            {
                "id": "alert_intake",
                "phase": "FCC",
                "title": "Alert Intake",
                "description": (
                    f"FCC started with {total_alerts:,} alerts from upstream monitoring. "
                    "This step frames the operating burden the bank would otherwise send directly to analysts."
                ),
                "metrics": [
                    self._metric("Alerts received", total_alerts),
                    self._metric("Labelled outcomes available", labelled_rows or max(0, total_alerts - suppressed)),
                    self._metric("Current STR rate in labelled data", self._optional_pct(alert_stats.get("str_rate_overall_pct"))),
                ],
                "highlights": [
                    "The intake view sets the starting workload before any suppression controls are applied.",
                    "This gives business users a clear view of how much manual effort would exist without FCC filtering.",
                ],
                "visual": {
                    "type": "donut",
                    "title": "Alert mix at intake",
                    "data": [
                        {"label": "Forwarded for review", "value": remaining or 0, "color": "#f97316"},
                        {"label": "Suppressed later in FCC", "value": suppressed or 0, "color": "#cbd5e1"},
                    ],
                },
                "cta": {"label": "Open Alert Intake", "tool": "fcc", "target": "data"},
            },
            {
                "id": "data_unification",
                "phase": "FCC",
                "title": "Data Unification",
                "description": (
                    "FCC brought customer, account, alert, and transaction context together so each alert could be assessed consistently. "
                    "This turns scattered operational data into a single investigation-ready record."
                ),
                "metrics": [
                    self._metric("Rows standardized", total_alerts),
                    self._metric("Customer and account context linked", "Yes"),
                    self._metric("Decision objective", "Consistent alert evaluation"),
                ],
                "highlights": [
                    "Customer, account, and transaction context were aligned before decisioning.",
                    "This reduces case-by-case inconsistency and makes downstream review more defensible.",
                ],
                "visual": {
                    "type": "funnel",
                    "title": "Data unification stages",
                    "data": [
                        {"label": "Alert intake", "value": total_alerts},
                        {"label": "Customer-ready", "value": total_alerts},
                        {"label": "Account-ready", "value": total_alerts},
                        {"label": "Transaction-enriched", "value": total_alerts},
                    ],
                },
                "cta": {"label": "Open Master Dataset", "tool": "fcc", "target": "master"},
            },
            {
                "id": "pattern_analysis",
                "phase": "FCC",
                "title": "Pattern Analysis",
                "description": (
                    "FCC reviewed behavior patterns before any alerts were removed. "
                    f"Business cues for this run were led by {self._join_labels(top_risk_drivers or self._default_risk_drivers(), max_items=3)}."
                ),
                "metrics": [
                    self._metric("Operationally lower-risk share", f"{((suppressed / max(total_alerts, 1)) * 100.0):.1f}%"),
                    self._metric("Still requiring investigation", f"{((remaining / max(total_alerts, 1)) * 100.0):.1f}%"),
                    self._metric("Pattern coverage", "Behavior, alert, and relationship signals"),
                ],
                "highlights": [
                    "This step explains what looked operationally routine versus what still needed investigation.",
                    "It gives business users a plain-language bridge between raw alerts and the decision layer.",
                ],
                "visual": {
                    "type": "bars",
                    "title": "Behavior bands observed",
                    "data": [
                        {"label": "Operationally lower-risk", "value": suppressed or 0, "color": "#22c55e"},
                        {"label": "Needs investigation", "value": remaining or 0, "color": "#ef4444"},
                    ],
                },
                "cta": {"label": "Open Pattern Analysis", "tool": "fcc", "target": "eda"},
            },
            {
                "id": "decision_layer",
                "phase": "FCC",
                "title": "Decision Layer",
                "description": (
                    narratives.get("problem")
                    or "FCC applied a governed decision layer to remove lower-value alerts while preserving meaningful risk coverage for analysts."
                ),
                "metrics": [
                    self._metric("Alerts removed from manual effort", suppressed),
                    self._metric("Alerts kept for review", remaining),
                    self._metric("Business objective", "Lower analyst workload without losing meaningful risk"),
                ],
                "highlights": [
                    "The purpose here is operational triage, not black-box automation.",
                    "Only alerts that still carry business value are meant to move forward into Sentinel.",
                ],
                "visual": {
                    "type": "comparison",
                    "title": "Before and after FCC filtering",
                    "data": [
                        {"label": "Before FCC", "value": total_alerts, "color": "#1d4ed8"},
                        {"label": "After FCC", "value": remaining, "color": "#f97316"},
                    ],
                },
                "cta": {"label": "Open Decision Layer", "tool": "fcc", "target": "model"},
            },
            {
                "id": "threshold_optimization",
                "phase": "FCC",
                "title": "Threshold Optimization",
                "description": (
                    f"FCC selected a balanced operating point at threshold {threshold_value:.2f}. "
                    f"That setting removes {workload_reduction_pct:.1f}% of alert workload while holding estimated missed risk to {event_loss_pct:.1f}%."
                ),
                "metrics": [
                    self._metric("Chosen threshold", f"{threshold_value:.2f}"),
                    self._metric("Workload reduction", f"{workload_reduction_pct:.1f}%"),
                    self._metric("Estimated missed risk", f"{event_loss_pct:.1f}%"),
                ],
                "highlights": [
                    "This is the point where the bank chooses how much work to remove versus how much residual miss-risk it will tolerate.",
                    "The threshold is presented in business terms, not model jargon.",
                ],
                "visual": {
                    "type": "tradeoff",
                    "title": "Workload versus risk trade-off",
                    "data": self._build_tradeoff_curve(threshold),
                },
                "cta": {"label": "Open Threshold Review", "tool": "fcc", "target": "validation"},
            },
            {
                "id": "fcc_outcome",
                "phase": "FCC",
                "title": "FCC Outcome",
                "description": (
                    f"FCC reduced the operational queue by {workload_reduction_pct:.1f}%, moving {suppressed:,} alerts out of manual review and leaving {remaining:,} for focused investigation."
                ),
                "metrics": [
                    self._metric("Total alerts reviewed", total_alerts),
                    self._metric("Suppressed before investigation", suppressed),
                    self._metric("Forwarded onward", remaining),
                ],
                "highlights": [
                    "This is the business impact FCC delivers before investigators even open Sentinel.",
                    "The result is lower noise, faster triage, and a narrower queue for higher-value review.",
                ],
                "visual": {
                    "type": "stacked",
                    "title": "FCC workload outcome",
                    "data": [
                        {"label": "Suppressed", "value": suppressed, "color": "#22c55e"},
                        {"label": "Retained", "value": remaining, "color": "#f97316"},
                    ],
                },
                "cta": {"label": "Open FCC Outcome", "tool": "fcc", "target": "dashboard"},
            },
            {
                "id": "flow_to_sentinel",
                "phase": "Bridge",
                "title": "Flow to Sentinel",
                "description": (
                    f"{remaining:,} retained alerts crossed from FCC into Sentinel with investigation context, routing priority, and case metadata. "
                    "This is the handoff point where workload reduction becomes investigation action."
                ),
                "metrics": [
                    self._metric("Alerts handed to Sentinel", remaining),
                    self._metric("Case scope now visible", sentinel.get("total_cases") or 0),
                    self._metric("Context note", "Investigation-ready handoff"),
                ],
                "highlights": [
                    "FCC and Sentinel are shown as one joined operating journey here, not two separate demos.",
                    "The bridge only forwards retained alerts and their supporting context into investigation.",
                ],
                "visual": {
                    "type": "flow",
                    "title": "FCC to Sentinel transition",
                    "data": [
                        {"label": "FCC intake", "value": total_alerts},
                        {"label": "Suppressed in FCC", "value": suppressed},
                        {"label": "Sent to Sentinel", "value": remaining},
                    ],
                },
                "cta": {"label": "Open FCC Bridge", "tool": "sentinel", "target": "fcc_bridge"},
            },
        ] + [
            {
                "id": "case_creation",
                "phase": "Sentinel",
                "title": "Case Creation",
                "description": (
                    f"Sentinel currently has {self._to_int(sentinel.get('total_cases')):,} cases in the scoped queue for this run. "
                    "These are the records investigators can prioritize, pick up, and route for review."
                ),
                "metrics": [
                    self._metric("Cases in queue", sentinel.get("total_cases") or 0),
                    self._metric("Cases already reviewed", reviewed_cases),
                    self._metric("Awaiting response", sentinel.get("awaiting_response") or 0),
                ],
                "highlights": [
                    "This is where retained FCC output becomes an operational investigation worklist.",
                    "The queue carries case ownership, status, and escalation handling rather than just analytics.",
                ],
                "visual": {
                    "type": "decision_bars",
                    "title": "Case handling status",
                    "data": [
                        {"label": "Open", "value": sentinel.get("statuses", Counter()).get("Open", 0), "color": "#94a3b8"},
                        {"label": "In Review", "value": sentinel.get("statuses", Counter()).get("In Review", 0), "color": "#2563eb"},
                        {"label": "Draft Prepared", "value": sentinel.get("statuses", Counter()).get("Draft Prepared", 0), "color": "#f97316"},
                    ],
                },
                "cta": {"label": "Open Case Queue", "tool": "sentinel", "target": "case_queue"},
            },
            {
                "id": "investigation",
                "phase": "Sentinel",
                "title": "Investigation",
                "description": (
                    f"Sentinel investigation is currently being driven by {self._join_labels(top_typologies or top_risk_drivers or self._default_risk_drivers(), max_items=3)}. "
                    f"{visibility_note}"
                ),
                "metrics": [
                    self._metric("Cases in active investigation", sentinel.get("cases_investigated") or 0),
                    self._metric("Key risk patterns", len(top_typologies or top_risk_drivers)),
                    self._metric("Visibility note", "Partial but explainable"),
                ],
                "highlights": [
                    "This step shows what investigators are seeing in the retained queue, not just that cases exist.",
                    "Typology, network, and behavior signals help explain why a case remains important.",
                ],
                "visual": {
                    "type": "insight_list",
                    "title": "Current investigation drivers",
                    "data": [{"label": item, "value": 1} for item in (top_risk_drivers or self._default_risk_drivers())[:5]],
                },
                "cta": {"label": "Open Investigation Workspace", "tool": "sentinel", "target": "investigate"},
            },
            {
                "id": "decision",
                "phase": "Sentinel",
                "title": "Decision",
                "description": (
                    f"Sentinel has moved {reviewed_cases:,} cases into review, with {closed_cases:,} closures, {escalated_cases:,} escalations, and {sar_recommended:,} SAR recommendations or equivalent final-risk outcomes."
                ),
                "metrics": [
                    self._metric("Closed or cleared", closed_cases),
                    self._metric("Escalated for further review", escalated_cases),
                    self._metric("SAR recommended", sar_recommended),
                ],
                "highlights": [
                    "This is the step that turns investigation effort into governed outcomes.",
                    "It explains how the retained workload ultimately resolved, escalated, or moved toward reporting.",
                ],
                "visual": {
                    "type": "decision_bars",
                    "title": "Decision breakdown",
                    "data": [
                        {"label": "Closed", "value": closed_cases, "color": "#22c55e"},
                        {"label": "Escalated", "value": escalated_cases, "color": "#ef4444"},
                        {"label": "SAR Recommended", "value": sar_recommended, "color": "#7c3aed"},
                    ],
                },
                "cta": {"label": "Open Resolution Workspace", "tool": "sentinel", "target": "resolution"},
            },
            {
                "id": "sar_summary",
                "phase": "Sentinel",
                "title": "SAR Summary",
                "description": self._build_sar_summary_text(sentinel),
                "metrics": [
                    self._metric("SAR drafts prepared", sentinel.get("sar_drafted") or 0),
                    self._metric("SAR drafts accepted", sentinel.get("sar_accepted") or 0),
                    self._metric("Final reporting posture", "Explainable and traceable"),
                ],
                "highlights": [
                    "This closes the executive story by showing whether investigations ended in reporting action or not.",
                    "Accepted SAR drafts can flow into reports, queue review, and escalation packets.",
                ],
                "visual": {
                    "type": "summary_block",
                    "title": "SAR posture",
                    "data": [
                        {"label": "Drafted", "value": sentinel.get("sar_drafted") or 0},
                        {"label": "Accepted", "value": sentinel.get("sar_accepted") or 0},
                        {"label": "Recommended", "value": sar_recommended},
                    ],
                },
                "cta": {"label": "Open Case Resolution", "tool": "sentinel", "target": "resolution"},
            },
        ]

    def _build_graph_payload(self, alert_stats: Dict[str, Any], sentinel: Dict[str, Any]) -> Dict[str, Any]:
        total_alerts = self._to_int(alert_stats.get("total_alerts"))
        suppressed = self._to_int(alert_stats.get("suppressed"))
        remaining = self._to_int(alert_stats.get("remaining"))
        workload_reduction_pct = self._to_float(alert_stats.get("workload_reduction_pct"))
        threshold_value = self._to_float(alert_stats.get("threshold"), 0.5)
        reviewed_cases = self._to_int(sentinel.get("cases_reviewed"))
        escalated_cases = self._to_int(sentinel.get("escalated_cases"))
        sar_recommended = self._to_int(sentinel.get("sar_recommended"))
        top_risk_drivers = list(sentinel.get("top_risk_drivers") or self._default_risk_drivers())

        clusters = [
            {"id": "fcc_cluster", "label": "FCC Intelligence Layer", "summary": "Alert intake, data unification, and pattern review before suppression decisions are made.", "metrics": [self._metric("Alerts", total_alerts), self._metric("Pattern focus", self._join_labels(top_risk_drivers, 2))], "risk": "system", "position": {"x": 70, "y": 55}},
            {"id": "suppression_cluster", "label": "Suppression Engine", "summary": "Governed FCC decisions, threshold control, and workload reduction outcomes.", "metrics": [self._metric("Suppressed", suppressed), self._metric("Threshold", f"{threshold_value:.2f}")], "risk": "processing", "position": {"x": 460, "y": 55}},
            {"id": "sentinel_cluster", "label": "Sentinel Investigation", "summary": "Case creation, investigator review, and evidence building once retained alerts enter Sentinel.", "metrics": [self._metric("Retained", remaining), self._metric("Reviewed", reviewed_cases)], "risk": "system", "position": {"x": 930, "y": 55}},
            {"id": "decision_cluster", "label": "Decision Engine", "summary": "Escalation, SAR recommendation, and closure outcomes backed by investigation evidence.", "metrics": [self._metric("Escalated", escalated_cases), self._metric("SAR", sar_recommended)], "risk": "decision", "position": {"x": 1380, "y": 55}},
        ]

        business_edges = [
            self._edge("fcc_cluster", "suppression_cluster", f"{workload_reduction_pct:.1f}% suppressed"),
            self._edge("suppression_cluster", "sentinel_cluster", f"{remaining:,} alerts forwarded"),
            self._edge("sentinel_cluster", "decision_cluster", f"{reviewed_cases:,} cases reviewed"),
            self._edge("decision_cluster", "sentinel_cluster", "Escalation feedback"),
        ]

        system_nodes = [
            *clusters,
            self._node("alert_intake", "Alert Intake", "FCC received the starting alert population.", "system", {"x": 90, "y": 315}, "fcc_cluster", [self._metric("Alerts", total_alerts)]),
            self._node("data_unification", "Data Unification", "Customer, account, and transaction context were joined for consistent review.", "processing", {"x": 320, "y": 315}, "fcc_cluster", [self._metric("Context", "Unified")]),
            self._node("pattern_analysis", "Pattern Analysis", "Behavior, alert, and relationship patterns were reviewed before suppression.", "processing", {"x": 125, "y": 525}, "fcc_cluster", [self._metric("Drivers", self._join_labels(top_risk_drivers, 2))]),
            self._node("decision_layer", "Decision Layer", "FCC separated lower-value noise from alerts that still need investigation.", "processing", {"x": 500, "y": 305}, "suppression_cluster", [self._metric("Suppressed", suppressed)]),
            self._node("threshold_optimization", "Threshold", "The operating point balanced workload removal and missed-risk control.", "processing", {"x": 735, "y": 515}, "suppression_cluster", [self._metric("Threshold", f"{threshold_value:.2f}")]),
            self._node("fcc_outcome", "FCC Outcome", "Only retained alerts were handed forward to Sentinel.", "outcome", {"x": 515, "y": 545}, "suppression_cluster", [self._metric("Forwarded", remaining)]),
            self._node("case_creation", "Case Creation", "Retained alerts became a Sentinel case workload.", "system", {"x": 970, "y": 315}, "sentinel_cluster", [self._metric("Cases", sentinel.get("total_cases") or 0)]),
            self._node("investigation", "Investigation", "Investigators reviewed the retained case population and built evidence.", "risk", {"x": 1205, "y": 315}, "sentinel_cluster", [self._metric("Reviewed", reviewed_cases)]),
            self._node("decisioning", "Decision", "Resolution, escalation, or SAR recommendation followed investigation review.", "decision", {"x": 1435, "y": 315}, "decision_cluster", [self._metric("Escalated", escalated_cases)]),
            self._node("sar_action", "SAR Summary", "Final reporting posture captured accepted drafts and recommendation outcomes.", "outcome", {"x": 1670, "y": 530}, "decision_cluster", [self._metric("SAR", sar_recommended)]),
        ]
        system_edges = [
            *business_edges,
            self._edge("alert_intake", "data_unification", "Alert context linked"),
            self._edge("data_unification", "pattern_analysis", "Behavior signals prepared"),
            self._edge("pattern_analysis", "decision_layer", "Risk cues evaluated"),
            self._edge("decision_layer", "threshold_optimization", "Policy threshold applied"),
            self._edge("threshold_optimization", "fcc_outcome", f"{suppressed:,} suppressed"),
            self._edge("fcc_outcome", "case_creation", f"{remaining:,} cases forwarded"),
            self._edge("case_creation", "investigation", "Priority review"),
            self._edge("investigation", "decisioning", "Evidence and narrative"),
            self._edge("decisioning", "sar_action", f"{sar_recommended:,} SAR actions"),
            self._edge("decisioning", "investigation", "Re-open or request more evidence"),
        ]

        return {
            "title": "End-to-End AML Flow Graph",
            "subtitle": "FCC, Bridge, Sentinel, and downstream decisioning shown as one explainable operating system.",
            "views": {
                "business": {"clusters": clusters, "nodes": clusters, "edges": business_edges},
                "system": {"clusters": clusters, "nodes": system_nodes, "edges": system_edges},
            },
            "play_sequence": [
                "fcc_cluster", "alert_intake", "data_unification", "pattern_analysis",
                "suppression_cluster", "decision_layer", "threshold_optimization", "fcc_outcome",
                "sentinel_cluster", "case_creation", "investigation",
                "decision_cluster", "decisioning", "sar_action",
            ],
        }

    def _get_investigation_db_manager(self):
        try:
            return self.services.get_investigation_db(self.env_id, self.tenant_id)
        except Exception:
            return None

    def _infer_scope_from_cases(self, publish_id: Optional[str]) -> Dict[str, Optional[str]]:
        db_manager = self._get_investigation_db_manager()
        if not db_manager:
            return {"run_id": None, "pipeline_id": None}
        conn = db_manager.connect()
        try:
            cursor = conn.cursor()
            if not self._table_exists(cursor, "cases"):
                return {"run_id": None, "pipeline_id": None}
            cursor.execute('PRAGMA table_info("cases")')
            columns = [row[1] for row in cursor.fetchall()]
            run_col = self._find_column(columns, ["fcc_source_run_id", "run_id"])
            pipeline_col = self._find_column(columns, ["fcc_pipeline_id", "pipeline_id"])
            publish_col = self._find_column(columns, ["fcc_publish_id", "publish_id"])
            if not run_col:
                return {"run_id": None, "pipeline_id": None}
            where = []
            params: List[Any] = []
            if publish_id and publish_col:
                where.append(f'"{publish_col}" = ?')
                params.append(str(publish_id))
            select_cols = [run_col]
            if pipeline_col:
                select_cols.append(pipeline_col)
            order_col = publish_col or run_col
            cursor.execute(
                f'SELECT {self._quoted_columns(select_cols)} FROM "cases"'
                + (f' WHERE {" AND ".join(where)}' if where else "")
                + f' ORDER BY "{order_col}" DESC LIMIT 1',
                params,
            )
            row = cursor.fetchone()
            if not row:
                return {"run_id": None, "pipeline_id": None}
            return {
                "run_id": str(row[0] or "").strip() or None,
                "pipeline_id": str(row[1] or "").strip() if pipeline_col and len(row) > 1 and row[1] else None,
            }
        finally:
            db_manager.close_connection(conn)

    def _resolve_case_scope(
        self,
        cursor,
        *,
        run_id: Optional[str],
        pipeline_id: Optional[str],
        publish_id: Optional[str],
    ) -> Tuple[List[str], Dict[str, Any]]:
        if not self._table_exists(cursor, "cases"):
            return [], {"scope_type": "all_cases", "matched": 0}
        cursor.execute('PRAGMA table_info("cases")')
        columns = [row[1] for row in cursor.fetchall()]
        case_id_col = self._find_column(columns, ["case_id", "CASE_ID"])
        if not case_id_col:
            return [], {"scope_type": "all_cases", "matched": 0}
        conditions = []
        params: List[Any] = []
        run_col = self._find_column(columns, ["fcc_source_run_id", "run_id"])
        pipeline_col = self._find_column(columns, ["fcc_pipeline_id", "pipeline_id"])
        publish_col = self._find_column(columns, ["fcc_publish_id", "publish_id"])
        if publish_id and publish_col:
            conditions.append(f'"{publish_col}" = ?')
            params.append(str(publish_id))
        if run_id and run_col:
            conditions.append(f'"{run_col}" = ?')
            params.append(str(run_id))
        if pipeline_id and pipeline_col:
            conditions.append(f'"{pipeline_col}" = ?')
            params.append(str(pipeline_id))

        sql = f'SELECT "{case_id_col}" FROM "cases"'
        if conditions:
            sql += f' WHERE {" AND ".join(conditions)}'
        cursor.execute(sql, params)
        rows = [str(row[0] or "").strip() for row in cursor.fetchall() if str(row[0] or "").strip()]
        return rows, {
            "scope_type": "scoped_cases" if conditions else "all_cases",
            "matched": len(rows),
        }

    def _load_case_rows(self, cursor, case_ids: Iterable[str]) -> List[Dict[str, Any]]:
        case_ids = [str(item) for item in case_ids or [] if str(item or "").strip()]
        if not case_ids or not self._table_exists(cursor, "cases"):
            return []
        cursor.execute('PRAGMA table_info("cases")')
        columns = [row[1] for row in cursor.fetchall()]
        case_id_col = self._find_column(columns, ["case_id", "CASE_ID"])
        if not case_id_col:
            return []
        placeholders = ", ".join(["?"] * len(case_ids))
        selected = [col for col in [
            case_id_col,
            self._find_column(columns, ["scenario_name", "SCENARIO_NAME", "alert_name", "ALERT_NAME"]),
            self._find_column(columns, ["alert_type", "ALERT_TYPE", "rule_triggered", "RULE_TRIGGERED"]),
            self._find_column(columns, ["status", "STATUS", "current_status"]),
        ] if col]
        cursor.execute(
            f'SELECT {self._quoted_columns(selected)} FROM "cases" WHERE "{case_id_col}" IN ({placeholders})',
            case_ids,
        )
        return [dict(row) for row in cursor.fetchall()]

    def _load_support_files(self, cursor, case_ids: Iterable[str]) -> Dict[str, Dict[str, Any]]:
        case_ids = [str(item) for item in case_ids or [] if str(item or "").strip()]
        if not case_ids or not self._table_exists(cursor, "case_resolution_workspaces"):
            return {}
        placeholders = ", ".join(["?"] * len(case_ids))
        cursor.execute(
            f"""
            SELECT case_id, support_file_json, sar_draft
            FROM case_resolution_workspaces
            WHERE case_id IN ({placeholders})
            """,
            case_ids,
        )
        results = {}
        for row in cursor.fetchall():
            payload = self._json_load(row[1], {})
            if row[2] and not payload.get("sar_draft"):
                payload["sar_draft"] = row[2]
            results[str(row[0])] = payload
        return results

    def _build_tradeoff_curve(self, threshold: Dict[str, Any]) -> List[Dict[str, Any]]:
        rows = threshold.get("threshold_table") if isinstance(threshold.get("threshold_table"), list) else []
        normalized = []
        for row in rows[:10]:
            normalized.append({
                "label": f"{self._to_float(row.get('threshold'), 0.0):.2f}",
                "suppression_pct": self._to_float(row.get("suppression_pct")),
                "event_loss_pct": self._to_float(row.get("event_loss_pct")),
            })
        if normalized:
            return normalized
        return [
            {"label": "0.30", "suppression_pct": max(10.0, self._to_float(threshold.get("recommended_suppression_pct")) * 0.55), "event_loss_pct": max(0.4, self._to_float(threshold.get("recommended_event_loss_pct")) * 0.45)},
            {"label": "0.40", "suppression_pct": max(18.0, self._to_float(threshold.get("recommended_suppression_pct")) * 0.78), "event_loss_pct": max(0.8, self._to_float(threshold.get("recommended_event_loss_pct")) * 0.72)},
            {"label": f"{self._to_float(threshold.get('recommended_threshold'), 0.5):.2f}", "suppression_pct": self._to_float(threshold.get("recommended_suppression_pct")), "event_loss_pct": self._to_float(threshold.get("recommended_event_loss_pct"))},
            {"label": "0.70", "suppression_pct": min(95.0, self._to_float(threshold.get("recommended_suppression_pct")) * 1.12), "event_loss_pct": min(20.0, self._to_float(threshold.get("recommended_event_loss_pct")) * 1.45 + 0.4)},
        ]

    def _build_sar_summary_text(self, sentinel: Dict[str, Any]) -> str:
        sar_accepted = self._to_int(sentinel.get("sar_accepted"))
        sar_drafted = self._to_int(sentinel.get("sar_drafted"))
        sar_recommended = self._to_int(sentinel.get("sar_recommended"))
        top_typologies = list(sentinel.get("top_typologies") or [])
        if sar_accepted or sar_recommended:
            return (
                f"Sentinel has {sar_recommended:,} case decisions that currently support SAR recommendation, with {sar_accepted:,} drafts already accepted. "
                f"Those cases are being driven mainly by {self._join_labels(top_typologies or self._default_risk_drivers(), max_items=2)} and are suitable for downstream reporting packs."
            )
        if sar_drafted:
            return (
                f"Sentinel has {sar_drafted:,} SAR drafts prepared, but final acceptance is still pending. "
                "This means the investigation narrative is in place even if the reporting decision has not been finalized yet."
            )
        return (
            "No case in the current scope has yet reached an accepted SAR outcome. "
            "That does not mean the run produced no risk. It means the current Sentinel workload is still being worked, closed, or escalated for further review."
        )

    def _empty_sentinel_summary(self) -> Dict[str, Any]:
        return {
            "scope_meta": {"scope_type": "all_cases", "matched": 0},
            "queue_rows": [],
            "support_files": {},
            "case_rows": [],
            "total_cases": 0,
            "statuses": Counter(),
            "stages": Counter(),
            "cases_reviewed": 0,
            "cases_investigated": 0,
            "cases_in_decision": 0,
            "closed_cases": 0,
            "escalated_cases": 0,
            "awaiting_response": 0,
            "sar_recommended": 0,
            "sar_drafted": 0,
            "sar_accepted": 0,
            "top_risk_drivers": [],
            "top_typologies": [],
            "top_scenarios": [],
            "visibility_note": "Sentinel data is not available in the active environment, so only FCC-side metrics can be summarized right now.",
        }

    def _metric(self, label: str, value: Any) -> Dict[str, Any]:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if isinstance(value, float) and not value.is_integer():
                display = f"{value:,.1f}"
            else:
                display = f"{int(value):,}"
        else:
            display = str(value)
        return {"label": label, "value": display}

    def _node(
        self,
        node_id: str,
        label: str,
        summary: str,
        tone: str,
        position: Dict[str, int],
        cluster_id: str,
        metrics: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        return {
            "id": node_id,
            "label": label,
            "summary": summary,
            "risk": tone,
            "position": position,
            "cluster_id": cluster_id,
            "metrics": metrics,
        }

    def _edge(self, source: str, target: str, label: str) -> Dict[str, Any]:
        return {"id": f"{source}-{target}", "source": source, "target": target, "label": label}

    def _table_exists(self, cursor, table_name: str) -> bool:
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", (table_name,))
        return cursor.fetchone() is not None

    def _find_column(self, columns: Iterable[str], candidates: Iterable[str]) -> Optional[str]:
        lowered = {str(column).lower(): str(column) for column in columns or []}
        for candidate in candidates or []:
            if str(candidate).lower() in lowered:
                return lowered[str(candidate).lower()]
        return None

    def _quoted_columns(self, columns: Iterable[str]) -> str:
        return ", ".join([f'"{column}"' for column in columns if column])

    def _normalize_list(self, value: Any) -> List[str]:
        if isinstance(value, str):
            text = value.strip()
            return [text] if text else []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item or "").strip()]
        return []

    def _friendly_scenario(self, scenario_name: str) -> str:
        text = str(scenario_name or "").replace("_", " ").strip()
        return text.title() if text else "Elevated review pattern"

    def _default_risk_drivers(self) -> List[str]:
        return [
            "sudden transaction spikes",
            "higher-risk corridors",
            "network linkage signals",
        ]

    def _join_labels(self, labels: Iterable[str], max_items: int = 3) -> str:
        items = [str(item).strip() for item in labels or [] if str(item or "").strip()][:max_items]
        if not items:
            return "retained alert review patterns"
        if len(items) == 1:
            return items[0]
        if len(items) == 2:
            return f"{items[0]} and {items[1]}"
        return f"{', '.join(items[:-1])}, and {items[-1]}"

    def _optional_pct(self, value: Any) -> str:
        if value is None:
            return "Not available"
        return f"{self._to_float(value):.2f}%"

    def _json_load(self, value: Any, default: Any) -> Any:
        if isinstance(value, (dict, list)):
            return value
        try:
            parsed = json.loads(value or "")
            return parsed if parsed is not None else default
        except Exception:
            return default

    def _to_int(self, value: Any, default: int = 0) -> int:
        try:
            return int(float(value))
        except Exception:
            return int(default)

    def _to_float(self, value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except Exception:
            return float(default)

    def _now_iso(self) -> str:
        from datetime import datetime

        return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
