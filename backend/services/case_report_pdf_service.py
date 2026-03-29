import tempfile
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


class CaseReportPDFService:
    def __init__(self):
        styles = getSampleStyleSheet()
        self.styles = {
            "title": ParagraphStyle("CaseReportTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=colors.HexColor("#2C2C2C"), alignment=TA_CENTER),
            "subtitle": ParagraphStyle("CaseReportSubtitle", parent=styles["BodyText"], fontName="Helvetica", fontSize=10, leading=14, textColor=colors.HexColor("#53565A"), alignment=TA_CENTER),
            "section": ParagraphStyle("CaseReportSection", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=colors.HexColor("#D04A02"), spaceAfter=6),
            "body": ParagraphStyle("CaseReportBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.3, leading=13.5, textColor=colors.HexColor("#2C2C2C")),
            "small": ParagraphStyle("CaseReportSmall", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5, leading=12, textColor=colors.HexColor("#53565A")),
        }

    def generate_pdf(self, report_payload, output_path=None):
        if not output_path:
            fd, output_path = tempfile.mkstemp(suffix=".pdf", prefix="case_report_")
            Path(output_path).unlink(missing_ok=True)

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        doc = SimpleDocTemplate(
            str(output_path),
            pagesize=A4,
            leftMargin=0.55 * inch,
            rightMargin=0.55 * inch,
            topMargin=0.65 * inch,
            bottomMargin=0.6 * inch,
        )
        story = []
        cases = report_payload.get("cases") or []
        batch_title = report_payload.get("report_name") or "Case Dossier"

        if report_payload.get("report_scope") == "combined":
            story.extend(self._cover_page(batch_title, report_payload.get("batch_ref") or "Batch Report", report_payload.get("generated_by") or "Analyst", report_payload.get("generated_at")))
            story.append(PageBreak())

        for index, case_report in enumerate(cases):
            story.extend(self._render_case(case_report, report_payload))
            if index < len(cases) - 1:
                story.append(PageBreak())

        doc.build(story, onFirstPage=self._decorate_page, onLaterPages=self._decorate_page)
        return str(output_path)

    def _decorate_page(self, canvas, doc):
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#D04A02"))
        canvas.rect(doc.leftMargin, A4[1] - 30, doc.width, 3, fill=1, stroke=0)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#53565A"))
        canvas.drawString(doc.leftMargin, 18, "FCIP Investigation Report")
        canvas.drawRightString(A4[0] - doc.rightMargin, 18, f"Page {doc.page}")
        canvas.restoreState()

    def _cover_page(self, title, subject, analyst_name, generated_at):
        rows = [
            ["Report", title],
            ["Subject", subject],
            ["Analyst", analyst_name or "-"],
            ["Generated", generated_at or "-"],
        ]
        return [
            Spacer(1, 0.9 * inch),
            Paragraph("FCIP Investigation Workbench", self.styles["title"]),
            Spacer(1, 0.12 * inch),
            Paragraph("Case Dossier and Investigation Report", self.styles["subtitle"]),
            Spacer(1, 0.45 * inch),
            self._metadata_table(rows),
        ]

    def _render_case(self, report_case, report_payload):
        story = []
        cover = report_case.get("cover") or {}
        story.extend(self._cover_page(
            report_payload.get("report_name") or "Case Dossier",
            f"Case {cover.get('case_id')}",
            cover.get("analyst_name"),
            cover.get("generated_date"),
        ))
        story.append(Spacer(1, 0.25 * inch))
        story.append(self._section("Executive Summary"))
        story.append(Paragraph(report_case.get("executive_summary") or "Executive summary not available.", self.styles["body"]))
        story.append(Spacer(1, 0.12 * inch))

        overview = report_case.get("case_overview") or {}
        story.append(self._section("Case Overview"))
        story.append(self._metadata_table([
            ["Case ID", cover.get("case_id")],
            ["Customer", cover.get("customer_id")],
            ["Account", cover.get("account_id")],
            ["Risk Level", cover.get("risk_level")],
            ["Status", cover.get("status")],
            ["Scenario", overview.get("metadata", {}).get("scenario_name")],
        ]))

        story.append(self._section("Evidence Summary"))
        story.append(Paragraph(report_case.get("evidence_explanation") or report_case.get("evidence_summary", {}).get("narrative_seed") or "Evidence explanation not available.", self.styles["body"]))
        story.extend(self._bullet_lines(report_case.get("evidence_summary", {}).get("indicator_list", [])[:6]))

        txn = report_case.get("transaction_ledger") or {}
        story.append(self._section("Transaction Ledger"))
        story.append(self._metadata_table([
            ["Transaction Count", txn.get("count")],
            ["Total Amount", txn.get("total_amount")],
            ["Peak Activity", txn.get("peak_activity")],
            ["Patterns", ", ".join(txn.get("patterns", [])[:4])],
        ]))
        story.append(self._simple_table(
            ["Date", "Reference", "Amount", "Type", "Counterparty", "Channel"],
            [[row.get("date"), row.get("reference"), row.get("amount"), row.get("type"), row.get("counterparty"), row.get("channel")] for row in txn.get("rows", [])[:12]],
        ))

        copilot = report_case.get("copilot_insights") or {}
        story.append(self._section("AI Investigation Insights"))
        story.append(self._metadata_table([
            ["Risk Score", copilot.get("risk_score")],
            ["Risk Profile", copilot.get("risk_profile")],
            ["Risk Drivers", copilot.get("risk_drivers")],
            ["Next Steps", copilot.get("next_steps")],
            ["Missing Evidence", copilot.get("missing_evidence")],
        ]))

        story.append(self._section("Review Questions"))
        story.extend(self._bullet_lines(report_case.get("review_questions") or []))

        lineage = report_case.get("lineage") or {}
        story.append(self._section("Case Lineage"))
        story.append(self._metadata_table([
            ["Rule to Alert", lineage.get("origin_chain", {}).get("rule_to_alert")],
            ["Alert to Transaction", lineage.get("origin_chain", {}).get("alert_to_transaction")],
            ["Transaction to Account", lineage.get("origin_chain", {}).get("transaction_to_account")],
            ["Account to Customer", lineage.get("origin_chain", {}).get("account_to_customer")],
        ]))
        story.append(Paragraph(str(lineage.get("narrative") or "Lineage narrative not available."), self.styles["body"]))

        similar = report_case.get("similar_cases") or {}
        story.append(self._section("Similar Cases and Comparison"))
        story.append(Paragraph(report_case.get("comparison_explanation") or "Similar-case comparison narrative not available.", self.styles["body"]))
        story.append(self._simple_table(
            ["Case", "Score", "Shared Indicators", "Outcome"],
            [[item.get("case_id"), item.get("similarity_score"), ", ".join(item.get("matched_because", [])[:3]), item.get("resolution_outcome")] for item in similar.get("matches", [])[:5]],
        ))

        graph = report_case.get("graph_summary") or {}
        story.append(self._section("Graph Analysis Summary"))
        story.append(self._metadata_table([
            ["Entities", graph.get("entities")],
            ["Clusters", graph.get("clusters")],
            ["Central Nodes", ", ".join(graph.get("central_nodes", [])[:5])],
            ["Network Risk", (graph.get("network_risk_assessment") or {}).get("score")],
            ["Visibility Note", graph.get("visibility_limitations")],
        ]))
        story.append(Paragraph(str(graph.get("narrative") or "Graph narrative not available."), self.styles["body"]))
        if graph.get("hub_entities"):
            story.append(Paragraph(f"Hub entities: {', '.join(str(item.get('label') or '-') for item in graph.get('hub_entities', [])[:5])}", self.styles["small"]))
        if graph.get("bridge_entities"):
            story.append(Paragraph(f"Bridge entities: {', '.join(str(item.get('label') or '-') for item in graph.get('bridge_entities', [])[:5])}", self.styles["small"]))

        rules = report_case.get("rule_typology") or {}
        story.append(self._section("Rule Engine and Typology"))
        story.append(self._metadata_table([
            ["Triggered Rules", ", ".join(rules.get("rules", [])[:6])],
            ["Primary Typology", rules.get("primary_typology")],
            ["Typologies", ", ".join(rules.get("typologies", [])[:6])],
        ]))
        summary = rules.get("summary") or {}
        if summary.get("typology_explanation"):
            story.append(Paragraph(str(summary.get("typology_explanation")), self.styles["body"]))
        if summary.get("supporting_evidence"):
            story.extend(self._bullet_lines(summary.get("supporting_evidence")[:6]))

        resolution = report_case.get("resolution") or {}
        story.append(self._section("Resolution"))
        story.append(self._metadata_table([
            ["Final Decision", resolution.get("final_action")],
            ["Analyst Comments", resolution.get("analyst_comments")],
            ["Justification", resolution.get("justification")],
            ["Escalation Reason", resolution.get("escalation_reason")],
            ["SAR Draft Status", resolution.get("sar_status")],
            ["SAR Accepted At", resolution.get("sar_accepted_at")],
            ["SAR Accepted By", resolution.get("sar_accepted_by")],
        ]))
        if resolution.get("accepted_sar_draft"):
            story.append(Paragraph(str(resolution.get("accepted_sar_draft")), self.styles["body"]))

        appendix = report_case.get("appendix") or {}
        story.append(self._section("Appendix"))
        story.append(self._metadata_table([
            ["Risk Score", appendix.get("feature_summary", {}).get("risk_score")],
            ["Alert Count", appendix.get("feature_summary", {}).get("alert_count")],
            ["Transaction Count", appendix.get("feature_summary", {}).get("transaction_count")],
            ["Total Amount", appendix.get("feature_summary", {}).get("total_amount")],
            ["Pipeline", appendix.get("source_metadata", {}).get("pipeline_name")],
            ["Publish Label", appendix.get("source_metadata", {}).get("publish_label")],
        ]))
        return story

    def _section(self, title):
        return Paragraph(title, self.styles["section"])

    def _metadata_table(self, rows):
        data = [[Paragraph(f"<b>{str(label)}</b>", self.styles["small"]), Paragraph(str(value or "-"), self.styles["body"])] for label, value in rows]
        table = Table(data, colWidths=[1.65 * inch, 4.95 * inch], hAlign="LEFT")
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.white),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E6E6E6")),
            ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#F1F3F5")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        return table

    def _simple_table(self, headers, rows):
        data = [headers]
        if rows:
            for row in rows:
                data.append([Paragraph(str(value if value not in (None, "") else "-"), self.styles["small"]) for value in row])
        else:
            data.append([Paragraph("-", self.styles["small"]) for _ in headers])
        table = Table(data, repeatRows=1, hAlign="LEFT")
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#FFF4EE")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#2C2C2C")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 8.5),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E6E6E6")),
            ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#F1F3F5")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        return table

    def _bullet_lines(self, items):
        if not items:
            return [Paragraph("No additional items recorded.", self.styles["small"])]
        return [Paragraph(f"• {str(item)}", self.styles["body"]) for item in items]
