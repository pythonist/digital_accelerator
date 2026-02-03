from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import duckdb
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, PageBreak, Paragraph, Spacer
from reportlab.lib.units import inch

from api.tools.btsy.duckdb_pool import duckdb_pool
from calibration.services.pdf_reporting.components import (
    create_professional_table,
    create_matplotlib_chart,
    create_ai_explanation_box,
)
from calibration.services.pdf_reporting.styles import ReportTheme


@dataclass(frozen=True)
class SectionSpec:
    section_no: int
    title: str
    section_key: str


REPORT_SECTIONS: List[SectionSpec] = [
    SectionSpec(1, "Cover & Legal Framing", "cover"),
    SectionSpec(2, "Executive Decision Summary", "executive"),
    SectionSpec(3, "Calibration Flow Overview", "flow_overview"),
    SectionSpec(4, "Run Metadata & Reproducibility", "reproducibility"),
    SectionSpec(5, "Data Source Scope & Coverage", "data_scope"),
    SectionSpec(6, "Schema & Canonical Model", "schema_model"),
    SectionSpec(7, "Data Quality & Join Integrity", "data_quality"),
    SectionSpec(8, "Temporal Stability & Seasonality", "temporal_stability"),
    SectionSpec(9, "Universe Definition (Pre/Post)", "universe_pre_post"),
    SectionSpec(10, "Universe Bias & Representativeness", "universe_bias"),
    SectionSpec(11, "Behavioural Metric Design", "behaviour_design"),
    SectionSpec(12, "Aggregation Strategy", "aggregation_strategy"),
    SectionSpec(13, "Behaviour Distribution Analysis", "behaviour_distribution"),
    SectionSpec(14, "Threshold Search Space", "threshold_ladder"),
    SectionSpec(15, "Threshold Selection Decision", "threshold_decision"),
    SectionSpec(16, "ATL / BTL Near-Miss Analysis", "atl_btl"),
    SectionSpec(17, "Statistical Validation (KS / J)", "stat_validation"),
    SectionSpec(18, "Stress & Fragility Testing", "stress_fragility"),
    SectionSpec(19, "Operational Impact", "operational_impact"),
    SectionSpec(20, "Limitations & Assumptions", "limitations"),
    SectionSpec(21, "Governance & Approval", "governance"),
    SectionSpec(22, "Final Regulatory Interpretation", "final_interpretation"),
]


class BTSYAdvancedReportGenerator:
    def __init__(self, run_db_path: Path, logo_path: Optional[Path] = None):
        self.run_db_path = run_db_path
        self.logo_path = str(logo_path) if logo_path and logo_path.exists() else None
        self.styles = ReportTheme.get_styles()

    def _create_header_footer(self, canvas, doc):
        canvas.saveState()
        if self.logo_path and os.path.exists(self.logo_path):
            canvas.drawImage(self.logo_path, 0.75 * inch, A4[1] - 0.6 * inch, width=1 * inch, height=0.4 * inch, preserveAspectRatio=True)
        else:
            canvas.setFont("Helvetica-Bold", 10)
            canvas.setFillColor(ReportTheme.PWC_ORANGE)
            canvas.drawString(0.75 * inch, A4[1] - 0.6 * inch, "PwC")
        canvas.setStrokeColor(ReportTheme.PWC_ORANGE)
        canvas.setLineWidth(1.5)
        canvas.line(0.75 * inch, A4[1] - 0.7 * inch, A4[0] - 0.75 * inch, A4[1] - 0.7 * inch)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(ReportTheme.TEXT_SECONDARY)
        page_num = canvas.getPageNumber()
        canvas.drawRightString(A4[0] - 0.75 * inch, 0.5 * inch, f"Page {page_num}")
        canvas.setStrokeColor(ReportTheme.BORDER_GREY)
        canvas.setLineWidth(0.5)
        canvas.line(0.75 * inch, 0.65 * inch, A4[0] - 0.75 * inch, 0.65 * inch)
        canvas.restoreState()

    def _safe_fetchall(self, sql: str, params: Optional[Sequence[Any]] = None) -> List[Tuple]:
        with duckdb_pool.connection(self.run_db_path, read_only=True) as conn:
            return conn.execute(sql, list(params or [])).fetchall()

    def _safe_fetchone(self, sql: str, params: Optional[Sequence[Any]] = None) -> Optional[Tuple]:
        with duckdb_pool.connection(self.run_db_path, read_only=True) as conn:
            return conn.execute(sql, list(params or [])).fetchone()

    def _table_exists(self, table_name: str) -> bool:
        r = self._safe_fetchone("SELECT COUNT(1) FROM information_schema.tables WHERE table_name = ?", [table_name])
        return bool(r and int(r[0] or 0) > 0)

    def _get_run_core(self, run_id: int) -> Dict[str, Any]:
        out: Dict[str, Any] = {"run_id": int(run_id)}
        if self._table_exists("calibration_run"):
            row = self._safe_fetchone(
                """
                SELECT run_id, scenario_id, mode, snapshot_id, config_hash, engine_version, started_at, completed_at, status, triggered_by
                FROM calibration_run
                WHERE run_id = ?
                """,
                [int(run_id)],
            )
            if row:
                out.update(
                    {
                        "scenario_id": row[1],
                        "mode": row[2],
                        "snapshot_id": row[3],
                        "config_hash": row[4],
                        "engine_version": row[5],
                        "started_at": str(row[6]) if row[6] is not None else None,
                        "completed_at": str(row[7]) if row[7] is not None else None,
                        "status": row[8],
                        "triggered_by": row[9],
                    }
                )
        if self._table_exists("run_metadata"):
            rm = self._safe_fetchone(
                """
                SELECT env_id, snapshot_id, session_id, mode, created_by, created_at
                FROM run_metadata
                WHERE run_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                [int(run_id)],
            )
            if rm:
                out.update(
                    {
                        "env_id": rm[0],
                        "snapshot_id": out.get("snapshot_id") or rm[1],
                        "session_id": int(rm[2] or 0),
                        "mode": out.get("mode") or rm[3],
                        "created_by": out.get("triggered_by") or rm[4],
                        "created_at": str(rm[5]) if rm[5] is not None else None,
                    }
                )
        return out

    def _get_inference_text(self, run_id: int, step_id: str, inference_type: str) -> Optional[str]:
        if not self._table_exists("calibration_inference"):
            return None
        row = self._safe_fetchone(
            """
            SELECT inference_text
            FROM calibration_inference
            WHERE run_id = ? AND step_id = ? AND inference_type = ?
            ORDER BY generated_at DESC
            LIMIT 1
            """,
            [int(run_id), step_id, inference_type],
        )
        return row[0] if row and row[0] else None

    def _section_title(self, spec: SectionSpec) -> str:
        return f"{spec.section_no}. {spec.title}"

    def _add_cover(self, story: List, run: Dict[str, Any]):
        story.append(Spacer(1, 1.6 * inch))
        story.append(Paragraph("AML Calibration Report", self.styles["CoverTitle"]))
        story.append(Paragraph("Evidence-Grade Calibration Dossier", self.styles["CoverSubtitle"]))
        story.append(Spacer(1, 0.5 * inch))

        meta = [
            ["Run ID", str(run.get("run_id", ""))],
            ["Scenario", str(run.get("scenario_id") or "N/A")],
            ["Snapshot", str(run.get("snapshot_id") or "N/A")],
            ["Environment", str(run.get("env_id") or "N/A")],
            ["Mode", str(run.get("mode") or "N/A")],
            ["Triggered By", str(run.get("created_by") or run.get("triggered_by") or "N/A")],
            ["Generated", datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")],
        ]
        story.append(create_professional_table([["Field", "Value"], *meta], col_widths=[2.0 * inch, 4.0 * inch]))
        story.append(Spacer(1, 0.25 * inch))
        legal = (
            "<b>Legal framing:</b> This report is a controlled calibration artefact generated from persisted evidence. "
            "It documents calibration inputs, transformations, outputs, and decision rationale. "
            "It is retrospective and does not modify production controls."
        )
        story.append(Paragraph(legal, self.styles["BodyText"]))

    def _add_section_header(self, story: List, spec: SectionSpec):
        story.append(PageBreak())
        story.append(Paragraph(self._section_title(spec), self.styles["SectionHeader"]))

    def _add_evidence_gap(self, story: List, text: str):
        story.append(Spacer(1, 0.12 * inch))
        story.append(Paragraph(text, self.styles["WarningBox"]))

    def _add_metrics_table(self, story: List, title: str, rows: List[List[Any]], col_widths: Optional[List[float]] = None):
        story.append(Paragraph(title, self.styles["SubsectionHeader"]))
        story.append(create_professional_table(rows, col_widths=col_widths))
        story.append(Spacer(1, 0.18 * inch))

    def _build_step0_tables(self, run_id: int) -> Tuple[Optional[Dict[str, Any]], List[Tuple]]:
        overall = None
        cols = []
        if self._table_exists("evidence_step0_overall"):
            r = self._safe_fetchone(
                """
                SELECT transaction_count, unique_accounts, unique_customers, date_range_start, date_range_end, column_count
                FROM evidence_step0_overall
                WHERE run_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                [int(run_id)],
            )
            if r:
                overall = {
                    "transaction_count": int(r[0] or 0),
                    "unique_accounts": int(r[1] or 0),
                    "unique_customers": int(r[2] or 0),
                    "date_range_start": str(r[3]) if r[3] is not None else None,
                    "date_range_end": str(r[4]) if r[4] is not None else None,
                    "column_count": int(r[5] or 0),
                }
        if self._table_exists("evidence_step0_column_profile"):
            cols = self._safe_fetchall(
                """
                SELECT column_name, data_type, null_count, null_pct
                FROM evidence_step0_column_profile
                WHERE run_id = ?
                ORDER BY null_pct DESC
                """,
                [int(run_id)],
            )
        return overall, cols

    def _build_alerts_daily_series(self) -> Optional[Dict[str, List[Any]]]:
        if not self._table_exists("alerts"):
            return None
        daily = self._safe_fetchall(
            """
            SELECT CAST(date_trunc('day', alert_date) AS DATE) AS d, COUNT(1) AS c
            FROM alerts
            GROUP BY d
            ORDER BY d ASC
            """,
        )
        if not daily:
            return None
        return {"x": [str(r[0]) for r in daily], "y": [int(r[1] or 0) for r in daily]}

    def _build_workload_series(self) -> Optional[Dict[str, List[Any]]]:
        if not self._table_exists("workload_simulation_results"):
            return None
        daily = self._safe_fetchall(
            """
            SELECT CAST(as_of_date AS DATE) AS d, SUM(alerts_generated) AS alerts
            FROM workload_simulation_results
            GROUP BY d
            ORDER BY d ASC
            """,
        )
        if not daily:
            return None
        return {"x": [str(r[0]) for r in daily], "y": [float(r[1] or 0) for r in daily]}

    def _build_threshold_ladder(self, session_id: Optional[int]) -> List[Tuple]:
        if self._table_exists("calibration_boundary_candidates"):
            return self._safe_fetchall(
                """
                SELECT percentile, threshold_value, atl_count, btl_count, ks_statistic, j_statistic
                FROM calibration_boundary_candidates
                ORDER BY percentile ASC
                """,
            )
        if session_id and self._table_exists("threshold_strategies"):
            return self._safe_fetchall(
                """
                SELECT
                  NULL AS percentile,
                  threshold_value,
                  alerts_count AS atl_count,
                  NULL AS btl_count,
                  NULL AS ks_statistic,
                  NULL AS j_statistic
                FROM threshold_strategies
                WHERE session_id = ?
                ORDER BY threshold_value ASC
                """,
                [int(session_id)],
            )
        return []

    def _build_boundary_final(self) -> Optional[Tuple]:
        if not self._table_exists("calibration_boundary_final"):
            return None
        return self._safe_fetchone(
            """
            SELECT boundary_id, threshold_value, atl_count, created_at
            FROM calibration_boundary_final
            ORDER BY created_at DESC
            LIMIT 1
            """,
        )

    def _build_ks_summary(self) -> Optional[Tuple]:
        if not self._table_exists("ks_validation_results"):
            return None
        return self._safe_fetchone(
            """
            SELECT ks_statistic, p_value, sample_size_a, sample_size_b, created_at
            FROM ks_validation_results
            ORDER BY created_at DESC
            LIMIT 1
            """,
        )

    def generate_pdf(self, *, run_id: int, output_path: Path) -> str:
        run = self._get_run_core(run_id)

        doc = SimpleDocTemplate(
            str(output_path),
            pagesize=A4,
            rightMargin=0.75 * inch,
            leftMargin=0.75 * inch,
            topMargin=0.9 * inch,
            bottomMargin=0.85 * inch,
            title=f"Calibration Report - {run_id}",
            author=str(run.get("created_by") or "System"),
        )

        story: List[Any] = []
        self._add_cover(story, run)

        for spec in REPORT_SECTIONS[1:]:
            self._add_section_header(story, spec)
            self._render_section(story, spec, run)

        doc.build(story, onFirstPage=self._create_header_footer, onLaterPages=self._create_header_footer)
        return str(output_path)

    def _render_section(self, story: List, spec: SectionSpec, run: Dict[str, Any]):
        run_id = int(run.get("run_id") or 0)

        if spec.section_key == "executive":
            final = self._build_boundary_final()
            alert_cnt = self._safe_fetchone("SELECT COUNT(1) FROM alerts") if self._table_exists("alerts") else None
            a = int(alert_cnt[0] or 0) if alert_cnt else 0
            selected_threshold = float(final[1]) if final and final[1] is not None else None
            story.append(Paragraph("Decision statement", self.styles["SubsectionHeader"]))
            story.append(
                Paragraph(
                    "This section records the calibration outcome and the basis on which it is considered deployable or non-deployable. "
                    "All values presented are sourced from persisted evidence in DuckDB.",
                    self.styles["BodyText"],
                )
            )
            self._add_metrics_table(
                story,
                "Outcome summary",
                [
                    ["Metric", "Value"],
                    ["Selected threshold", str(selected_threshold) if selected_threshold is not None else "N/A"],
                    ["Alerts generated", f"{a:,}"],
                    ["Run status", str(run.get("status") or "N/A")],
                ],
                col_widths=[2.6 * inch, 3.4 * inch],
            )
            t = self._get_inference_text(run_id, "STEP_3", "calibration")
            if t:
                box = create_ai_explanation_box(t)
                if box:
                    story.append(box)
            else:
                self._add_evidence_gap(story, "No persisted calibration interpretation is available for this run.")
            return

        if spec.section_key == "flow_overview":
            if self._table_exists("calibration_step_run"):
                steps = self._safe_fetchall(
                    """
                    SELECT step_id, step_name, started_at, completed_at, status
                    FROM calibration_step_run
                    WHERE run_id = ?
                    ORDER BY started_at ASC
                    """,
                    [int(run_id)],
                )
            else:
                steps = []
            rows = [["Step", "Name", "Started", "Completed", "Status"]]
            for r in steps:
                rows.append([r[0], r[1] or "", str(r[2] or ""), str(r[3] or ""), r[4] or ""])
            if len(rows) == 1:
                self._add_evidence_gap(story, "No step execution evidence was found for this run.")
            else:
                self._add_metrics_table(story, "Execution timeline", rows, col_widths=[0.9 * inch, 2.1 * inch, 1.3 * inch, 1.3 * inch, 1.0 * inch])
            return

        if spec.section_key == "reproducibility":
            meta_rows = [
                ["Field", "Value"],
                ["Snapshot ID", str(run.get("snapshot_id") or "N/A")],
                ["Config hash", str(run.get("config_hash") or "N/A")],
                ["Engine version", str(run.get("engine_version") or "N/A")],
                ["Started at", str(run.get("started_at") or "N/A")],
                ["Completed at", str(run.get("completed_at") or "N/A")],
            ]
            story.append(Paragraph("Reproducibility controls", self.styles["SubsectionHeader"]))
            story.append(
                Paragraph(
                    "Reproducibility is demonstrated by persisted snapshot identifiers and configuration fingerprints. "
                    "The run can be re-evaluated against the same snapshot without recomputation of upstream inputs.",
                    self.styles["BodyText"],
                )
            )
            story.append(create_professional_table(meta_rows, col_widths=[2.0 * inch, 4.0 * inch]))
            return

        if spec.section_key in ("data_scope", "schema_model", "data_quality", "temporal_stability"):
            overall, col_profile = self._build_step0_tables(run_id)
            if not overall and not col_profile:
                self._add_evidence_gap(story, "Data foundation evidence was not persisted for this run.")
                return
            if overall:
                self._add_metrics_table(
                    story,
                    "Coverage summary",
                    [
                        ["Metric", "Value"],
                        ["Transactions", f"{overall.get('transaction_count', 0):,}"],
                        ["Unique accounts", f"{overall.get('unique_accounts', 0):,}"],
                        ["Unique customers", f"{overall.get('unique_customers', 0):,}"],
                        ["Date range", f"{overall.get('date_range_start') or 'N/A'} → {overall.get('date_range_end') or 'N/A'}"],
                        ["Columns profiled", f"{overall.get('column_count', 0):,}"],
                    ],
                    col_widths=[2.4 * inch, 3.6 * inch],
                )
            if col_profile:
                top = col_profile[:20]
                rows = [["Column", "Type", "Null count", "Null %"]]
                for r in top:
                    rows.append([r[0], r[1], f"{int(r[2] or 0):,}", f"{float(r[3] or 0.0) * 100:.2f}%"])
                self._add_metrics_table(story, "Null-rate profile (top 20)", rows, col_widths=[2.0 * inch, 1.2 * inch, 1.4 * inch, 1.4 * inch])
                chart = create_matplotlib_chart(
                    chart_type="bar",
                    data={"x": [str(r[0]) for r in top[:10]], "y": [float(r[3] or 0.0) * 100.0 for r in top[:10]]},
                    title="Top 10 columns by null-rate (%)",
                    ylabel="Null rate (%)",
                )
                story.append(chart)
            t = self._get_inference_text(run_id, "STEP_0", "data_quality")
            if t:
                box = create_ai_explanation_box(t)
                if box:
                    story.append(box)
            return

        if spec.section_key in ("universe_pre_post", "universe_bias"):
            if self._table_exists("calibration_metric"):
                m = self._safe_fetchall(
                    """
                    SELECT metric_key, COALESCE(CAST(metric_value AS VARCHAR), metric_json) AS v
                    FROM calibration_metric
                    WHERE run_id = ? AND step_id = 'STEP_1'
                    ORDER BY created_at DESC
                    """,
                    [int(run_id)],
                )
            else:
                m = []
            if not m:
                self._add_evidence_gap(story, "Universe definition evidence is not available for this run.")
                return
            rows = [["Metric", "Value"]]
            for k, v in m[:20]:
                rows.append([str(k), str(v)])
            self._add_metrics_table(story, "Universe metrics (persisted)", rows, col_widths=[3.0 * inch, 3.0 * inch])
            t = self._get_inference_text(run_id, "STEP_1", "population")
            if t:
                box = create_ai_explanation_box(t)
                if box:
                    story.append(box)
            return

        if spec.section_key in ("behaviour_design", "aggregation_strategy", "behaviour_distribution"):
            story.append(
                Paragraph(
                    "Behavioural metrics and aggregation strategy must be reviewed against typologies, grain, and window definitions. "
                    "This section reflects only what is persisted for this run.",
                    self.styles["BodyText"],
                )
            )
            t = self._get_inference_text(run_id, "STEP_2", "behaviour")
            if t:
                box = create_ai_explanation_box(t)
                if box:
                    story.append(box)
            else:
                self._add_evidence_gap(story, "No persisted behavioural interpretation is available for this run.")
            return

        if spec.section_key in ("threshold_ladder", "threshold_decision", "atl_btl", "stat_validation", "stress_fragility"):
            final = self._build_boundary_final()
            ladder = self._build_threshold_ladder(session_id=int(run.get("session_id") or 0) or None)
            if ladder:
                rows = [["Percentile", "Threshold", "ATL count", "BTL count", "KS", "J"]]
                for r in ladder[:40]:
                    rows.append([str(r[0]), str(r[1]), str(r[2]), str(r[3]), str(r[4]), str(r[5])])
                self._add_metrics_table(story, "Candidate thresholds (persisted)", rows, col_widths=[0.9 * inch, 1.2 * inch, 1.0 * inch, 1.0 * inch, 0.9 * inch, 0.9 * inch])
                chart = create_matplotlib_chart(
                    chart_type="line",
                    data={"x": [str(r[0] if r[0] is not None else "") for r in ladder[:40]], "y": [float(r[1] or 0) for r in ladder[:40]]},
                    title="Threshold value by percentile (candidate ladder)",
                    xlabel="Percentile",
                    ylabel="Threshold",
                )
                story.append(chart)
            else:
                self._add_evidence_gap(story, "No persisted threshold ladder was found for this run.")
            if final:
                self._add_metrics_table(
                    story,
                    "Final boundary (persisted)",
                    [
                        ["Field", "Value"],
                        ["Boundary ID", str(final[0])],
                        ["Threshold value", str(final[1])],
                        ["ATL count", str(final[2])],
                        ["Finalized at", str(final[3])],
                    ],
                    col_widths=[2.0 * inch, 4.0 * inch],
                )
            ks = self._build_ks_summary()
            if ks and spec.section_key == "stat_validation":
                self._add_metrics_table(
                    story,
                    "KS validation (persisted)",
                    [
                        ["Metric", "Value"],
                        ["KS statistic", str(ks[0])],
                        ["P-value", str(ks[1])],
                        ["Sample A", str(ks[2])],
                        ["Sample B", str(ks[3])],
                        ["Computed at", str(ks[4])],
                    ],
                    col_widths=[2.0 * inch, 4.0 * inch],
                )
            t = self._get_inference_text(run_id, "STEP_3", "calibration")
            if t:
                box = create_ai_explanation_box(t)
                if box:
                    story.append(box)
            return

        if spec.section_key == "operational_impact":
            story.append(
                Paragraph(
                    "Operational impact must demonstrate expected alert volumes and capacity feasibility. "
                    "Charts below are generated from persisted alert and workload tables where available.",
                    self.styles["BodyText"],
                )
            )
            alerts_series = self._build_alerts_daily_series()
            if alerts_series:
                story.append(
                    create_matplotlib_chart(
                        chart_type="line",
                        data=alerts_series,
                        title="Alerts generated over time (persisted)",
                        xlabel="Date",
                        ylabel="Alerts",
                    )
                )
            else:
                self._add_evidence_gap(story, "Alert time series is not available for this run.")
            wl_series = self._build_workload_series()
            if wl_series:
                story.append(Spacer(1, 0.18 * inch))
                story.append(
                    create_matplotlib_chart(
                        chart_type="line",
                        data=wl_series,
                        title="Workload simulation alerts over time (persisted)",
                        xlabel="Date",
                        ylabel="Alerts",
                    )
                )
            else:
                self._add_evidence_gap(story, "Workload simulation series is not available for this run.")
            t = self._get_inference_text(run_id, "STEP_6", "ops")
            if t:
                box = create_ai_explanation_box(t)
                if box:
                    story.append(box)
            return

        if spec.section_key == "limitations":
            story.append(
                Paragraph(
                    "Limitations must be explicitly recorded as evidence. This section lists only limitations that are supported by persisted observations.",
                    self.styles["BodyText"],
                )
            )
            gaps = []
            if not self._table_exists("evidence_step0_overall"):
                gaps.append("Data foundation profiling not persisted.")
            if not self._table_exists("calibration_boundary_candidates"):
                gaps.append("Threshold search space (candidates) not persisted.")
            if not self._table_exists("ks_validation_results"):
                gaps.append("KS validation results not persisted.")
            if not self._table_exists("workload_simulation_results"):
                gaps.append("Operational workload simulation not persisted.")
            if gaps:
                rows = [["Limitation", "Evidence basis"]]
                for g in gaps:
                    rows.append([g, "Not present in DuckDB for this run."])
                self._add_metrics_table(story, "Evidence-backed limitations", rows, col_widths=[3.6 * inch, 2.4 * inch])
            else:
                self._add_metrics_table(
                    story,
                    "Evidence-backed limitations",
                    [["Limitation", "Evidence basis"], ["No material evidence gaps detected", "All required evidence tables present."]],
                    col_widths=[3.6 * inch, 2.4 * inch],
                )
            return

        if spec.section_key == "governance":
            story.append(
                Paragraph(
                    "Governance evidence must demonstrate approval state, immutability controls, and next review requirements.",
                    self.styles["BodyText"],
                )
            )
            story.append(
                create_professional_table(
                    [
                        ["Governance field", "Value"],
                        ["Approval status", "Not recorded in BTSY evidence for this run" if not self._table_exists("calibration_governance") else "Recorded"],
                        ["Immutability", "Run is reproducible only to the extent snapshot identifiers are persisted."],
                        ["Next review date", "Not recorded"],
                    ],
                    col_widths=[2.2 * inch, 3.8 * inch],
                )
            )
            t = self._get_inference_text(run_id, "STEP_6", "governance")
            if t:
                box = create_ai_explanation_box(t)
                if box:
                    story.append(box)
            return

        if spec.section_key == "final_interpretation":
            story.append(
                Paragraph(
                    "This conclusion summarises whether the calibration outcome is defensible for deployment, based strictly on persisted evidence and recorded governance controls.",
                    self.styles["BodyText"],
                )
            )
            final = self._build_boundary_final()
            alert_cnt = self._safe_fetchone("SELECT COUNT(1) FROM alerts") if self._table_exists("alerts") else None
            a = int(alert_cnt[0] or 0) if alert_cnt else 0
            threshold = float(final[1]) if final and final[1] is not None else None
            rows = [
                ["Conclusion field", "Value"],
                ["Selected threshold", str(threshold) if threshold is not None else "N/A"],
                ["Alerts generated", f"{a:,}"],
                ["Evidence completeness", "Partial" if a == 0 else "Recorded for alerting and calibration outcome"],
                ["Governance status", "Not recorded for this run"],
            ]
            self._add_metrics_table(story, "Regulatory conclusion (evidence-backed)", rows, col_widths=[2.6 * inch, 3.4 * inch])
            t = self._get_inference_text(run_id, "STEP_6", "governance")
            if t:
                box = create_ai_explanation_box(t)
                if box:
                    story.append(box)
            return

        story.append(Paragraph("Section content is pending evidence capture for this run.", self.styles["BodyText"]))
