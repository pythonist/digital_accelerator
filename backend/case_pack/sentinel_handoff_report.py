from __future__ import annotations

import io
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from case_pack.case_pack_generator import CasePackGenerator


def _safe_text(value: Any, default: str = "-") -> str:
    if value is None:
        return default
    text = str(value).strip()
    return text if text else default


def _safe_num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def _read_table(conn, table_name: str) -> pd.DataFrame:
    try:
        return pd.read_sql(f'SELECT * FROM "{table_name}"', conn)
    except Exception:
        return pd.DataFrame()


def _read_active_scope_case_ids(conn) -> Optional[List[str]]:
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='active_case_scope'")
        if not cursor.fetchone():
            return None
        cursor.execute("SELECT scope_type, case_ids FROM active_case_scope WHERE id = 1")
        row = cursor.fetchone()
        if not row:
            return None
        scope_type, case_ids_json = row
        if str(scope_type or "GLOBAL").upper() == "GLOBAL":
            return None
        try:
            case_ids = list(dict.fromkeys([str(value).strip() for value in (pd.read_json(case_ids_json, typ="series").tolist() if False else [])]))
        except Exception:
            case_ids = []
        if not case_ids_json:
            return []
        try:
            import json
            raw_case_ids = json.loads(case_ids_json)
            case_ids = list(dict.fromkeys([str(value).strip() for value in raw_case_ids if str(value or "").strip()]))
        except Exception:
            case_ids = []
        return case_ids
    except Exception:
        return None


def _filter_to_scope(df: pd.DataFrame, scope_case_ids: Optional[Iterable[str]]) -> pd.DataFrame:
    if df is None or df.empty or scope_case_ids is None:
        return df
    normalized = {str(value).strip() for value in scope_case_ids if str(value or "").strip()}
    if not normalized:
        return df.iloc[0:0].copy()
    case_col = next(
        (
            col for col in df.columns
            if "case" in str(col).lower() and ("id" in str(col).lower() or "no" in str(col).lower())
        ),
        None,
    )
    if not case_col:
        return df
    return df.loc[df[case_col].astype(str).str.strip().isin(normalized)].copy()


def _table_data_from_records(records: List[Dict[str, Any]], headers: List[str], *, limit: int = 10) -> List[List[str]]:
    data = [[str(header).replace("_", " ").title() for header in headers]]
    for row in (records or [])[:limit]:
        data.append([_safe_text(row.get(header)) for header in headers])
    if len(data) == 1:
        data.append(["-" for _ in headers])
    return data


def _table_data_from_df(df: pd.DataFrame, headers: List[str], *, limit: int = 10) -> List[List[str]]:
    if df is None or df.empty:
        return [[str(header).replace("_", " ").title() for header in headers], ["-" for _ in headers]]
    rows = []
    for _, row in df.loc[:, [header for header in headers if header in df.columns]].head(limit).iterrows():
        rows.append({header: row.get(header) for header in headers if header in df.columns})
    normalized_headers = [header for header in headers if header in df.columns]
    if not normalized_headers:
        normalized_headers = list(df.columns[: min(6, len(df.columns))])
    return _table_data_from_records(rows, normalized_headers, limit=limit)


def _styled_table(data: List[List[str]], *, column_widths: Optional[List[float]] = None) -> Table:
    table = Table(data, colWidths=column_widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f3b5c")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("FONTSIZE", (0, 1), (-1, -1), 7.5),
                ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d6dde8")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def _build_case_pack_pages(case_packs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    pages: List[Dict[str, Any]] = []
    for pack in case_packs:
        metadata = pack.get("metadata") or {}
        financial = pack.get("financial_profile") or {}
        network = pack.get("network_profile") or {}
        typologies = pack.get("typology_flags") or []
        alerts = pack.get("alerts") or []
        transactions = pack.get("transactions") or []
        case_id = _safe_text(pack.get("case_id"))

        summary_rows = [
            {"attribute": "Case ID", "value": case_id},
            {"attribute": "Customer", "value": metadata.get("customer_name") or metadata.get("customer_id")},
            {"attribute": "Risk Rating", "value": metadata.get("risk_rating") or pack.get("risk_score")},
            {"attribute": "Alert Type", "value": metadata.get("alert_type")},
            {"attribute": "Pipeline", "value": metadata.get("fcc_pipeline_name")},
            {"attribute": "Publish Package", "value": metadata.get("fcc_publish_id")},
        ]
        pages.append(
            {
                "title": f"Case Pack Overview - {case_id}",
                "paragraphs": [
                    "This page summarizes the retained case as it entered Sentinel after FCC suppression.",
                    f"The case was retained because the FCC model flagged it above the active threshold and routed it into the investigation queue.",
                ],
                "tables": [
                    _table_data_from_records(summary_rows, ["attribute", "value"], limit=10),
                    _table_data_from_records(
                        [
                            {
                                "metric": "Risk Score",
                                "value": metadata.get("risk_score") or pack.get("risk_score"),
                            },
                            {
                                "metric": "Total Volume",
                                "value": round(_safe_num(financial.get("total_volume")), 2),
                            },
                            {
                                "metric": "Average Transaction",
                                "value": round(_safe_num(financial.get("avg_transaction")), 2),
                            },
                            {
                                "metric": "Top Counterparty Count",
                                "value": len(network.get("top_counterparties") or []),
                            },
                            {
                                "metric": "Typology Flags",
                                "value": len(typologies),
                            },
                        ],
                        ["metric", "value"],
                        limit=10,
                    ),
                ],
            }
        )
        pages.append(
            {
                "title": f"Case Pack Evidence - {case_id}",
                "paragraphs": [
                    "The evidence page consolidates the first retained alerts, transactions, and typology signals that an investigator would review.",
                    "This mirrors the business demonstration path: retained FCC outputs flow into Sentinel where case analysts continue with evidence-led review.",
                ],
                "tables": [
                    _table_data_from_records(alerts, ["alert_id", "alert_type", "severity", "amount", "fcc_score"], limit=8),
                    _table_data_from_records(transactions, ["transaction_id", "txn_timestamp", "amount", "direction", "counterparty_account"], limit=8),
                    _table_data_from_records(typologies, ["type", "severity", "desc"], limit=6),
                ],
            }
        )
    return pages


def generate_sentinel_handoff_report_pdf(
    db_manager,
    *,
    handoff: Optional[Dict[str, Any]] = None,
    scope_case_ids: Optional[Iterable[str]] = None,
    audience: str = "technical",
    strict_min_pages: bool = True,
) -> bytes:
    handoff = handoff or {}
    conn = db_manager.connect()
    try:
        inferred_scope = _read_active_scope_case_ids(conn)
        active_scope_case_ids = list(scope_case_ids) if scope_case_ids is not None else inferred_scope

        df_cases = _filter_to_scope(_read_table(conn, "cases"), active_scope_case_ids)
        df_alerts = _filter_to_scope(_read_table(conn, "alerts"), active_scope_case_ids)
        df_transactions = _filter_to_scope(_read_table(conn, "transactions"), active_scope_case_ids)
        df_accounts = _filter_to_scope(_read_table(conn, "accounts"), active_scope_case_ids)
        df_customers = _filter_to_scope(_read_table(conn, "customers"), active_scope_case_ids)
        df_imports = _read_table(conn, "fcc_bridge_imports")
        df_scored = _filter_to_scope(_read_table(conn, "fcc_scored_entities"), active_scope_case_ids)
    finally:
        db_manager.close_connection(conn)

    case_col = next((col for col in df_cases.columns if "case" in str(col).lower() and "id" in str(col).lower()), None)
    case_ids = (
        df_cases[case_col].astype(str).dropna().tolist()
        if case_col and not df_cases.empty
        else list(scope_case_ids or [])
    )

    latest_import = df_imports.iloc[0].to_dict() if not df_imports.empty else {}
    case_sample = df_cases.iloc[0].to_dict() if not df_cases.empty else {}
    pipeline_name = _safe_text(
        handoff.get("pipeline_name")
        or latest_import.get("pipeline_name")
        or case_sample.get("fcc_pipeline_name")
        or "FCC Workbench Pipeline"
    )
    pipeline_id = _safe_text(
        handoff.get("pipeline_id")
        or latest_import.get("pipeline_id")
        or case_sample.get("fcc_pipeline_id")
        or "-",
        "-",
    )
    run_id = _safe_text(handoff.get("run_id") or latest_import.get("run_id") or case_sample.get("fcc_source_run_id"))
    deployment_id = _safe_text(
        handoff.get("deployment_id")
        or latest_import.get("deployment_id")
        or case_sample.get("fcc_deployment_id")
    )
    publish_id = _safe_text(
        handoff.get("publish_id")
        or latest_import.get("publish_id")
        or case_sample.get("fcc_publish_id")
    )
    publish_label = _safe_text(
        handoff.get("publish_label")
        or latest_import.get("publish_label")
        or case_sample.get("fcc_publish_label")
    )
    threshold = _safe_text(handoff.get("threshold") or case_sample.get("threshold"))

    summary_rows = [
        {"metric": "Retained Cases In Scope", "value": len(case_ids)},
        {"metric": "Alerts Loaded In Sentinel", "value": int(len(df_alerts.index))},
        {"metric": "Transactions Available", "value": int(len(df_transactions.index))},
        {"metric": "Accounts Linked", "value": int(len(df_accounts.index))},
        {"metric": "Customers Linked", "value": int(len(df_customers.index))},
        {"metric": "Scored FCC Rows", "value": handoff.get("total_scored") or len(df_scored.index)},
        {"metric": "Suppressed In FCC", "value": handoff.get("suppressed_count")},
        {"metric": "Escalated To Sentinel", "value": handoff.get("escalated_count") or len(case_ids)},
    ]

    generator = CasePackGenerator(db_manager)
    case_packs = []
    for case_id in case_ids[:6]:
        try:
            case_packs.append(generator.generate_case_pack(case_id))
        except Exception:
            continue

    case_pack_pages = _build_case_pack_pages(case_packs)
    preview_pages: List[Dict[str, Any]] = []
    for title, preview, headers in (
        (
            "FCC Synthetic Master Data Preview",
            handoff.get("master_data_preview") or {},
            ["entity_id", "CUSTOMER_ID", "ACCOUNT_ID", "ALERT_ID", "CASE_ID", "TXN_AMOUNT", "CASE_STATUS"],
        ),
        (
            "FCC Prepared Feature Preview",
            handoff.get("prepared_feature_preview") or {},
            ["entity_id", "alert_id", "case_id"],
        ),
        (
            "FCC Prediction Output Preview",
            handoff.get("prediction_preview") or {},
            ["entity_id", "alert_id", "case_id", "model_score", "threshold", "decision", "reason_code"],
        ),
        (
            "Sentinel Retained Queue Preview",
            handoff.get("retained_preview") or {},
            ["entity_id", "alert_id", "case_id", "model_score", "threshold", "decision", "reason_code"],
        ),
    ):
        preview_rows = preview.get("rows") if isinstance(preview, dict) else []
        if not preview_rows:
            continue
        preview_pages.append(
            {
                "title": title,
                "paragraphs": [
                    "This page preserves the actual FCC handoff table so business users can see the exact data that moved downstream.",
                ],
                "tables": [_table_data_from_records(preview_rows, headers, limit=12)],
            }
        )

    page_specs: List[Dict[str, Any]] = [
        {
            "title": "Sentinel Handoff Report",
            "paragraphs": [
                f"Pipeline: {pipeline_name}",
                f"Pipeline ID: {pipeline_id}",
                f"Run ID: {run_id}",
                f"Deployment ID: {deployment_id}",
                f"Publish Package: {publish_id}",
                f"Publish Label: {publish_label}",
                "This report documents the retained FCC outputs that were handed into Sentinel for downstream AML investigation.",
            ],
            "tables": [],
        },
        {
            "title": "Executive Summary",
            "paragraphs": [
                "The FCC workbench generated synthetic unseen activity, scored it with the trained suppression model, filtered out low-risk false positives, and handed only the retained population into Sentinel.",
                "Sentinel then continued the journey with case-level review, evidence assembly, network context, and downloadable case-investigation documentation.",
            ],
            "tables": [_table_data_from_records(summary_rows, ["metric", "value"], limit=12)],
        },
        {
            "title": "Journey Narrative",
            "paragraphs": [
                "Step 1: synthetic FCC alerts mimic real production alerts from an upstream transaction-monitoring platform.",
                "Step 2: the FCC workbench builds master data, aligns preprocessing, and scores unseen entities.",
                "Step 3: rows suppressed by the model remain in FCC, while retained rows flow into Sentinel for investigation.",
                "Step 4: Sentinel shows only the active FCC handoff scope so preloaded raw Sentinel data does not distract the business walkthrough.",
            ],
            "tables": [
                _table_data_from_records(
                    [
                        {"attribute": "Requested FCC Rows", "value": handoff.get("requested_row_count")},
                        {"attribute": "Threshold Applied", "value": threshold},
                        {"attribute": "Model Run", "value": run_id},
                        {"attribute": "Deployment", "value": deployment_id},
                        {"attribute": "Pipeline", "value": pipeline_name},
                    ],
                    ["attribute", "value"],
                    limit=10,
                )
            ],
        },
        {
            "title": "Scope And Data Contract",
            "paragraphs": [
                "The active Sentinel scope contains only the FCC-retained case population for this handoff.",
                "This prevents previously loaded Sentinel datasets from appearing in the downstream demo journey.",
            ],
            "tables": [
                _table_data_from_records(
                    [
                        {"control": "Scoped Cases", "value": len(case_ids)},
                        {"control": "Scoped Alerts", "value": int(len(df_alerts.index))},
                        {"control": "Scoped Transactions", "value": int(len(df_transactions.index))},
                        {"control": "Scoped Accounts", "value": int(len(df_accounts.index))},
                        {"control": "Scoped Customers", "value": int(len(df_customers.index))},
                    ],
                    ["control", "value"],
                    limit=10,
                ),
                _table_data_from_df(df_cases, [case_col or "case_id", "customer_name", "risk_rating", "fcc_pipeline_name", "fcc_publish_id"], limit=10),
            ],
        },
        {
            "title": "Retained Case Inventory",
            "paragraphs": [
                "This inventory is the working Sentinel queue for the FCC handoff.",
            ],
            "tables": [_table_data_from_df(df_cases, [case_col or "case_id", "customer_name", "risk_rating", "risk_score", "status", "fcc_pipeline_name"], limit=12)],
        },
        {
            "title": "Retained Alert Inventory",
            "paragraphs": [
                "Alert-level evidence remains available for analysts even after FCC suppression removed false positives earlier in the flow.",
            ],
            "tables": [_table_data_from_df(df_alerts, ["alert_id", "case_id", "alert_type", "severity", "amount", "fcc_score"], limit=12)],
        },
        {
            "title": "Transaction Evidence Inventory",
            "paragraphs": [
                "Transactions linked to the retained cases provide the factual basis for downstream case-pack and graph analysis.",
            ],
            "tables": [_table_data_from_df(df_transactions, ["transaction_id", "case_id", "account_id", "amount", "direction", "txn_timestamp"], limit=12)],
        },
        {
            "title": "Scored FCC Output Audit",
            "paragraphs": [
                "The scored FCC entity log below is retained for auditability so the Sentinel team can trace why a case arrived downstream.",
            ],
            "tables": [_table_data_from_df(df_scored, ["entity_id", "case_id", "alert_id", "model_score", "decision", "reason_code"], limit=12)],
        },
    ]
    page_specs.extend(preview_pages)
    page_specs.extend(case_pack_pages)

    min_pages = 20 if str(audience or "technical").lower() == "technical" else 12
    if strict_min_pages and len(page_specs) < min_pages:
        appendix_source = [
            ("Appendix - Additional Case Inventory", df_cases, [case_col or "case_id", "customer_name", "risk_rating", "risk_score", "fcc_publish_id"]),
            ("Appendix - Additional Alert Inventory", df_alerts, ["alert_id", "case_id", "alert_type", "severity", "amount"]),
            ("Appendix - Additional Transaction Inventory", df_transactions, ["transaction_id", "case_id", "account_id", "amount", "direction"]),
        ]
        page_index = 0
        while len(page_specs) < min_pages:
            title, df_source, headers = appendix_source[page_index % len(appendix_source)]
            offset = (page_index // len(appendix_source)) * 10
            if df_source is None or df_source.empty:
                table_data = _table_data_from_records(
                    [{"note": "No additional scoped rows were available for this appendix page.", "detail": pipeline_name}],
                    ["note", "detail"],
                    limit=4,
                )
            else:
                sliced = df_source.iloc[offset : offset + 10].copy()
                if sliced.empty:
                    sliced = df_source.head(10).copy()
                table_data = _table_data_from_df(sliced, headers, limit=10)
            page_specs.append(
                {
                    "title": f"{title} {page_index + 1}",
                    "paragraphs": [
                        "Appendix pages extend the report so reviewers can inspect the retained FCC-to-Sentinel dataset in detail.",
                    ],
                    "tables": [table_data],
                }
            )
            page_index += 1

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="ReportTitle", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=colors.HexColor("#1f2937")))
    styles.add(ParagraphStyle(name="ReportHeading", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=colors.HexColor("#1d4ed8"), spaceAfter=8))
    styles.add(ParagraphStyle(name="ReportBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.5, leading=13, textColor=colors.HexColor("#334155"), spaceAfter=6))

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=0.55 * inch,
        rightMargin=0.55 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
    )
    story: List[Any] = []

    def draw_page_number(canvas, doc_obj):
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawRightString(A4[0] - doc_obj.rightMargin, 0.4 * inch, f"Page {canvas.getPageNumber()}")
        canvas.drawString(doc_obj.leftMargin, 0.4 * inch, f"Sentinel FCC Handoff Report | {pipeline_name}")

    for index, spec in enumerate(page_specs):
        title = _safe_text(spec.get("title"), "Sentinel Handoff Report")
        story.append(Paragraph(title, styles["ReportTitle"] if index == 0 else styles["ReportHeading"]))
        story.append(Spacer(1, 0.16 * inch))
        for paragraph in spec.get("paragraphs") or []:
            story.append(Paragraph(_safe_text(paragraph), styles["ReportBody"]))
        for table_data in spec.get("tables") or []:
            story.append(_styled_table(table_data))
            story.append(Spacer(1, 0.18 * inch))
        if index < len(page_specs) - 1:
            story.append(PageBreak())

    doc.build(story, onFirstPage=draw_page_number, onLaterPages=draw_page_number)
    return buffer.getvalue()
