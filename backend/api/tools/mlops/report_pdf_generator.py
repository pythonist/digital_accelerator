from __future__ import annotations

import io
import json
from pathlib import Path
from textwrap import shorten
from typing import Any, Dict, Iterable, List, Optional, Sequence
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image as RLImage
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from calibration.services.pdf_reporting.styles import ReportTheme

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    HAS_MATPLOTLIB = True
except Exception:
    plt = None
    HAS_MATPLOTLIB = False


def create_professional_table(data, col_widths=None):
    styles = ReportTheme.get_styles()
    if not data:
        return Paragraph("No data available", styles["BodyText"])

    formatted = []
    header = [Paragraph(f"<b>{escape(str(cell))}</b>", styles["TableHeader"]) for cell in data[0]]
    formatted.append(header)
    for row in data[1:]:
        formatted_row = []
        for cell in row:
            if isinstance(cell, str):
                formatted_row.append(Paragraph(escape(cell), styles["TableCell"]))
            else:
                formatted_row.append(str(cell))
        formatted.append(formatted_row)

    table = Table(formatted, colWidths=col_widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), ReportTheme.PWC_ORANGE),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
                ("TOPPADDING", (0, 0), (-1, 0), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 1), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.4, ReportTheme.BORDER_GREY),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ReportTheme.BG_LIGHT]),
            ]
        )
    )
    return table


def create_metric_card_table(metrics):
    styles = ReportTheme.get_styles()
    rows = []
    current = []
    for idx, metric in enumerate(metrics or []):
        label = escape(str(metric.get("label") or ""))
        value = escape(str(metric.get("value") or ""))
        current.append(
            [
                Paragraph(f'<font size="7" color="{_color_hex(ReportTheme.TEXT_SECONDARY)}">{label}</font>', styles["BodyText"]),
                Spacer(1, 2),
                Paragraph(f'<font size="11"><b>{value}</b></font>', styles["BodyText"]),
            ]
        )
        if (idx + 1) % 3 == 0 or idx == len(metrics) - 1:
            while len(current) < 3:
                current.append("")
            rows.append(current)
            current = []

    table = Table(rows, colWidths=[2.0 * inch, 2.0 * inch, 2.0 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, ReportTheme.BORDER_GREY),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, ReportTheme.BORDER_GREY),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def _safe_text(value: Any, default: str = "-") -> str:
    if value is None:
        return default
    text = str(value).strip()
    return text if text else default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def _has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _fmt_int(value: Any, default: str = "Not recorded") -> str:
    return f"{_to_int(value, 0):,}" if _has_value(value) else default


def _fmt_ratio(value: Any, decimals: int = 4, default: str = "Not recorded") -> str:
    return f"{_to_float(value, 0.0):.{decimals}f}" if _has_value(value) else default


def _fmt_pct(value: Any, decimals: int = 2, *, treat_ratio_as_pct: bool = False, default: str = "Not recorded") -> str:
    if not _has_value(value):
        return default
    pct = _to_float(value, 0.0)
    if treat_ratio_as_pct and pct <= 1.0:
        pct *= 100.0
    return f"{pct:.{decimals}f}%"


def _humanize_field_name(name: Any) -> str:
    text = " ".join(str(name or "").replace("_", " ").replace("-", " ").split()).strip()
    return text.title() if text else "Business Signal"


def _is_business_audience(audience: Any) -> bool:
    return str(audience or "").strip().lower() != "technical"


def _business_algorithm_name(name: Any) -> str:
    text = _safe_text(name, "").lower()
    if not text:
        return "Prioritisation model"
    if "logistic" in text:
        return "Statistical prioritisation model"
    if "forest" in text or "xgboost" in text or "boost" in text:
        return "Tree-based prioritisation model"
    if "decision tree" in text:
        return "Rule-style prioritisation model"
    if "knn" in text or "nearest" in text:
        return "Similarity-based prioritisation model"
    return _humanize_field_name(name)


def _mapping_business_usage(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"1", "true", "positive", "pos", "yes"} or "suspicious" in text or "positive" in text:
        return "Counted as a confirmed suspicious case"
    if text in {"0", "false", "negative", "neg", "no"} or "non-suspicious" in text or "negative" in text:
        return "Counted as a confirmed non-suspicious case"
    return "Excluded until a reliable investigation outcome existed"


def _business_outcome_name(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"1", "positive", "pos", "true", "yes"} or "suspicious" in text:
        return "Confirmed Suspicious"
    if text in {"0", "negative", "neg", "false", "no"} or "non-suspicious" in text:
        return "Confirmed Non-Suspicious"
    if text in {"open", "pending", "unknown"}:
        return "Open Or Unresolved"
    return _humanize_field_name(value)


def _split_strategy_label(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text == "temporal":
        return "Time-based holdout review"
    if text == "random":
        return "Random holdout review"
    return _humanize_field_name(value)


def _business_rate_label(value: Any, *, good_default: str = "Not recorded") -> str:
    return _fmt_pct(value, 2, treat_ratio_as_pct=True, default=good_default)


def _business_signal_relationship(value: Any) -> str:
    if not _has_value(value):
        return "The early review did not record a clear relationship."
    raw = _to_float(value, 0.0)
    score = abs(raw)
    if score >= 0.45:
        strength = "Strong early relationship"
    elif score >= 0.25:
        strength = "Moderate early relationship"
    elif score >= 0.10:
        strength = "Light but usable relationship"
    else:
        strength = "Weak early relationship"
    direction = (
        "Higher values appeared more often in confirmed suspicious cases."
        if raw >= 0
        else "Lower values appeared more often in confirmed suspicious cases."
    )
    return f"{strength}. {direction}"


def _business_influence_label(value: Any) -> str:
    if not _has_value(value):
        return "Influence was not recorded"
    score = abs(_to_float(value, 0.0))
    if score >= 0.20:
        return "High influence on prioritisation"
    if score >= 0.08:
        return "Moderate influence on prioritisation"
    if score > 0:
        return "Supporting influence on prioritisation"
    return "Influence was not recorded"


def _color_hex(color_obj: Any, fallback: str = "#000000") -> str:
    try:
        raw = str(color_obj.hexval())
        if raw.startswith("0x"):
            return "#" + raw[2:]
        if raw.startswith("#"):
            return raw
        return "#" + raw[-6:]
    except Exception:
        return fallback


class FCCWorkbenchNarrativeService:
    def __init__(self, ollama: Any = None):
        self.ollama = self._resolve_ollama(ollama)
        self.model = self._resolve_model(self.ollama)
        self._cache: Dict[str, str] = {}

    def _resolve_ollama(self, ollama: Any) -> Any:
        for candidate in self._iter_candidates(ollama):
            try:
                if candidate and hasattr(candidate, "check_connection") and candidate.check_connection():
                    return candidate
            except Exception:
                continue
        return None

    def _iter_candidates(self, provided: Any) -> Iterable[Any]:
        if provided is not None:
            yield provided

        try:
            from api.service_locator import services

            service_ollama = getattr(services, "ollama_wrapper", None)
            if service_ollama is not None:
                yield service_ollama
        except Exception:
            pass

        try:
            from llm.ollama_wrapper import OllamaWrapper

            for url in (None, "http://localhost:11434", "http://localhost:11435"):
                try:
                    yield OllamaWrapper(base_url=url) if url else OllamaWrapper()
                except Exception:
                    continue
        except Exception:
            return

    def _resolve_model(self, ollama: Any) -> Optional[str]:
        if not ollama:
            return None
        try:
            available = [str(model or "").strip() for model in ollama.list_models()]
        except Exception:
            available = []

        preferred = [
            "llama3.2:1b",
            "qwen2.5:1.5b",
            "qwen2.5:0.5b",
            "phi3:mini",
            "gemma2:2b",
            "tinyllama",
            "llama3.2:3b",
        ]
        lowered = {name.lower(): name for name in available if name}
        for wanted in preferred:
            exact = lowered.get(wanted.lower())
            if exact:
                return exact
            for name in available:
                if str(name).lower().startswith(wanted.lower()):
                    return name
        return getattr(ollama, "default_model", None)

    def build(
        self,
        section_key: str,
        *,
        instruction: str,
        context: Dict[str, Any],
        fallback: str,
        audience: str = "business",
        max_tokens: int = 260,
    ) -> str:
        cache_key = f"{audience}:{section_key}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        text = fallback
        if self.ollama and self.model:
            prompt = (
                "You are writing an AML model governance report for business readers.\n"
                "Write plain English for investigators, operations leads, and business stakeholders.\n"
                "Use concrete numbers from the context.\n"
                "Do not use emojis, hype, analogies, or vague language.\n"
                "Avoid unnecessary data-science jargon.\n"
                "Keep the answer to one or two short paragraphs.\n"
                f"Audience: {_safe_text(audience, 'business')}\n"
                f"Instruction: {instruction}\n"
                "Context JSON:\n"
                f"{json.dumps(context, default=str, ensure_ascii=True, indent=2)[:5000]}"
            )
            try:
                result = self.ollama.generate(
                    prompt=prompt,
                    model=self.model,
                    temperature=0.2,
                    max_tokens=max_tokens,
                )
                candidate = _safe_text((result or {}).get("response"), "").replace("*", "")
                if candidate:
                    text = candidate
            except Exception:
                text = fallback

        cleaned = "\n\n".join(part.strip() for part in str(text).split("\n\n") if part.strip())
        self._cache[cache_key] = cleaned or fallback
        return self._cache[cache_key]


class FCCWorkbenchReportPDFGenerator:
    WORKFLOW_ROWS = [
        ("1. Data intake", "Source tables are loaded into the workbench with row counts and file lineage."),
        ("2. Master build", "Relevant alert, case, and supporting data are combined into one model-ready dataset."),
        ("3. Target definition", "Investigator outcomes are turned into the truth label used for supervised learning."),
        ("4. EDA", "The workbench measures balance, missing data, rule behaviour, and signal separation."),
        ("5. Preprocessing", "Columns are cleaned, encoded, scaled, or engineered so the model can use them safely."),
        ("6. Model training", "Candidate logic is trained and measured on holdout data instead of being judged only on fit."),
        ("7. Validation", "Thresholds are tested against event loss and workload so operating policy is explicit."),
        ("8. Business deployment view", "The result is translated into queue volumes, analyst effort, and governance evidence."),
    ]

    def __init__(self, ollama: Any = None, logo_path: Optional[Path] = None):
        self.styles = ReportTheme.get_styles()
        self.logo_path = self._resolve_logo_path(logo_path)
        self.narratives = FCCWorkbenchNarrativeService(ollama)
        self._section_no = 1
        self._chart_width = 6.35 * inch
        self._chart_height = 3.15 * inch

    def generate(
        self,
        report: Dict[str, Any],
        chart_images: Optional[List[Dict[str, Any]]] = None,
        *,
        audience: str = "business",
        strict_min_pages: bool = True,
    ) -> bytes:
        self._section_no = 1
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=0.75 * inch,
            leftMargin=0.75 * inch,
            topMargin=0.9 * inch,
            bottomMargin=0.85 * inch,
            title=f"FCC Workbench AML Report - {_safe_text(report.get('run_id'))}",
            author="PwC FCC Workbench",
        )
        story = self._build_document(report or {}, chart_images or [], audience=audience, strict_min_pages=strict_min_pages)
        doc.build(story, onFirstPage=self._create_header_footer, onLaterPages=self._create_header_footer)
        return buffer.getvalue()

    def _resolve_logo_path(self, logo_path: Optional[Path]) -> Optional[str]:
        candidates: List[Path] = []
        if logo_path is not None:
            candidates.append(Path(logo_path))
        root = Path(__file__).resolve().parents[4]
        candidates.extend(
            [
                root / "frontend" / "src" / "assets" / "pricewaterhousecoopers-pwc-seeklogo.png",
                root / "frontend" / "src" / "assets" / "PwC_2025_Logo_1.png",
                root / "frontend" / "src" / "assets" / "fcc_analytics.png",
            ]
        )
        for candidate in candidates:
            if candidate and candidate.exists():
                return str(candidate)
        return None

    def _create_header_footer(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(ReportTheme.BORDER_GREY)
        canvas.setLineWidth(0.5)
        canvas.line(0.75 * inch, 0.8 * inch, A4[0] - 0.75 * inch, 0.8 * inch)
        if self.logo_path and Path(self.logo_path).exists():
            canvas.drawImage(
                self.logo_path,
                0.75 * inch,
                0.18 * inch,
                width=0.82 * inch,
                height=0.34 * inch,
                preserveAspectRatio=True,
                mask="auto",
            )
        else:
            canvas.setFont("Helvetica-Bold", 10)
            canvas.setFillColor(colors.black)
            canvas.drawString(0.75 * inch, 0.34 * inch, "PwC")
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(ReportTheme.TEXT_SECONDARY)
        canvas.drawString(1.72 * inch, 0.35 * inch, "FCC Workbench AML Run Report")
        canvas.drawRightString(A4[0] - 0.75 * inch, 0.35 * inch, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()

    def _build_document(
        self,
        report: Dict[str, Any],
        chart_images: List[Dict[str, Any]],
        *,
        audience: str,
        strict_min_pages: bool,
    ) -> List[Any]:
        is_business = _is_business_audience(audience)
        story = self._cover_page(report, audience) + self._contents_page(audience)
        ds = report.get("data_summary") or {}
        td = report.get("target_definition") or {}
        eda = report.get("eda_summary") or {}
        mp = report.get("model_performance") or {}
        ta = report.get("threshold_analysis") or {}
        bi = report.get("business_impact") or {}
        gov = report.get("governance") or {}
        pipeline = report.get("pipeline_summary") or {}
        preprocessing = report.get("preprocessing_summary") or {}
        feature_selection = report.get("feature_selection") or {}
        training = report.get("training_process") or {}
        report_narratives = report.get("narratives") or {}

        executive_story = self.narratives.build(
            "executive_summary",
            instruction="Write the executive summary for the AML model run and explain the operational decision in plain English.",
            context={
                "algorithm": mp.get("algorithm"),
                "labelled_rows": ds.get("labelled_rows"),
                "total_alerts": bi.get("total_alerts"),
                "suppression_pct": ta.get("recommended_suppression_pct"),
                "event_loss_pct": ta.get("recommended_event_loss_pct"),
                "regulatory_limit_pct": ta.get("regulatory_limit_pct"),
                "alerts_suppressed": bi.get("alerts_suppressed"),
                "alerts_escalated": bi.get("alerts_escalated"),
                "sars_caught": bi.get("sars_caught"),
                "sars_missed": bi.get("sars_missed"),
            },
            fallback=(
                f"The FCC Workbench trained {_safe_text(mp.get('algorithm'), 'the selected model')} on "
                f"{_to_int(ds.get('labelled_rows'), 0):,} labelled records so that alert handling could be measured against actual investigator outcomes. "
                f"At the recommended operating threshold of {_to_float(ta.get('recommended_threshold'), 0.5):.2f}, the model suppresses "
                f"{_to_float(ta.get('recommended_suppression_pct'), 0.0):.2f}% of alerts while holding Event Loss at "
                f"{_to_float(ta.get('recommended_event_loss_pct'), 0.0):.2f}% against a {_to_float(ta.get('regulatory_limit_pct'), 5.0):.2f}% ceiling.\n\n"
                f"In operating terms, that means {_to_int(bi.get('alerts_suppressed'), 0):,} alerts move out of manual review, "
                f"{_to_int(bi.get('alerts_escalated'), 0):,} stay in the queue for investigators, "
                f"{_to_int(bi.get('sars_caught'), 0):,} suspicious cases are kept in scope, and "
                f"{_to_int(bi.get('sars_missed'), 0):,} remain the miss-risk to govern."
            ),
            audience=audience,
            max_tokens=300,
        )
        workbench_story = self.narratives.build(
            "workbench_overview",
            instruction="Explain how the FCC Workbench improves AML operations from raw alerts through prioritised review.",
            context={
                "datasets": len(ds.get("datasets_used") or []),
                "pipeline_id": pipeline.get("pipeline_id"),
                "pipeline_name": pipeline.get("name"),
                "transforms": preprocessing.get("transform_count"),
                "threshold": ta.get("recommended_threshold"),
            },
            fallback=(
                "The FCC Workbench does more than fit a model. It documents how source data was combined, how the label was defined, "
                "how variables were prepared, how the model was tested, and how the final threshold changes analyst workload. "
                "That end-to-end evidence is what makes the output usable for operations, model governance, and audit review."
            ),
            audience=audience,
        )
        data_story = self.narratives.build(
            "data_story",
            instruction="Explain the data foundation, exclusions, and why the master dataset matters.",
            context={
                "datasets_used": ds.get("datasets_used"),
                "total_rows_before_exclusion": ds.get("total_rows_before_exclusion"),
                "labelled_rows": ds.get("labelled_rows"),
                "excluded_rows": ds.get("excluded_rows"),
                "label_source": ds.get("label_source"),
                "label_strategy": ds.get("label_strategy"),
                "split_type": ds.get("split_type"),
            },
            fallback=(
                f"The workbench assembled {_to_int(ds.get('total_rows_before_exclusion'), 0):,} rows across the available source tables and kept "
                f"{_to_int(ds.get('labelled_rows'), 0):,} rows for supervised learning. {_to_int(ds.get('excluded_rows'), 0):,} rows were excluded because the investigation outcome was still open or otherwise not reliable as ground truth.\n\n"
                "This matters because the model should learn from completed investigator decisions rather than from unresolved cases or from proxy indicators that can create circular logic."
            ),
            audience=audience,
        )
        feature_story = self.narratives.build(
            "feature_story",
            instruction="Explain why the main variables were selected and why leakage and identifier columns were removed.",
            context={
                "top_features": (mp.get("feature_importance") or [])[:8],
                "feature_diagnostics": feature_selection,
            },
            fallback=self._feature_story_fallback(report),
            audience=audience,
        )
        model_story = self.narratives.build(
            "model_story",
            instruction="Explain why this algorithm and validation setup are fit for AML alert prioritisation.",
            context={
                "algorithm": mp.get("algorithm"),
                "train_rows": ds.get("train_rows"),
                "test_rows": ds.get("test_rows"),
                "split_type": ds.get("split_type"),
                "split_date": ds.get("split_date"),
                "cv_auc_mean": mp.get("cv_auc_mean"),
                "cv_auc_std": mp.get("cv_auc_std"),
                "precision": mp.get("precision"),
                "recall": mp.get("recall"),
            },
            fallback=(
                f"{_business_algorithm_name(mp.get('algorithm')) if is_business else _safe_text(mp.get('algorithm'), 'The selected model')} was measured on a holdout sample rather than judged only on the data used to fit it. "
                f"The workbench kept {_to_int(ds.get('train_rows'), 0):,} rows for training and {_to_int(ds.get('test_rows'), 0):,} rows for testing, "
                f"with a {_split_strategy_label(ds.get('split_type')) if is_business else _safe_text(ds.get('split_type'), 'random')} split"
                + (f" anchored on {_safe_text(ds.get('split_date'))}" if ds.get("split_type") == "temporal" and ds.get("split_date") else "")
                + (
                    ".\n\nThat validation structure helps us judge whether the model can generalise beyond the sample used for fitting while keeping the review grounded in business outcomes such as missed suspicious cases, suspicious cases captured, and alerts set aside."
                    if is_business
                    else ".\n\nThat validation structure helps us judge whether the model can generalise beyond the sample used for fitting while keeping the review grounded in business outcomes such as Event Loss, recall, and suppression."
                )
            ),
            audience=audience,
        )
        threshold_story = self.narratives.build(
            "threshold_story",
            instruction="Explain the threshold choice in business terms, including event loss and workload trade-off.",
            context={
                "recommended_threshold": ta.get("recommended_threshold"),
                "suppression_pct": ta.get("recommended_suppression_pct"),
                "event_loss_pct": ta.get("recommended_event_loss_pct"),
                "regulatory_limit_pct": ta.get("regulatory_limit_pct"),
                "threshold_table": (ta.get("threshold_table") or [])[:12],
            },
            fallback=(
                f"Threshold {_to_float(ta.get('recommended_threshold'), 0.5):.2f} is the operating point where the workbench found the best workload reduction without breaking the Event Loss ceiling. "
                f"At that level, suppression reaches {_to_float(ta.get('recommended_suppression_pct'), 0.0):.2f}% while Event Loss remains at {_to_float(ta.get('recommended_event_loss_pct'), 0.0):.2f}% against a limit of {_to_float(ta.get('regulatory_limit_pct'), 5.0):.2f}%.\n\n"
                "Lower thresholds send more volume to analysts and reduce miss risk, while higher thresholds save more effort but can hide suspicious cases. The selected point keeps that trade-off explicit and governable."
            ),
            audience=audience,
        )
        impact_story = self.narratives.build(
            "impact_story",
            instruction="Explain the operational impact for investigators and business stakeholders.",
            context={
                "alerts_suppressed": bi.get("alerts_suppressed"),
                "alerts_escalated": bi.get("alerts_escalated"),
                "sars_caught": bi.get("sars_caught"),
                "sars_missed": bi.get("sars_missed"),
                "suppression_pct": ta.get("recommended_suppression_pct"),
                "event_loss_pct": ta.get("recommended_event_loss_pct"),
            },
            fallback=(
                f"From {_to_int(bi.get('total_alerts'), 0):,} alerts in scope, the recommended setting removes {_to_int(bi.get('alerts_suppressed'), 0):,} from manual handling and keeps {_to_int(bi.get('alerts_escalated'), 0):,} in the review queue. "
                f"It still captures {_to_int(bi.get('sars_caught'), 0):,} suspicious cases in the evaluation sample, while {_to_int(bi.get('sars_missed'), 0):,} remain the miss-risk to govern.\n\n"
                f"The business value is therefore not an abstract score. It is a clearer queue design: suppression at {_to_float(ta.get('recommended_suppression_pct'), 0.0):.2f}% with Event Loss controlled at {_to_float(ta.get('recommended_event_loss_pct'), 0.0):.2f}%."
            ),
            audience=audience,
        )
        governance_story = self.narratives.build(
            "governance_story",
            instruction="Explain the controls, limitations, and governance expectations for this run.",
            context={
                "event_loss_constraint": gov.get("event_loss_constraint"),
                "split_strategy": gov.get("split_strategy"),
                "proxy_label_warning": gov.get("proxy_label_warning"),
                "frameworks": gov.get("regulatory_frameworks"),
                "retraining_recommendation": gov.get("retraining_recommendation"),
            },
            fallback=(
                "This run is governed through explicit label lineage, a documented split strategy, and an Event Loss ceiling that turns risk appetite into an operating rule. "
                "The report also records limitations such as excluded open cases, any proxy-label warning, and the need to retrain when the alert population changes materially."
            ),
            audience=audience,
        )

        self._add_section(story, "Executive Summary", [executive_story, report_narratives.get("impact")])
        if is_business:
            story.append(create_metric_card_table([
                {"label": "Selected Approach", "value": _business_algorithm_name(mp.get("algorithm"))},
                {"label": "Alerts With Confirmed Outcome", "value": _fmt_int(ds.get("labelled_rows"))},
                {"label": "Selected Cut-Off", "value": _fmt_ratio(ta.get("recommended_threshold"), 3)},
                {"label": "Alerts Set Aside", "value": _fmt_pct(ta.get("recommended_suppression_pct"), 2)},
                {"label": "Suspicious Cases Missed", "value": _fmt_pct(ta.get("recommended_event_loss_pct"), 2)},
                {"label": "Escalated Queue Quality", "value": _business_rate_label(mp.get("precision"))},
                {"label": "Suspicious Cases Captured", "value": _business_rate_label(mp.get("recall"))},
            ]))
        else:
            story.append(create_metric_card_table([
                {"label": "Algorithm", "value": _safe_text(mp.get("algorithm"), "Not stated")},
                {"label": "AUC", "value": _fmt_ratio(mp.get("test_auc_roc"), 3)},
                {"label": "Threshold", "value": _fmt_ratio(ta.get("recommended_threshold"), 3)},
                {"label": "Suppression", "value": _fmt_pct(ta.get("recommended_suppression_pct"), 2)},
                {"label": "Event Loss", "value": _fmt_pct(ta.get("recommended_event_loss_pct"), 2)},
                {"label": "Precision", "value": _fmt_ratio(mp.get("precision"), 4)},
                {"label": "Recall", "value": _fmt_ratio(mp.get("recall"), 4)},
            ]))

        self._add_section(story, "What The FCC Workbench Changes", [workbench_story])
        story.append(create_professional_table([["Stage", "Business meaning"], *self.WORKFLOW_ROWS], col_widths=[1.65 * inch, 4.65 * inch]))

        self._add_section(story, "Run Context And Scope" if not is_business else "Report Scope And Review Basis", [])
        if is_business:
            story.append(create_professional_table([
                ["Report item", "Value"],
                ["Run name", _safe_text((report.get("run_identity") or {}).get("run_name"), "Not recorded")],
                ["Generated on", _safe_text(report.get("generated_at"), "Not recorded")],
                ["Business audience", _safe_text(audience.title(), "Business")],
                ["Selected approach", _business_algorithm_name(mp.get("algorithm"))],
                ["Source data feeds", str(len(ds.get("datasets_used") or []))],
                ["Preparation steps captured", str(_to_int(preprocessing.get("transform_count"), 0))],
            ], col_widths=[2.2 * inch, 4.1 * inch]))
            story.append(Spacer(1, 0.12 * inch))
            story.append(create_professional_table([
                ["Review basis", "Business meaning"],
                ["Alert review level", _humanize_field_name(training.get("grain") or pipeline.get("grain"))],
                ["How data was combined", f"{_to_int(pipeline.get('join_count'), 0):,} join steps were recorded to build one master alert view."],
                ["Output dataset", _safe_text(pipeline.get("output_name"), "Not recorded")],
                ["Why this matters", "The report is based on one consolidated alert-level view so model testing and threshold impact can be explained consistently."],
            ], col_widths=[2.2 * inch, 4.1 * inch]))
        else:
            story.append(create_professional_table([
                ["Field", "Value"],
                ["Run ID", _safe_text(report.get("run_id"))],
                ["Run Name", _safe_text((report.get("run_identity") or {}).get("run_name"))],
                ["Generated At", _safe_text(report.get("generated_at"))],
                ["Environment", _safe_text((report.get("run_identity") or {}).get("env_id"))],
                ["Pipeline ID", _safe_text(pipeline.get("pipeline_id"))],
                ["Pipeline Name", _safe_text(pipeline.get("name"))],
                ["Pipeline Version", _safe_text(pipeline.get("version"))],
                ["Audience", _safe_text(audience.title())],
            ], col_widths=[1.9 * inch, 4.4 * inch]))
            story.append(Spacer(1, 0.12 * inch))
            story.append(create_professional_table([
                ["Pipeline detail", "Value"],
                ["Grain", _safe_text(training.get("grain") or pipeline.get("grain"))],
                ["Source datasets", str(len(ds.get("datasets_used") or []))],
                ["Join steps", str(_to_int(pipeline.get("join_count"), 0))],
                ["Transform steps", str(_to_int(preprocessing.get("transform_count"), 0))],
                ["Output dataset", _safe_text(pipeline.get("output_name"))],
                ["Persona", _safe_text(pipeline.get("created_by_persona"))],
            ], col_widths=[1.9 * inch, 4.4 * inch]))

        self._add_section(story, "Source Data And Master Dataset", [data_story, report_narratives.get("data")])
        dataset_rows = ds.get("datasets_used") or []
        if dataset_rows:
            table_rows = [["Dataset", "Role", "Rows", "Columns"]]
            for row in dataset_rows[:12]:
                table_rows.append([_safe_text(row.get("filename")), _safe_text(row.get("role")), f"{_to_int(row.get('row_count'), 0):,}", f"{_to_int(row.get('column_count'), 0):,}"])
            story.append(create_professional_table(table_rows, col_widths=[2.1 * inch, 2.2 * inch, 1.0 * inch, 1.0 * inch]))
            dataset_chart = self._simple_bar_chart(
                [shorten(_safe_text(row.get("dataset_type")), width=16, placeholder="...") for row in dataset_rows[:8]],
                [_to_int(row.get("row_count"), 0) for row in dataset_rows[:8]],
                title="Dataset volume by role",
                ylabel="Rows",
            )
            if dataset_chart:
                story.extend([Spacer(1, 0.14 * inch), dataset_chart])
            if is_business:
                roles = []
                for row in dataset_rows[:6]:
                    role = _safe_text(row.get("role") or row.get("dataset_type") or row.get("name"), "")
                    if role:
                        roles.append(_humanize_field_name(role).lower())
                if roles:
                    story.extend([
                        Spacer(1, 0.1 * inch),
                        self._body_paragraph(
                            f"The loaded business data combined {', '.join(dict.fromkeys(roles))}. "
                            "That allowed the workbench to look at each alert with both its transaction or rule context and its investigation outcome context, so the model could learn what suspicious alerts tended to look like in practice."
                        ),
                    ])

        self._add_section(story, "Label Strategy And Exclusions" if not is_business else "How Outcomes Were Interpreted", [report_narratives.get("target")])
        if is_business:
            story.append(
                self._body_paragraph(
                    "The underlying analytical file uses internal 1 and 0 flags, but this report translates them into business language. "
                    "A value of 1 means a confirmed suspicious case and a value of 0 means a confirmed non-suspicious case. "
                    "Open or unresolved investigations were kept out of the training sample until a reliable outcome existed."
                )
            )
            story.append(Spacer(1, 0.12 * inch))
        mapping = td.get("mapping") or {}
        mapping_rows = [["Outcome or value", "Model label"]] if not is_business else [["Business outcome", "How it was used in this review"]]
        for key, value in mapping.items():
            mapping_rows.append([
                _humanize_field_name(key) if is_business else _safe_text(key),
                _mapping_business_usage(value) if is_business else _safe_text(value),
            ])
        story.append(create_professional_table(mapping_rows, col_widths=[3.0 * inch, 3.3 * inch]))
        story.append(Spacer(1, 0.12 * inch))
        story.append(create_professional_table(
            [
                ["Target metric", "Value"],
                ["Strategy", _safe_text(td.get("strategy"), "Not recorded")] if not is_business else ["Outcome rule", _safe_text(td.get("business_explanation"), "Completed investigations were used as the trusted business outcome.")],
                ["Source column", _safe_text(td.get("source_column"))] if not is_business else ["Confirmed suspicious cases", _fmt_int(ds.get("n_positive"))],
                ["Derived column", _safe_text(td.get("derived_column"))] if not is_business else ["Confirmed non-suspicious cases", _fmt_int(ds.get("n_negative"))],
                ["Positive rows", _fmt_int(ds.get("n_positive"))] if not is_business else ["Excluded unresolved cases", _fmt_int(td.get("excluded_count"))],
                ["Negative rows", _fmt_int(ds.get("n_negative"))] if not is_business else ["Why exclusions were needed", "Open or unclear investigations were removed so the model would learn only from completed business outcomes."],
                ["Excluded rows", _fmt_int(td.get("excluded_count"))] if not is_business else ["Review population kept", _fmt_int(ds.get("labelled_rows"))],
                ["Business explanation", _safe_text(td.get("business_explanation"))] if not is_business else ["What 1 and 0 mean", "1 = confirmed suspicious case, 0 = confirmed non-suspicious case"],
            ],
            col_widths=[1.85 * inch, 4.45 * inch],
        ))

        self._add_section(story, "Data Quality And Representativeness" if not is_business else "Data Readiness And Population Mix", [])
        story.append(create_metric_card_table([
            {"label": "Rows Before Exclusion", "value": _fmt_int(ds.get("total_rows_before_exclusion"))} if not is_business else {"label": "Starting Alert Population", "value": _fmt_int(ds.get("total_rows_before_exclusion"))},
            {"label": "Labelled Rows", "value": _fmt_int(ds.get("labelled_rows"))} if not is_business else {"label": "Alerts With Confirmed Outcome", "value": _fmt_int(ds.get("labelled_rows"))},
            {"label": "Excluded Rows", "value": _fmt_int(ds.get("excluded_rows"))} if not is_business else {"label": "Alerts Excluded", "value": _fmt_int(ds.get("excluded_rows"))},
            {"label": "Overall STR Rate", "value": _fmt_pct(ds.get("str_rate_overall"), 2, treat_ratio_as_pct=True)} if not is_business else {"label": "Suspicious Outcome Rate", "value": _fmt_pct(ds.get("str_rate_labelled"), 2, treat_ratio_as_pct=True)},
            {"label": "Labelled STR Rate", "value": _fmt_pct(ds.get("str_rate_labelled"), 2, treat_ratio_as_pct=True)} if not is_business else {"label": "Largest Missing Data Gap", "value": _fmt_pct(((eda.get("missing_values") or {}).get("max_missing_pct")), 2)},
            {"label": "Imbalance Ratio", "value": _fmt_ratio(((eda.get("class_balance") or {}).get("imbalance_ratio")), 3)} if not is_business else {"label": "Rarity Of Suspicious Cases", "value": _fmt_ratio(((eda.get("class_balance") or {}).get("imbalance_ratio")), 3)},
        ]))
        story.append(Spacer(1, 0.12 * inch))
        story.append(create_professional_table([
            ["Quality indicator", "Value"] if not is_business else ["Readiness question", "What the review found"],
            ["Exclusion reason", _safe_text(ds.get("exclusion_reason"))] if not is_business else ["Why some alerts were excluded", _safe_text(ds.get("exclusion_reason"), "Alerts without a completed outcome were kept out until the case result was reliable.")],
            ["Columns with missing data", str(len(((eda.get("missing_values") or {}).get("columns_with_missing")) or []))] if not is_business else ["Data fields needing cleanup", str(len(((eda.get("missing_values") or {}).get("columns_with_missing")) or []))],
            ["Max missing percentage", _fmt_pct(((eda.get("missing_values") or {}).get("max_missing_pct")), 2)] if not is_business else ["Largest completeness gap", _fmt_pct(((eda.get("missing_values") or {}).get("max_missing_pct")), 2)],
            ["Overall missing percentage", _fmt_pct(((eda.get("missing_values") or {}).get("overall_missing_pct")), 2)] if not is_business else ["Overall missing data level", _fmt_pct(((eda.get("missing_values") or {}).get("overall_missing_pct")), 2)],
            ["Risk separation note", _safe_text(((eda.get("risk_score_separation") or {}).get("interpretation")))] if not is_business else ["Early sign of usable signal", _safe_text(((eda.get("risk_score_separation") or {}).get("interpretation")), "Early review checked whether stronger alerts looked meaningfully different from weaker alerts.")],
        ], col_widths=[2.15 * inch, 4.15 * inch]))

        self._add_section(story, "EDA Overview" if not is_business else "What The Early Data Review Showed", ["This section translates the main exploratory analysis outputs into business language. The purpose is to show whether the population contains enough signal to support a prioritisation model."])
        class_distribution = self._extract_class_distribution(eda)
        class_chart = self._simple_bar_chart([row["label"] for row in class_distribution], [row["value"] for row in class_distribution], title="Label distribution", ylabel="Rows / share")
        if class_chart:
            story.append(class_chart)
        risk_chart = self._chart_from_chart_data("risk_score_by_label_chart", (eda.get("chart_data") or {}).get("risk_score_by_label_chart"))
        if risk_chart:
            story.extend([Spacer(1, 0.1 * inch), risk_chart])
        story.append(Spacer(1, 0.12 * inch))
        story.append(self._body_paragraph(_safe_text(((eda.get("risk_score_separation") or {}).get("interpretation")))))

        self._add_section(story, "EDA Observations And Rule Patterns" if not is_business else "Business Patterns Found In The Data", [])
        top_corr = eda.get("top_correlated_with_target") or []
        if top_corr:
            corr_rows = [["Variable", "Relationship to target"]] if not is_business else [["Business signal", "Relationship to suspicious outcomes"]]
            for row in top_corr[:8]:
                relationship = row.get("correlation") or row.get("value") or row.get("score")
                corr_rows.append([
                    _humanize_field_name(row.get("feature") or row.get("name")) if is_business else _safe_text(row.get("feature") or row.get("name")),
                    _business_signal_relationship(relationship) if is_business else _safe_text(relationship),
                ])
            story.append(create_professional_table(corr_rows, col_widths=[3.4 * inch, 2.9 * inch]))
            if is_business:
                top_names = [
                    _humanize_field_name(row.get("feature") or row.get("name"))
                    for row in top_corr[:3]
                    if _safe_text(row.get("feature") or row.get("name"), "")
                ]
                if top_names:
                    story.extend([
                        Spacer(1, 0.1 * inch),
                        self._body_paragraph(
                            f"In practical terms, the early review suggested that {', '.join(top_names)} were among the clearest signals separating suspicious from non-suspicious outcomes. "
                            "These patterns were used as evidence that the loaded data carried business value, not just technical detail."
                        ),
                    ])
        sar_by_rule = eda.get("sar_rate_by_rule") or []
        if sar_by_rule:
            story.append(Spacer(1, 0.12 * inch))
            sar_rows = [["Rule or segment", "SAR / STR rate", "Volume"]]
            for row in sar_by_rule[:8]:
                sar_rows.append([_safe_text(row.get("rule") or row.get("segment") or row.get("name")), _safe_text(row.get("sar_rate") or row.get("str_rate") or row.get("rate")), _safe_text(row.get("count") or row.get("volume"))])
            story.append(create_professional_table(sar_rows, col_widths=[2.8 * inch, 1.5 * inch, 2.0 * inch]))
        story.append(Spacer(1, 0.1 * inch))
        story.append(self._body_paragraph("A useful EDA output in this context is whether suspicious outcomes cluster in recognisable parts of the population. When they do, the model is not inventing signal; it is learning the same behavioural differences that investigators already respond to."))
        self._append_eda_view_sections(story, report, audience)

        self._add_section(story, "Preprocessing Journey" if not is_business else "How The Data Was Prepared", [self._preprocessing_story(report)])
        pre_summary = preprocessing.get("summary") or {}
        story.append(create_professional_table([
            ["Preprocessing metric", "Value"],
            ["Transform steps captured", str(_to_int(preprocessing.get("transform_count"), 0))],
            ["Input rows", f"{_to_int(pre_summary.get('input_rows'), ds.get('labelled_rows')):,}"],
            ["Output rows", f"{_to_int(pre_summary.get('output_rows'), ds.get('labelled_rows')):,}"],
            ["Input columns", f"{_to_int(pre_summary.get('input_columns'), feature_selection.get('raw_feature_columns')):,}"],
            ["Output columns", f"{_to_int(pre_summary.get('output_columns'), feature_selection.get('encoded_feature_count')):,}"],
            ["Applied steps", f"{_to_int(pre_summary.get('applied_steps'), 0):,}"],
        ], col_widths=[2.2 * inch, 4.1 * inch]))
        if preprocessing.get("categories"):
            cat_rows = [["Category", "Steps", "Applied", "Added columns", "Dropped columns"]] if not is_business else [["Preparation area", "Steps", "Applied", "Signals added", "Signals removed"]]
            for row in preprocessing.get("categories")[:8]:
                if isinstance(row, dict):
                    cat_rows.append([
                        _humanize_field_name(row.get("label") or row.get("category") or row.get("name")) if is_business else _safe_text(row.get("label") or row.get("category") or row.get("name")),
                        str(_to_int(row.get("steps"), 0)),
                        str(_to_int(row.get("applied_steps"), 0)),
                        str(_to_int(row.get("added_columns"), 0)),
                        str(_to_int(row.get("dropped_columns"), 0)),
                    ])
                else:
                    cat_rows.append([_safe_text(row), "-", "-", "-", "-"])
            story.append(Spacer(1, 0.12 * inch))
            story.append(create_professional_table(cat_rows, col_widths=[1.7 * inch, 0.8 * inch, 0.8 * inch, 1.3 * inch, 1.7 * inch]))
        if preprocessing.get("steps"):
            step_rows = [["Step", "Type", "Columns", "Why it was used"]] if not is_business else [["Step", "Preparation type", "Business signals affected", "Why it was needed"]]
            for idx, step in enumerate(preprocessing.get("steps")[:10], start=1):
                if isinstance(step, dict):
                    requested_columns = step.get("requested_columns")
                    if not isinstance(requested_columns, list):
                        requested_columns = step.get("columns") or []
                    if isinstance(requested_columns, str):
                        requested_columns = [requested_columns]
                    step_rows.append([
                        str(_to_int(step.get("step_no"), idx)),
                        _humanize_field_name(step.get("label") or step.get("category") or step.get("name")) if is_business else _safe_text(step.get("label") or step.get("category") or step.get("name")),
                        shorten(", ".join(_humanize_field_name(col) for col in requested_columns) or "-", width=32, placeholder="..."),
                        _safe_text(step.get("summary") or step.get("reason") or step.get("detail")),
                    ])
                else:
                    step_rows.append([str(idx), _safe_text(step), "-", "-"])
            story.append(Spacer(1, 0.12 * inch))
            story.append(create_professional_table(step_rows, col_widths=[0.5 * inch, 1.5 * inch, 1.7 * inch, 2.6 * inch]))

        self._add_section(story, "Variable Selection And Why These Features Matter" if not is_business else "Which Business Signals Were Kept", [feature_story])
        story.append(create_metric_card_table([
            {"label": "Raw Feature Columns", "value": f"{_to_int(feature_selection.get('raw_feature_columns'), 0):,}"} if not is_business else {"label": "Starting Business Signals", "value": f"{_to_int(feature_selection.get('raw_feature_columns'), 0):,}"},
            {"label": "Encoded Features", "value": f"{_to_int(feature_selection.get('encoded_feature_count'), 0):,}"} if not is_business else {"label": "Model-Ready Signals", "value": f"{_to_int(feature_selection.get('encoded_feature_count'), 0):,}"},
            {"label": "Feature Multiplier", "value": f"{_to_float(feature_selection.get('feature_multiplier'), 0.0):.2f}x"} if not is_business else {"label": "Signal Expansion", "value": f"{_to_float(feature_selection.get('feature_multiplier'), 0.0):.2f}x"},
            {"label": "Leakage Columns Dropped", "value": f"{_to_int(feature_selection.get('dropped_leakage_count'), 0):,}"} if not is_business else {"label": "Outcome Shortcut Fields Removed", "value": f"{_to_int(feature_selection.get('dropped_leakage_count'), 0):,}"},
            {"label": "ID Columns Dropped", "value": f"{_to_int(feature_selection.get('dropped_id_count'), 0):,}"} if not is_business else {"label": "Identifier Fields Removed", "value": f"{_to_int(feature_selection.get('dropped_id_count'), 0):,}"},
            {"label": "Datetime Expanded", "value": f"{_to_int(feature_selection.get('datetime_expanded_count'), 0):,}"} if not is_business else {"label": "Time-Based Signals Added", "value": f"{_to_int(feature_selection.get('datetime_expanded_count'), 0):,}"},
        ]))
        feature_chart = self._feature_importance_chart(mp.get("feature_importance") or [])
        if feature_chart:
            story.extend([Spacer(1, 0.12 * inch), feature_chart])
        feature_rows = [["Feature", "Importance", "Category"]] if not is_business else [["Business signal", "Influence on ranking", "Business area"]]
        for row in (mp.get("feature_importance") or [])[:10]:
            feature_rows.append([
                _humanize_field_name(row.get("feature")) if is_business else _safe_text(row.get("feature")),
                _business_influence_label(row.get("importance")) if is_business else f"{_to_float(row.get('importance'), 0.0):.6f}",
                _humanize_field_name(row.get("category")) if is_business else _safe_text(row.get("category")),
            ])
        story.append(Spacer(1, 0.12 * inch))
        story.append(create_professional_table(feature_rows, col_widths=[3.2 * inch, 1.4 * inch, 1.7 * inch]))
        if is_business and (mp.get("feature_importance") or []):
            story.extend([
                Spacer(1, 0.1 * inch),
                self._body_paragraph(
                    "The purpose of this section is not to show technical weights. It is to show which business signals most influenced the final alert ranking, so a functional reviewer can see whether the model is leaning on sensible drivers of suspicious behaviour."
                ),
            ])

        self._append_later_sections(story, report, chart_images, audience, strict_min_pages, model_story, threshold_story, impact_story, governance_story)
        return story

    def _cover_page(self, report: Dict[str, Any], audience: str) -> List[Any]:
        run_identity = report.get("run_identity") or {}
        mp = report.get("model_performance") or {}
        ta = report.get("threshold_analysis") or {}
        bi = report.get("business_impact") or {}
        is_business = _is_business_audience(audience)
        story: List[Any] = [Spacer(1, 0.9 * inch)]
        story.append(Paragraph("FCC Workbench AML Run Report", self.styles["CoverTitle"]))
        story.append(
            Paragraph(
                "Business and functional documentation of data, model design, threshold policy, and operational impact",
                self.styles["CoverSubtitle"],
            )
        )
        story.append(Spacer(1, 0.22 * inch))
        meta_rows = [
            ["Field", "Value"],
            ["Run ID", _safe_text(report.get("run_id"))],
            ["Run Name", _safe_text(run_identity.get("run_name"))],
            ["Environment", _safe_text(run_identity.get("env_id"))],
            ["Algorithm", _safe_text(mp.get("algorithm"))],
            ["Audience", _safe_text(audience.title())],
            ["Generated", _safe_text(report.get("generated_at"))],
        ]
        story.append(create_professional_table(meta_rows, col_widths=[1.8 * inch, 4.5 * inch]))
        story.append(Spacer(1, 0.18 * inch))
        story.append(
            create_metric_card_table(
                [
                    {"label": "AUC", "value": _fmt_ratio(mp.get("test_auc_roc"), 3)} if not is_business else {"label": "Selected Cut-Off", "value": _fmt_ratio(ta.get("recommended_threshold"), 3)},
                    {"label": "Threshold", "value": _fmt_ratio(ta.get("recommended_threshold"), 3)} if not is_business else {"label": "Alerts Set Aside", "value": _fmt_pct(ta.get("recommended_suppression_pct"), 2)},
                    {"label": "Suppression", "value": _fmt_pct(ta.get("recommended_suppression_pct"), 2)} if not is_business else {"label": "Suspicious Cases Missed", "value": _fmt_pct(ta.get("recommended_event_loss_pct"), 2)},
                    {"label": "Event Loss", "value": _fmt_pct(ta.get("recommended_event_loss_pct"), 2)} if not is_business else {"label": "Alerts Set Aside Count", "value": _fmt_int(bi.get("alerts_suppressed"))},
                    {"label": "Alerts Suppressed", "value": _fmt_int(bi.get("alerts_suppressed"))} if not is_business else {"label": "Alerts Kept For Review", "value": _fmt_int(bi.get("alerts_escalated"))},
                    {"label": "Alerts Escalated", "value": _fmt_int(bi.get("alerts_escalated"))} if not is_business else {"label": "Suspicious Cases Kept Visible", "value": _fmt_int(bi.get("sars_caught"))},
                ]
            )
        )
        return story

    def _contents_page(self, audience: str = "business") -> List[Any]:
        titles = [
            "Executive Summary",
            "What The FCC Workbench Changes",
            "Run Context And Scope" if not _is_business_audience(audience) else "Report Scope And Review Basis",
            "Source Data And Master Dataset",
            "Label Strategy And Exclusions" if not _is_business_audience(audience) else "How Outcomes Were Interpreted",
            "Data Quality And Representativeness" if not _is_business_audience(audience) else "Data Readiness And Population Mix",
            "EDA Overview" if not _is_business_audience(audience) else "What The Early Data Review Showed",
            "EDA Observations And Rule Patterns" if not _is_business_audience(audience) else "Business Patterns Found In The Data",
            "EDA View: Completeness And Missing Data" if not _is_business_audience(audience) else "Early Data Review View: Completeness And Missing Data",
            "EDA View: Feature-To-Outcome Signals" if not _is_business_audience(audience) else "Early Data Review View: Signals Linked To Suspicious Outcomes",
            "EDA View: Feature Overlap And Correlation" if not _is_business_audience(audience) else "Early Data Review View: Signals That Overlap",
            "Preprocessing Journey" if not _is_business_audience(audience) else "How The Data Was Prepared",
            "Variable Selection And Why These Features Matter" if not _is_business_audience(audience) else "Which Business Signals Were Kept",
            "Training Design And Validation Strategy" if not _is_business_audience(audience) else "How The Prioritisation Was Checked Before Use",
            "Model Selection And Learned Signal" if not _is_business_audience(audience) else "Why This Prioritisation Approach Was Chosen",
            "Performance Scorecard" if not _is_business_audience(audience) else "What The Testing Showed",
            "ROC Curve And Ranking Behaviour" if not _is_business_audience(audience) else "How Well The Score Separates Higher-Risk Alerts",
            "Precision-Recall Curve And Retrieval Quality" if not _is_business_audience(audience) else "How Many Good Alerts Stay Near The Top",
            "What The Confusion Matrix Means" if not _is_business_audience(audience) else "What Happened To Alerts In Testing",
            "Threshold Calibration And Event Loss Policy" if not _is_business_audience(audience) else "How The Cut-Off Was Chosen",
            "Queue Design: High / Medium / Low Bands" if not _is_business_audience(audience) else "How Alerts Move Into High, Medium, And Low Queues",
            "Operational Impact And Investigation Flow",
            "Governance, Controls, And Limitations",
            "Final Business Conclusion" if _is_business_audience(audience) else "Detailed Numeric Appendix",
        ]
        story: List[Any] = [PageBreak(), Paragraph("Document Contents", self.styles["SectionHeader"])]
        for idx, title in enumerate(titles, start=1):
            story.append(self._body_paragraph(f"{idx}. {title}"))
        story.append(Spacer(1, 0.12 * inch))
        story.append(self._body_paragraph(
            "The last section gives a short business conclusion so a functional reader can understand the journey quickly."
            if _is_business_audience(audience)
            else "The appendix section expands the core story with detailed threshold tables and chart reproductions so the report can be used as both a business summary and a control document."
        ))
        return story

    def _add_section(self, story: List[Any], title: str, paragraphs: Sequence[Optional[str]]):
        story.append(PageBreak())
        story.append(Paragraph(f"{self._section_no}. {escape(title)}", self.styles["SectionHeader"]))
        self._section_no += 1
        for paragraph in paragraphs:
            text = _safe_text(paragraph, "")
            if text:
                story.append(self._body_paragraph(text))
        if paragraphs:
            story.append(Spacer(1, 0.08 * inch))

    def _body_paragraph(self, text: str) -> Paragraph:
        text = escape(_safe_text(text, "")).replace("\n", "<br/>")
        return Paragraph(text, self.styles["BodyText"])

    def _extract_class_distribution(self, eda_summary: Dict[str, Any]) -> List[Dict[str, Any]]:
        chart_data = (eda_summary.get("chart_data") or {}).get("class_distribution_chart")
        rows: List[Dict[str, Any]] = []
        if isinstance(chart_data, list):
            for item in chart_data[:8]:
                rows.append({"label": _business_outcome_name(item.get("name")), "value": _to_float(item.get("value"), 0.0)})
        if rows:
            return rows
        balance = eda_summary.get("class_balance") or {}
        return [
            {"label": "Confirmed Suspicious", "value": _to_float(balance.get("positive_pct"), 0.0)},
            {"label": "Confirmed Non-Suspicious", "value": _to_float(balance.get("negative_pct"), 0.0)},
        ]

    def _chunk_rows(self, rows: Sequence[Any], chunk_size: int) -> Iterable[List[Any]]:
        for idx in range(0, len(rows), chunk_size):
            yield list(rows[idx : idx + chunk_size])

    def _humanize_chart_key(self, key: str) -> str:
        return str(key or "").replace("_", " ").strip().title() or "Chart"

    def _chart_data_table(self, value: Any):
        if isinstance(value, list) and value and isinstance(value[0], dict):
            keys = list(value[0].keys())[:4]
            rows = [keys]
            for item in value[:10]:
                rows.append([_safe_text(item.get(key)) for key in keys])
            return create_professional_table(rows)
        if isinstance(value, dict) and value:
            rows = [["Key", "Value"]]
            for key, item in list(value.items())[:12]:
                rows.append([_safe_text(key), _safe_text(item)])
            return create_professional_table(rows, col_widths=[2.2 * inch, 4.1 * inch])
        return None

    def _image_from_bytes(self, image_bytes: bytes, *, max_width: float, max_height: float):
        if not image_bytes:
            return None
        try:
            reader = ImageReader(io.BytesIO(image_bytes))
            width, height = reader.getSize()
            scale = min(max_width / float(width), max_height / float(height))
            scale = min(scale, 1.0) if scale > 0 else 1.0
            return RLImage(io.BytesIO(image_bytes), width=float(width) * scale, height=float(height) * scale)
        except Exception:
            return None

    def _plot(self, draw_fn, *, width: float = 6.15, height: float = 3.2):
        if not HAS_MATPLOTLIB or plt is None:
            return None
        try:
            fig, ax = plt.subplots(figsize=(width, height))
            fig.patch.set_facecolor("white")
            draw_fn(ax)
            fig.tight_layout()
            buffer = io.BytesIO()
            fig.savefig(buffer, format="png", dpi=170, bbox_inches="tight", facecolor="white")
            plt.close(fig)
            return self._image_from_bytes(buffer.getvalue(), max_width=self._chart_width, max_height=self._chart_height)
        except Exception:
            try:
                plt.close("all")
            except Exception:
                pass
            return None

    def _simple_bar_chart(
        self,
        labels: List[str],
        values: List[float],
        *,
        title: str,
        ylabel: str,
        y_limit: Optional[float] = None,
        bar_colors: Optional[List[str]] = None,
    ):
        if not labels or not values or len(labels) != len(values):
            return None

        def _draw(ax):
            palette = bar_colors or [_color_hex(ReportTheme.PWC_ORANGE)] * len(labels)
            ax.bar(range(len(labels)), values, color=palette, alpha=0.9)
            ax.set_xticks(range(len(labels)))
            ax.set_xticklabels(labels, rotation=25, ha="right", fontsize=8)
            ax.set_ylabel(ylabel, fontsize=8)
            if y_limit is not None:
                ax.set_ylim(0, max(float(y_limit), max(values) * 1.05 if values else 1.0))
            ax.grid(axis="y", linestyle="--", alpha=0.25)
            ax.set_title(title, fontsize=10, fontweight="bold")

        return self._plot(_draw)

    def _horizontal_bar_chart(self, labels: List[str], values: List[float], *, title: str, xlabel: str):
        if not labels or not values or len(labels) != len(values):
            return None

        def _draw(ax):
            y_pos = list(range(len(labels)))
            ax.barh(y_pos, values, color=_color_hex(ReportTheme.PWC_ORANGE), alpha=0.9)
            ax.set_yticks(y_pos)
            ax.set_yticklabels(labels, fontsize=8)
            ax.invert_yaxis()
            ax.set_xlabel(xlabel, fontsize=8)
            ax.grid(axis="x", linestyle="--", alpha=0.25)
            ax.set_title(title, fontsize=10, fontweight="bold")

        return self._plot(_draw, width=6.2, height=3.35)

    def _grouped_bar_chart(
        self,
        labels: List[str],
        series: List[List[float]],
        legends: List[str],
        *,
        title: str,
    ):
        if not labels or len(series) != 2:
            return None

        def _draw(ax):
            width = 0.36
            x = list(range(len(labels)))
            colors_used = [_color_hex(colors.HexColor("#D04A02")), _color_hex(colors.HexColor("#334155"))]
            for idx, values in enumerate(series):
                offset = (-width / 2) if idx == 0 else (width / 2)
                ax.bar([item + offset for item in x], values, width=width, color=colors_used[idx], alpha=0.92, label=legends[idx])
            ax.set_xticks(x)
            ax.set_xticklabels(labels, rotation=20, ha="right", fontsize=8)
            ax.grid(axis="y", linestyle="--", alpha=0.25)
            ax.legend(fontsize=7)
            ax.set_title(title, fontsize=10, fontweight="bold")

        return self._plot(_draw, width=6.2, height=3.25)

    def _dual_line_chart(
        self,
        x_values: List[float],
        left_values: List[float],
        right_values: List[float],
        *,
        title: str,
        x_label: str,
        left_label: str,
        right_label: str,
    ):
        if not x_values or not left_values or not right_values:
            return None

        def _draw(ax):
            ax2 = ax.twinx()
            ax.plot(x_values, left_values, color=_color_hex(ReportTheme.PWC_ORANGE), linewidth=2, marker="o", markersize=3.5)
            ax2.plot(x_values, right_values, color=_color_hex(colors.HexColor("#334155")), linewidth=2, marker="s", markersize=3.2)
            ax.set_xlabel(x_label, fontsize=8)
            ax.set_ylabel(left_label, fontsize=8, color=_color_hex(ReportTheme.PWC_ORANGE))
            ax2.set_ylabel(right_label, fontsize=8, color=_color_hex(colors.HexColor("#334155")))
            ax.tick_params(axis="both", labelsize=8)
            ax2.tick_params(axis="y", labelsize=8)
            ax.grid(axis="y", linestyle="--", alpha=0.25)
            ax.set_title(title, fontsize=10, fontweight="bold")

        return self._plot(_draw, width=6.2, height=3.25)

    def _single_line_chart(
        self,
        points: List[Dict[str, Any]],
        *,
        x_key: str,
        y_key: str,
        title: str,
        x_label: str,
        y_label: str,
        line_color: str,
        add_baseline: bool = False,
    ):
        clean_points = [
            item for item in (points or [])
            if isinstance(item, dict) and item.get(x_key) is not None and item.get(y_key) is not None
        ]
        if len(clean_points) < 2:
            return None

        def _draw(ax):
            x_vals = [_to_float(item.get(x_key), 0.0) for item in clean_points]
            y_vals = [_to_float(item.get(y_key), 0.0) for item in clean_points]
            ax.plot(x_vals, y_vals, color=line_color, linewidth=2.2)
            if add_baseline:
                ax.plot([0, 1], [0, 1], color="#94A3B8", linestyle="--", linewidth=1)
            ax.set_xlim(0, 1)
            ax.set_ylim(0, 1)
            ax.set_xlabel(x_label, fontsize=8)
            ax.set_ylabel(y_label, fontsize=8)
            ax.grid(axis="both", linestyle="--", alpha=0.25)
            ax.set_title(title, fontsize=10, fontweight="bold")

        return self._plot(_draw, width=6.0, height=3.2)

    def _eda_chart_title(self, key: str) -> str:
        title_map = {
            "class_distribution_chart": "Population Balance",
            "column_role_chart": "Column Mix",
            "missing_values_chart": "Completeness And Missing Data",
            "row_completeness_chart": "Row Completeness",
            "feature_correlation_chart": "Feature-To-Outcome Signals",
            "correlation_pairs_chart": "Feature Overlap And Correlation",
            "risk_score_by_label_chart": "Score Separation",
            "sar_rate_by_rule_chart": "Rule And Segment Conversion",
        }
        return title_map.get(str(key or "").lower(), self._humanize_chart_key(key))

    def _eda_chart_explanation(self, key: str, value: Any) -> str:
        key_l = str(key or "").lower()
        if key_l == "class_distribution_chart" and isinstance(value, list) and value:
            total = sum(_to_float(item.get("value"), 0.0) for item in value if isinstance(item, dict))
            leader = max(value, key=lambda item: _to_float(item.get("value"), 0.0))
            leader_value = _to_float(leader.get("value"), 0.0)
            share = (leader_value / total * 100.0) if total else 0.0
            return (
                f"This view shows how the labelled population is split before training. "
                f"The largest group is {_business_outcome_name(leader.get('name'))} at {share:.2f}% of the sample, which matters because class imbalance affects how easy it is to find true suspicious cases."
            )
        if key_l == "column_role_chart" and isinstance(value, list) and value:
            total_cols = sum(_to_int(item.get("value"), 0) for item in value if isinstance(item, dict))
            return (
                f"This chart shows the shape of the master dataset. In total, {total_cols:,} columns were profiled across numeric, categorical, binary, timestamp, and identifier groups so stakeholders can see what kind of information feeds the model."
            )
        if key_l == "missing_values_chart" and isinstance(value, list) and value:
            top_row = max(value, key=lambda item: _to_float(item.get("pct_missing") or item.get("missing_pct"), 0.0))
            return (
                f"This chart highlights the columns with the largest data-quality gaps. "
                f"The highest visible missingness is in {_humanize_field_name(top_row.get('column'))} at {_to_float(top_row.get('pct_missing') or top_row.get('missing_pct'), 0.0):.2f}%, which tells us where preprocessing had to work hardest before the model could be trusted."
            )
        if key_l == "row_completeness_chart" and isinstance(value, list) and value:
            clean_row = next((item for item in value if _to_int(item.get("missing_columns"), -1) == 0), None)
            if clean_row:
                return (
                    f"This view shows how many records are fully complete versus partially incomplete. "
                    f"{_to_int(clean_row.get('rows'), 0):,} rows have no missing fields in the sampled view, which helps gauge how much of the population needs repair before scoring."
                )
            return "This view shows whether missing data is concentrated in a few rows or spread more widely across the population."
        if key_l == "feature_correlation_chart" and isinstance(value, list) and value:
            top_row = max(value, key=lambda item: abs(_to_float(item.get("value") or item.get("importance") or item.get("correlation"), 0.0)))
            return (
                f"This chart shows which variables are most associated with the outcome. "
                f"The strongest visible signal is {_humanize_field_name(top_row.get('feature') or top_row.get('name'))}, which means that changes in this variable are more closely aligned with suspicious versus non-suspicious outcomes than the rest of the field list."
            )
        if key_l == "correlation_pairs_chart" and isinstance(value, list) and value:
            top_row = max(value, key=lambda item: abs(_to_float(item.get("correlation"), 0.0)))
            return (
                f"This view shows where features move together and may overlap. "
                f"The strongest visible pair is {_humanize_field_name(top_row.get('pair'))} with correlation {_to_float(top_row.get('correlation'), 0.0):.3f}; that is useful because highly similar features can add noise or duplication rather than new signal."
            )
        if key_l == "risk_score_by_label_chart" and isinstance(value, list) and value:
            return (
                "This chart shows whether the model score separates stronger cases from weaker ones. "
                "A healthy picture is one where the higher-score buckets contain more positive outcomes and the lower-score buckets contain more review noise."
            )
        if key_l == "sar_rate_by_rule_chart" and isinstance(value, list) and value:
            top_row = max(value, key=lambda item: _to_float(item.get("sar_rate") or item.get("str_rate") or item.get("rate"), 0.0))
            return (
                f"This view shows which rule, segment, or slice of the population has the highest suspicious-outcome rate. "
                f"The leading visible group is {_safe_text(top_row.get('rule') or top_row.get('segment') or top_row.get('name'))}, which helps business users see where the concentration of meaningful alerts is strongest."
            )
        return "This chart is included to show what the workbench observed and how that observation supports the model and threshold decision."

    def _chart_from_chart_data(self, key: str, value: Any):
        if not value:
            return None
        key_l = str(key or "").lower()
        if key_l == "class_distribution_chart" and isinstance(value, list):
            labels = [_business_outcome_name(item.get("name")) for item in value[:10] if isinstance(item, dict)]
            numbers = [_to_float(item.get("value"), 0.0) for item in value[:10] if isinstance(item, dict)]
            return self._simple_bar_chart(labels, numbers, title="Class distribution", ylabel="Count")
        if key_l == "column_role_chart" and isinstance(value, list):
            labels = [_safe_text(item.get("name")) for item in value[:10] if isinstance(item, dict)]
            numbers = [_to_float(item.get("value"), 0.0) for item in value[:10] if isinstance(item, dict)]
            return self._simple_bar_chart(labels, numbers, title="Column mix", ylabel="Count")
        if key_l == "feature_correlation_chart" and isinstance(value, list):
            labels = [_humanize_field_name(item.get("feature") or item.get("name")) for item in value[:10] if isinstance(item, dict)]
            numbers = [_to_float(item.get("importance") or item.get("correlation") or item.get("value"), 0.0) for item in value[:10] if isinstance(item, dict)]
            return self._horizontal_bar_chart(labels, numbers, title="Top business signals", xlabel="Relationship strength")
        if key_l == "correlation_pairs_chart" and isinstance(value, list):
            labels = [_humanize_field_name(item.get("pair") or item.get("name")) for item in value[:10] if isinstance(item, dict)]
            numbers = [abs(_to_float(item.get("correlation") or item.get("value"), 0.0)) for item in value[:10] if isinstance(item, dict)]
            return self._horizontal_bar_chart(labels, numbers, title="Signals that move together", xlabel="Overlap strength")
        if key_l == "risk_score_by_label_chart" and isinstance(value, list):
            labels = [_safe_text(item.get("score_bucket") or item.get("bucket") or item.get("name")) for item in value[:10] if isinstance(item, dict)]
            tp = [_to_float(item.get("tp_count") or item.get("positive") or item.get("tp"), 0.0) for item in value[:10] if isinstance(item, dict)]
            fp = [_to_float(item.get("fp_count") or item.get("negative") or item.get("fp"), 0.0) for item in value[:10] if isinstance(item, dict)]
            return self._grouped_bar_chart(labels, [tp, fp], ["Positive outcomes", "Negative outcomes"], title="Score separation by label")
        if key_l == "missing_values_chart" and isinstance(value, list):
            labels = [_humanize_field_name(item.get("column") or item.get("name")) for item in value[:10] if isinstance(item, dict)]
            numbers = [_to_float(item.get("pct_missing") or item.get("missing_pct") or item.get("value"), 0.0) for item in value[:10] if isinstance(item, dict)]
            return self._horizontal_bar_chart(labels, numbers, title="Missing values by column", xlabel="Missing %")
        if key_l == "sar_rate_by_rule_chart" and isinstance(value, list):
            labels = [_safe_text(item.get("rule") or item.get("segment") or item.get("name")) for item in value[:10] if isinstance(item, dict)]
            numbers = [_to_float(item.get("sar_rate") or item.get("str_rate") or item.get("rate") or item.get("value"), 0.0) for item in value[:10] if isinstance(item, dict)]
            return self._horizontal_bar_chart(labels, numbers, title="SAR / STR rate by rule", xlabel="Rate")
        if key_l == "row_completeness_chart" and isinstance(value, list):
            labels = [_safe_text(item.get("missing_columns")) for item in value[:10] if isinstance(item, dict)]
            numbers = [_to_float(item.get("rows"), 0.0) for item in value[:10] if isinstance(item, dict)]
            return self._simple_bar_chart(labels, numbers, title="Rows by missing-column count", ylabel="Rows")
        return None

    def _feature_importance_chart(self, feature_rows: List[Dict[str, Any]]):
        labels = [_humanize_field_name(row.get("feature")) for row in feature_rows[:10] if isinstance(row, dict) and row.get("feature")]
        values = [_to_float(row.get("importance"), 0.0) for row in feature_rows[:10] if isinstance(row, dict) and row.get("feature")]
        if not labels:
            return None
        return self._horizontal_bar_chart(labels, values, title="Business signals with the biggest influence", xlabel="Influence on ranking")

    def _threshold_tradeoff_chart(self, threshold_rows: List[Dict[str, Any]]):
        if not threshold_rows:
            return None
        x_values = [_to_float(row.get("threshold"), 0.0) for row in threshold_rows[:25]]
        suppression = [_to_float(row.get("suppression_pct"), 0.0) for row in threshold_rows[:25]]
        event_loss = [_to_float(row.get("event_loss_pct"), 0.0) for row in threshold_rows[:25]]
        return self._dual_line_chart(
            x_values,
            suppression,
            event_loss,
            title="Threshold trade-off: suppression vs event loss",
            x_label="Threshold",
            left_label="Suppression %",
            right_label="Event Loss %",
        )

    def _feature_story_fallback(self, report: Dict[str, Any]) -> str:
        mp = report.get("model_performance") or {}
        fs = report.get("feature_selection") or {}
        top_features = [_humanize_field_name(row.get("feature")) for row in (mp.get("feature_importance") or [])[:5] if row.get("feature")]
        feature_phrase = ", ".join(str(name) for name in top_features[:3]) if top_features else "the leading behavioural variables"
        return (
            f"The model kept variables that describe alert behaviour and removed fields that would make the answer too easy or meaningless, such as identifiers and leakage-prone label proxies. "
            f"Among the strongest retained signals were {feature_phrase}, which suggests the score is being driven by behavioural patterns rather than by record keys or investigator-only outcome fields.\n\n"
            f"In numeric terms, the feature set moved from {_to_int(fs.get('raw_feature_columns'), 0):,} raw feature columns to "
            f"{_to_int(fs.get('encoded_feature_count'), 0):,} model-ready columns after encoding and expansion. "
            f"{_to_int(fs.get('dropped_leakage_count'), 0):,} leakage columns and {_to_int(fs.get('dropped_id_count'), 0):,} identifier columns were explicitly removed before training."
        )

    def _preprocessing_story(self, report: Dict[str, Any]) -> str:
        preprocessing = report.get("preprocessing_summary") or {}
        fs = report.get("feature_selection") or {}
        if _to_int(preprocessing.get("transform_count"), 0) > 0:
            return self.narratives.build(
                "preprocessing_story",
                instruction="Explain the preprocessing steps in plain English and say why they were needed.",
                context=preprocessing,
                fallback=(
                    f"The preprocessing pipeline recorded {_to_int(preprocessing.get('transform_count'), 0):,} explicit transform steps. "
                    "These steps cleaned incomplete values, converted business-friendly categories into model-usable formats, and expanded time or interaction fields where that added signal.\n\n"
                    "This is important because AML model performance is often limited less by the algorithm itself and more by whether the input variables are consistent, comparable, and safe to use."
                ),
            )
        return (
            f"A detailed transform pipeline was not linked to this run, but the feature diagnostics still show what happened before training. "
            f"The model moved from {_to_int(fs.get('raw_feature_columns'), 0):,} raw feature columns to {_to_int(fs.get('encoded_feature_count'), 0):,} usable model columns, "
            "which means cleaning, encoding, and expansion steps were applied even if the individual workbench steps were not retained with the run."
        )

    def _append_eda_view_sections(self, story: List[Any], report: Dict[str, Any], audience: str) -> None:
        chart_data = ((report.get("eda_summary") or {}).get("chart_data") or {})
        if not isinstance(chart_data, dict):
            return

        ordered_keys = [
            "column_role_chart",
            "missing_values_chart",
            "row_completeness_chart",
            "feature_correlation_chart",
            "correlation_pairs_chart",
            "sar_rate_by_rule_chart",
        ]
        for key in ordered_keys:
            value = chart_data.get(key)
            if not value:
                continue
            prefix = "EDA View" if not _is_business_audience(audience) else "Early Data Review View"
            self._add_section(story, f"{prefix}: {self._eda_chart_title(key)}", [self._eda_chart_explanation(key, value)])
            chart_flowable = self._chart_from_chart_data(key, value)
            if chart_flowable:
                story.append(chart_flowable)
            detail_table = self._chart_data_table(value)
            if detail_table and not _is_business_audience(audience):
                story.extend([Spacer(1, 0.12 * inch), detail_table])

    def _append_later_sections(
        self,
        story: List[Any],
        report: Dict[str, Any],
        chart_images: List[Dict[str, Any]],
        audience: str,
        strict_min_pages: bool,
        model_story: str,
        threshold_story: str,
        impact_story: str,
        governance_story: str,
    ) -> None:
        ds = report.get("data_summary") or {}
        eda = report.get("eda_summary") or {}
        mp = report.get("model_performance") or {}
        ta = report.get("threshold_analysis") or {}
        bi = report.get("business_impact") or {}
        gov = report.get("governance") or {}
        training = report.get("training_process") or {}
        feature_selection = report.get("feature_selection") or {}
        report_narratives = report.get("narratives") or {}
        is_business = _is_business_audience(audience)

        self._add_section(story, "Training Design And Validation Strategy" if not is_business else "How The Prioritisation Was Checked Before Use", [model_story])
        split_summary = training.get("split_summary") or {}
        if is_business:
            story.append(create_professional_table([
                ["Review step", "Business explanation"],
                ["Selected approach", _business_algorithm_name(mp.get("algorithm"))],
                ["Alert review level", _humanize_field_name(training.get("grain"))],
                ["Training sample", _fmt_int(ds.get("train_rows"))],
                ["Independent test sample", _fmt_int(ds.get("test_rows"))],
                ["How the split was done", _split_strategy_label(ds.get("split_type"))],
                ["Date anchor used", _safe_text(ds.get("split_date"), "Not used")],
                ["Repeat consistency checks", str(_to_int(training.get("cv_folds"), 0)) if _to_int(training.get("cv_folds"), 0) > 0 else "Not recorded"],
                ["Why this matters", "The score was checked on alerts the model had not already seen, so the reported workload and miss-risk trade-off is grounded in an independent sample."],
            ], col_widths=[2.2 * inch, 4.1 * inch]))
        else:
            story.append(create_professional_table([
                ["Training design", "Value"],
                ["Algorithm", _safe_text(mp.get("algorithm"))],
                ["Grain", _safe_text(training.get("grain"))],
                ["Identifier column", _safe_text(training.get("id_column"))],
                ["Train rows", f"{_to_int(ds.get('train_rows'), 0):,}"],
                ["Test rows", f"{_to_int(ds.get('test_rows'), 0):,}"],
                ["Split strategy", _safe_text(ds.get("split_type"))],
                ["Split date", _safe_text(ds.get("split_date"))],
                ["Date column", _safe_text(split_summary.get("date_column") or ds.get("split_date"))],
                ["Cross-validation folds", str(_to_int(training.get("cv_folds"), 0))],
            ], col_widths=[2.05 * inch, 4.25 * inch]))
        timeline = training.get("timeline") or []
        if timeline and not is_business:
            story.append(Spacer(1, 0.12 * inch))
            time_rows = [["Step", "Detail", "Duration (ms)", "Status"]]
            for row in timeline[:8]:
                time_rows.append([_safe_text(row.get("label") or row.get("id")), _safe_text(row.get("detail")), f"{_to_float(row.get('duration_ms'), 0.0):,.0f}", _safe_text(row.get("status"))])
            story.append(create_professional_table(time_rows, col_widths=[1.3 * inch, 3.1 * inch, 0.9 * inch, 1.0 * inch]))

        self._add_section(story, "Model Selection And Learned Signal" if not is_business else "Why This Prioritisation Approach Was Chosen", [])
        if is_business:
            story.append(create_professional_table([
                ["Selection point", "Business view"],
                ["Chosen approach", _business_algorithm_name(mp.get("algorithm"))],
                ["Why it was chosen", _safe_text(mp.get("auc_interpretation"), "It showed the most useful separation between stronger and weaker alerts in testing.")],
                ["Outcome balance control", _safe_text(training.get("class_weight"), "Not recorded")],
                ["Probability tuning", _safe_text(training.get("calibration"), "Not recorded")],
                ["Why it matters", "The chosen approach was selected because it supports alert ranking and threshold setting, not because it produced a technical score in isolation."],
            ], col_widths=[2.15 * inch, 4.15 * inch]))
        else:
            story.append(create_professional_table([
                ["Model selection item", "Value"],
                ["Selected algorithm", _safe_text(mp.get("algorithm"))],
                ["AUC interpretation", _safe_text(mp.get("auc_interpretation"))],
                ["Class weight", _safe_text(training.get("class_weight"))],
                ["Calibration", _safe_text(training.get("calibration"))],
                ["Model artefact", _safe_text(training.get("artifact_path"))],
            ], col_widths=[2.1 * inch, 4.2 * inch]))
        hyperparams = mp.get("hyperparameters") or {}
        if hyperparams and not is_business:
            story.append(Spacer(1, 0.12 * inch))
            hp_rows = [["Hyperparameter", "Value"]]
            for key, value in list(hyperparams.items())[:14]:
                hp_rows.append([_safe_text(key), _safe_text(value)])
            story.append(create_professional_table(hp_rows, col_widths=[2.4 * inch, 3.9 * inch]))

        self._add_section(story, "Performance Scorecard" if not is_business else "What The Testing Showed", [])
        if is_business:
            story.append(create_metric_card_table([
                {"label": "Suspicious Cases Captured", "value": _business_rate_label(mp.get("recall"))},
                {"label": "Escalated Queue Quality", "value": _business_rate_label(mp.get("precision"))},
                {"label": "Correct Non-Suspicious Suppressions", "value": _business_rate_label(mp.get("specificity"))},
                {"label": "Balanced Alert Handling", "value": _business_rate_label(mp.get("balanced_accuracy"))},
                {"label": "Alerts Set Aside", "value": _fmt_pct(mp.get("suppression_rate_pct"), 2)},
                {"label": "Suspicious Cases Missed", "value": _fmt_pct(mp.get("event_loss_pct"), 2)},
            ]))
            score_chart = self._simple_bar_chart(
                ["Captured Suspicious", "Queue Quality", "Correct Suppressions", "Balanced Handling"],
                [
                    _to_float(mp.get("recall"), 0.0),
                    _to_float(mp.get("precision"), 0.0),
                    _to_float(mp.get("specificity"), 0.0),
                    _to_float(mp.get("balanced_accuracy"), 0.0),
                ],
                title="Business view of testing quality",
                ylabel="Share",
                y_limit=1.0,
            )
        else:
            story.append(create_metric_card_table([
                {"label": "AUC ROC", "value": _fmt_ratio(mp.get("test_auc_roc"), 4)},
                {"label": "AUC PR", "value": _fmt_ratio(mp.get("test_auc_pr"), 4)},
                {"label": "CV AUC Mean", "value": _fmt_ratio(mp.get("cv_auc_mean"), 4)},
                {"label": "CV AUC Std", "value": _fmt_ratio(mp.get("cv_auc_std"), 4)},
                {"label": "Precision", "value": _fmt_ratio(mp.get("precision"), 4)},
                {"label": "Recall", "value": _fmt_ratio(mp.get("recall"), 4)},
            ]))
            score_chart = self._simple_bar_chart(
                ["Precision", "Recall", "F1", "AUC"],
                [_to_float(mp.get("precision"), 0.0), _to_float(mp.get("recall"), 0.0), _to_float(mp.get("f1"), 0.0), _to_float(mp.get("test_auc_roc"), 0.0)],
                title="Performance scorecard",
                ylabel="Score",
                y_limit=1.0,
            )
        if score_chart:
            story.extend([Spacer(1, 0.12 * inch), score_chart])

        roc_curve = mp.get("roc_curve") or []
        if roc_curve:
            self._add_section(
                story,
                "ROC Curve And Ranking Behaviour" if not is_business else "How Well The Score Separates Higher-Risk Alerts",
                [
                    (
                        f"The curve below shows whether stronger alerts are being placed ahead of weaker alerts before any single cut-off is chosen. "
                        f"The ranking strength for this run is {_to_float(mp.get('test_auc_roc'), 0.0):.4f}, which means the score is "
                        f"{'strong' if _to_float(mp.get('test_auc_roc'), 0.0) >= 0.8 else 'moderate' if _to_float(mp.get('test_auc_roc'), 0.0) >= 0.65 else 'still developing'} "
                        "as a queue-ordering tool."
                    ) if is_business else (
                        f"The ROC curve shows how well the model ranks higher-risk alerts ahead of lower-risk alerts before any single threshold is chosen. "
                        f"An AUC of {_to_float(mp.get('test_auc_roc'), 0.0):.4f} means the ranking signal is {'strong' if _to_float(mp.get('test_auc_roc'), 0.0) >= 0.8 else 'moderate' if _to_float(mp.get('test_auc_roc'), 0.0) >= 0.65 else 'weak'}, "
                        "so business users can judge whether the score is useful for queue prioritisation even before discussing suppression policy."
                    )
                ],
            )
            roc_chart = self._single_line_chart(
                roc_curve,
                x_key="fpr",
                y_key="tpr",
                title="Ranking quality curve" if is_business else "ROC curve",
                x_label="Non-suspicious alerts escalated" if is_business else "False positive rate",
                y_label="Suspicious alerts captured" if is_business else "True positive rate",
                line_color=_color_hex(ReportTheme.PWC_ORANGE),
                add_baseline=True,
            )
            if roc_chart:
                story.append(roc_chart)

        pr_curve = mp.get("pr_curve") or []
        if pr_curve:
            self._add_section(
                story,
                "Precision-Recall Curve And Retrieval Quality" if not is_business else "How Many Good Alerts Stay Near The Top",
                [
                    (
                        f"This view shows what happens to escalated queue quality as we try to keep more suspicious cases in scope. "
                        f"The supporting score for this curve is {_to_float(mp.get('test_auc_pr'), 0.0):.4f}. "
                        "For business users, the main question is simple: as we capture more suspicious cases, how much review noise comes with them?"
                    ) if is_business else (
                        f"The precision-recall curve matters especially in AML because true suspicious cases are usually a minority of the population. "
                        f"PR-AUC of {_to_float(mp.get('test_auc_pr'), 0.0):.4f} shows how much quality remains in the queue as recall rises, which is often easier for investigators to relate to than ROC alone."
                    )
                ],
            )
            pr_chart = self._single_line_chart(
                pr_curve,
                x_key="recall",
                y_key="precision",
                title="Quality of alerts kept near the top" if is_business else "Precision-recall curve",
                x_label="Suspicious alerts captured" if is_business else "Recall",
                y_label="Share of escalated alerts that are suspicious" if is_business else "Precision",
                line_color=_color_hex(colors.HexColor("#334155")),
            )
            if pr_chart:
                story.append(pr_chart)

        self._add_section(story, "What The Confusion Matrix Means" if not is_business else "What Happened To Alerts In Testing", [_safe_text(mp.get("confusion_matrix_business_explainer")), report_narratives.get("confusion_matrix_business")])
        cm = mp.get("confusion_matrix") or {}
        if is_business:
            story.append(create_professional_table([
                ["Alert outcome in testing", "Count", "Why it matters", "What we do with it"],
                ["Correctly set aside low-value alert", f"{_to_int(cm.get('tn'), 0):,}", "This is the main source of workload relief because review noise is taken out safely.", "Keep monitoring that these alerts remain low risk over time."],
                ["Escalated alert that later proved non-suspicious", f"{_to_int(cm.get('fp'), 0):,}", "This creates extra analyst work, but it is usually safer than suppressing a suspicious case too early.", "Use these alerts to refine rules, features, and thresholds."],
                ["Missed suspicious case", f"{_to_int(cm.get('fn'), 0):,}", "This is the main residual risk because the alert would have been deprioritised even though it later looked suspicious.", "Keep this number within the agreed event loss limit and review miss patterns regularly."],
                ["Correctly escalated suspicious case", f"{_to_int(cm.get('tp'), 0):,}", "This shows the value of the score because meaningful alerts remain visible to investigators.", "Protect these cases when tuning the cut-off or changing the queue design."],
            ], col_widths=[1.7 * inch, 0.8 * inch, 2.0 * inch, 2.0 * inch]))
        else:
            story.append(create_professional_table([
                ["Outcome", "Count", "Business meaning"],
                ["True Negative", f"{_to_int(cm.get('tn'), 0):,}", "Low-risk alert correctly suppressed"],
                ["False Positive", f"{_to_int(cm.get('fp'), 0):,}", "Alert escalated but later not confirmed"],
                ["False Negative", f"{_to_int(cm.get('fn'), 0):,}", "Suspicious case missed by the model"],
                ["True Positive", f"{_to_int(cm.get('tp'), 0):,}", "Suspicious case correctly escalated"],
            ], col_widths=[1.55 * inch, 1.0 * inch, 3.75 * inch]))
        cm_chart = self._simple_bar_chart(
            ["Correctly Set Aside", "Extra Review", "Missed Suspicious", "Correctly Escalated"] if is_business else ["TN", "FP", "FN", "TP"],
            [_to_int(cm.get("tn"), 0), _to_int(cm.get("fp"), 0), _to_int(cm.get("fn"), 0), _to_int(cm.get("tp"), 0)],
            title="Testing outcomes" if is_business else "Evaluation outcomes",
            ylabel="Count",
            bar_colors=[_color_hex(ReportTheme.SUCCESS_GREEN), _color_hex(ReportTheme.WARNING_AMBER), _color_hex(ReportTheme.ERROR_RED), _color_hex(colors.HexColor("#0F766E"))],
        )
        if cm_chart:
            story.extend([Spacer(1, 0.12 * inch), cm_chart])

        self._add_section(story, "Threshold Calibration And Event Loss Policy" if not is_business else "How The Cut-Off Was Chosen", [threshold_story, _safe_text(ta.get("business_threshold_explainer"))])
        threshold_chart = self._threshold_tradeoff_chart(ta.get("threshold_table") or [])
        if threshold_chart:
            story.append(threshold_chart)
        if is_business:
            story.append(Spacer(1, 0.12 * inch))
            story.append(create_professional_table([
                ["Threshold view", "Value", "Why it matters"],
                ["Configured threshold", _fmt_ratio(ta.get("configured_threshold"), 4), "This is the cut-off stored with the run before the report compares all tested options."],
                ["Recommended threshold", _fmt_ratio(ta.get("recommended_threshold"), 4), "This is the strongest workload-reduction point that still stayed within the event-loss limit."],
                ["Nearest 0.50 point", _fmt_ratio(ta.get("midpoint_threshold"), 4), f"At the nearest 0.50 operating point, suppression would be {_fmt_pct(ta.get('midpoint_suppression_pct'), 2)} and Event Loss would be {_fmt_pct(ta.get('midpoint_event_loss_pct'), 2)}."],
            ], col_widths=[1.55 * inch, 1.0 * inch, 3.75 * inch]))
        threshold_rows = [["Threshold", "Suppression %", "Event Loss %", "Precision", "Recall", "Recommended"]] if not is_business else [["Cut-Off", "Alerts Set Aside", "Suspicious Cases Missed", "Escalated Queue Quality", "Suspicious Cases Captured", "Selected"]]
        for row in (ta.get("threshold_table") or [])[:10]:
            threshold_rows.append([
                _fmt_ratio(row.get("threshold"), 4),
                _fmt_pct(row.get("suppression_pct"), 2),
                _fmt_pct(row.get("event_loss_pct"), 2),
                _business_rate_label(row.get("precision")) if is_business else _fmt_ratio(row.get("precision"), 4),
                _business_rate_label(row.get("recall")) if is_business else _fmt_ratio(row.get("recall"), 4),
                "Yes" if row.get("recommended") else "No",
            ])
        story.append(Spacer(1, 0.12 * inch))
        story.append(create_professional_table(threshold_rows, col_widths=[1.0 * inch, 1.0 * inch, 1.0 * inch, 1.0 * inch, 1.0 * inch, 1.0 * inch]))

        self._add_section(story, "Queue Design: High / Medium / Low Bands" if not is_business else "How Alerts Move Into High, Medium, And Low Queues", ["The HML design turns one model score into an operating queue. High is the fast lane, medium is the review queue, and low is the suppress lane."])
        hml_rows = ta.get("hml_tiers") or {}
        story.append(create_professional_table([
            ["Band", "Cut-off", "Share of alerts", "Count", "Action"] if not is_business else ["Queue", "Score range", "Share of alerts", "Approx. alert count", "Business action"],
            ["Low", f"Below {_fmt_ratio((hml_rows.get('low') or {}).get('threshold_below'), 4, default='Not defined')}" if is_business else f"< {_to_float((hml_rows.get('low') or {}).get('threshold_below'), 0.0):.4f}", _fmt_pct((hml_rows.get('low') or {}).get('pct_of_alerts'), 2), _fmt_int((hml_rows.get('low') or {}).get('count')), _safe_text((hml_rows.get('low') or {}).get('action'), "Set aside or light-touch review")],
            ["Medium", _safe_text((hml_rows.get("medium") or {}).get("threshold_range"), "Not defined"), _fmt_pct((hml_rows.get('medium') or {}).get('pct_of_alerts'), 2), _fmt_int((hml_rows.get('medium') or {}).get('count')), _safe_text((hml_rows.get("medium") or {}).get('action'), "Standard analyst review")],
            ["High", f"At or above {_fmt_ratio((hml_rows.get('high') or {}).get('threshold_above'), 4, default='Not defined')}" if is_business else f">= {_to_float((hml_rows.get('high') or {}).get('threshold_above'), 0.0):.4f}", _fmt_pct((hml_rows.get('high') or {}).get('pct_of_alerts'), 2), _fmt_int((hml_rows.get('high') or {}).get('count')), _safe_text((hml_rows.get('high') or {}).get('action'), "Priority investigator review")],
        ], col_widths=[0.8 * inch, 1.35 * inch, 1.15 * inch, 1.0 * inch, 2.0 * inch]))
        hml_chart = self._simple_bar_chart(
            ["Low", "Medium", "High"],
            [_to_int((hml_rows.get("low") or {}).get("count"), 0), _to_int((hml_rows.get("medium") or {}).get("count"), 0), _to_int((hml_rows.get("high") or {}).get("count"), 0)],
            title="HML volume routing" if not is_business else "Alert routing across queues",
            ylabel="Alert count",
            bar_colors=[_color_hex(colors.HexColor("#15803D")), _color_hex(colors.HexColor("#B45309")), _color_hex(colors.HexColor("#B91C1C"))],
        )
        if hml_chart:
            story.extend([Spacer(1, 0.12 * inch), hml_chart])

        self._add_section(story, "Operational Impact And Investigation Flow", [impact_story])
        story.append(create_metric_card_table([
            {"label": "Total Alerts", "value": _fmt_int(bi.get("total_alerts"))} if not is_business else {"label": "Alerts In Scope", "value": _fmt_int(bi.get("total_alerts"))},
            {"label": "Suppressed", "value": _fmt_int(bi.get("alerts_suppressed"))} if not is_business else {"label": "Alerts Set Aside", "value": _fmt_int(bi.get("alerts_suppressed"))},
            {"label": "Escalated", "value": _fmt_int(bi.get("alerts_escalated"))} if not is_business else {"label": "Alerts Kept For Review", "value": _fmt_int(bi.get("alerts_escalated"))},
            {"label": "SARs Caught", "value": _fmt_int(bi.get("sars_caught"))} if not is_business else {"label": "Suspicious Cases Kept Visible", "value": _fmt_int(bi.get("sars_caught"))},
            {"label": "SARs Missed", "value": _fmt_int(bi.get("sars_missed"))} if not is_business else {"label": "Suspicious Cases Missed", "value": _fmt_int(bi.get("sars_missed"))},
            {"label": "Workload Reduction", "value": _fmt_pct(bi.get("workload_reduction_pct"), 2)},
        ]))
        story.append(Spacer(1, 0.12 * inch))
        if is_business:
            story.append(create_professional_table([
                ["Impact area", "Before prioritisation", "After prioritisation"],
                ["Review workload", _safe_text(((bi.get("before_model") or {}).get("description")), "All alerts in scope required manual review."), _safe_text(((bi.get("after_model") or {}).get("description")), "Lower-value alerts are set aside and the remaining queue is prioritised.")],
                ["Alerts set aside", "0.00%", _fmt_pct(bi.get("workload_reduction_pct"), 2)],
                ["Suspicious cases missed", "0.00%", _fmt_pct(bi.get("event_loss_pct"), 2)],
                ["Investigator focus", "Review spread evenly across the queue", "Stronger alerts move upward and lower-value alerts move downward"],
            ], col_widths=[1.45 * inch, 2.35 * inch, 2.5 * inch]))
        else:
            story.append(create_professional_table([
                ["Impact view", "Before model", "After model"],
                ["Review workload", _safe_text(((bi.get("before_model") or {}).get("description"))), _safe_text(((bi.get("after_model") or {}).get("description")))],
                ["Suppression", "0.00%", _fmt_pct(bi.get("workload_reduction_pct"), 2)],
                ["Event Loss", "0.00%", _fmt_pct(bi.get("event_loss_pct"), 2)],
                ["Precision / Recall", "-", f"{_fmt_ratio((report.get('model_performance') or {}).get('precision'), 4)} / {_fmt_ratio((report.get('model_performance') or {}).get('recall'), 4)}"],
            ], col_widths=[1.45 * inch, 2.35 * inch, 2.5 * inch]))
        impact_chart = self._simple_bar_chart(
            ["Suppressed", "Escalated", "SARs caught", "SARs missed"] if not is_business else ["Set Aside", "Kept For Review", "Suspicious Kept Visible", "Suspicious Missed"],
            [_to_int(bi.get("alerts_suppressed"), 0), _to_int(bi.get("alerts_escalated"), 0), _to_int(bi.get("sars_caught"), 0), _to_int(bi.get("sars_missed"), 0)],
            title="Operational outcomes at selected threshold" if not is_business else "What changes at the selected operating point",
            ylabel="Count",
        )
        if impact_chart:
            story.extend([Spacer(1, 0.12 * inch), impact_chart])

        self._add_section(story, "Governance, Controls, And Limitations" if not is_business else "Controls, Monitoring, And Ongoing Checks", [governance_story, report_narratives.get("governance")])
        story.append(create_professional_table([
            ["Governance item", "Recorded position"] if not is_business else ["Control point", "Business expectation"],
            ["Label audit trail", _safe_text(gov.get("label_audit_trail"))] if not is_business else ["Outcome traceability", _safe_text(gov.get("label_audit_trail"), "Completed investigation outcomes should remain traceable to the source case record.")],
            ["Split strategy", _safe_text(gov.get("split_strategy"))] if not is_business else ["Independent checking approach", _safe_text(gov.get("split_strategy"), "The score should keep being tested on alerts it has not already seen.")],
            ["Encoder fit control", _safe_text(gov.get("encoder_fit"))] if not is_business else ["Data preparation control", _safe_text(gov.get("encoder_fit"), "The same preparation logic should be used consistently between training and scoring.")],
            ["Event loss constraint", _safe_text(gov.get("event_loss_constraint"))] if not is_business else ["Miss-risk limit", _safe_text(gov.get("event_loss_constraint"), "The agreed event loss limit should remain the guardrail for threshold changes.")],
            ["Retraining recommendation", _safe_text(gov.get("retraining_recommendation"))] if not is_business else ["When to review again", _safe_text(gov.get("retraining_recommendation"), "Revisit the model when alert mix, rules, or investigation outcomes change materially.")],
            ["Proxy label warning", _safe_text(gov.get("proxy_label_warning"), "Not active")] if not is_business else ["Shortcut warning", _safe_text(gov.get("proxy_label_warning"), "No active shortcut warning recorded")],
            ["Model card path", _safe_text(gov.get("model_card_path"), "Not linked")] if not is_business else ["Recorded documentation", _safe_text(gov.get("model_card_path"), "Supporting documentation not linked in this run")],
        ], col_widths=[2.1 * inch, 4.2 * inch]))
        frameworks = gov.get("regulatory_frameworks") or []
        if frameworks:
            story.append(Spacer(1, 0.12 * inch))
            story.append(self._body_paragraph(f"Referenced governance frameworks: {', '.join(str(item) for item in frameworks)}."))

        if is_business:
            conclusion_text = (
                f"This report started with {_fmt_int(ds.get('total_rows_before_exclusion'))} alerts across the available source feeds and narrowed the review base to {_fmt_int(ds.get('labelled_rows'))} alerts with completed investigation outcomes. "
                "That step mattered because the score needed to learn from decisions the business already trusts, not from open cases.\n\n"
                "The early data review was used to check completeness, alert mix, and whether suspicious cases showed recognisable patterns. "
                "That gave us confidence that the alert population contained usable signal before any threshold decision was made.\n\n"
                "Data preparation then standardised the inputs, removed identifier or shortcut fields, and kept the business signals that best separated suspicious from non-suspicious outcomes. "
                "The final check was done on unseen alerts so the reported workload reduction and miss-risk were based on independent evidence.\n\n"
                f"The chosen cut-off sets aside {_fmt_pct(ta.get('recommended_suppression_pct'), 2)} of alerts while keeping suspicious-case miss-risk at {_fmt_pct(ta.get('recommended_event_loss_pct'), 2)}. "
                "In business terms, the FCC Workbench provides a documented way to move investigator effort toward the alerts that matter most while keeping the residual risk visible and governable."
            )
            self._add_section(story, "Final Business Conclusion", [conclusion_text])
            story.append(create_professional_table([
                ["Journey step", "Why we did it", "Business takeaway"],
                ["Started with source data", "To create one trusted alert view across the available data feeds.", "The report explains one end-to-end alert population, not disconnected screens."],
                ["Reviewed the data early", "To check completeness, suspicious-case mix, and whether meaningful patterns existed.", "EDA was done to confirm there was enough business signal to justify prioritisation."],
                ["Prepared the data", "To clean incomplete values and standardise the alert information before scoring.", "This made alerts more comparable and reduced noise caused by raw source differences."],
                ["Selected business signals", "To keep fields that helped explain suspicious behaviour and remove identifiers or shortcut outcomes.", "The model was guided by business-relevant behaviour rather than technical artefacts."],
                ["Tested on unseen alerts", "To prove the queue design on alerts outside the training sample.", "The reported suppression and miss-risk trade-off comes from an independent check."],
                ["Chose the operating cut-off", "To balance workload relief against missed suspicious cases.", f"The selected operating point sets aside {_fmt_pct(ta.get('recommended_suppression_pct'), 2)} of alerts with {_fmt_pct(ta.get('recommended_event_loss_pct'), 2)} event loss."],
            ], col_widths=[1.4 * inch, 2.4 * inch, 2.5 * inch]))
        else:
            self._add_section(story, "Detailed Numeric Appendix", [])
            appendix_feature_rows = [["Feature diagnostic", "Value"]]
            for key in ("numeric_columns", "categorical_columns", "onehot_columns_count", "frequency_encoded_count", "categorical_levels_total", "dropped_constant_count"):
                appendix_feature_rows.append([key.replace("_", " ").title(), _safe_text(feature_selection.get(key))])
            story.append(create_professional_table(appendix_feature_rows, col_widths=[2.6 * inch, 3.7 * inch]))
            if feature_selection.get("top_categorical_expansions"):
                story.append(Spacer(1, 0.12 * inch))
                expansion_rows = [["Column", "Levels"]]
                for row in feature_selection.get("top_categorical_expansions")[:12]:
                    expansion_rows.append([_safe_text(row.get("column")), str(_to_int(row.get("levels"), 0))])
                story.append(create_professional_table(expansion_rows, col_widths=[4.8 * inch, 1.5 * inch]))

            threshold_table = ta.get("threshold_table") or []
            if threshold_table:
                for chunk_index, chunk in enumerate(self._chunk_rows(threshold_table, 12), start=1):
                    self._add_section(story, f"Threshold Appendix {chunk_index}", [])
                    rows = [["Threshold", "Suppression %", "Event Loss %", "Precision", "Recall", "TP", "FN"]]
                    for row in chunk:
                        rows.append([f"{_to_float(row.get('threshold'), 0.0):.4f}", f"{_to_float(row.get('suppression_pct'), 0.0):.2f}", f"{_to_float(row.get('event_loss_pct'), 0.0):.2f}", f"{_to_float(row.get('precision'), 0.0):.4f}", f"{_to_float(row.get('recall'), 0.0):.4f}", f"{_to_int(row.get('tp'), 0):,}", f"{_to_int(row.get('fn'), 0):,}"])
                    story.append(create_professional_table(rows, col_widths=[0.9 * inch, 0.95 * inch, 0.95 * inch, 0.85 * inch, 0.85 * inch, 0.8 * inch, 0.8 * inch]))
                    if not strict_min_pages and chunk_index >= 1:
                        break

        if str(audience or "").lower() == "technical":
            chart_data = (eda.get("chart_data") or {}) if isinstance(eda.get("chart_data"), dict) else {}
            for key, value in chart_data.items():
                chart_flowable = self._chart_from_chart_data(key, value)
                self._add_section(story, f"EDA Chart Appendix: {self._humanize_chart_key(key)}", [])
                story.append(self._body_paragraph(f"This appendix page reproduces the persisted workbench chart or a server-side equivalent for {_safe_text(self._humanize_chart_key(key))}."))
                if chart_flowable:
                    story.append(chart_flowable)
                detail_table = self._chart_data_table(value)
                if detail_table:
                    story.extend([Spacer(1, 0.12 * inch), detail_table])

            for idx, chart in enumerate(chart_images, start=1):
                title = _safe_text(chart.get("title"), f"Workbench Chart {idx}")
                self._add_section(story, f"Workbench Screen Capture: {title}", [])
                story.append(self._body_paragraph(_safe_text(chart.get("caption"), "Chart captured directly from the workbench screen.")))
                image_flowable = self._image_from_bytes(chart.get("bytes") or b"", max_width=6.25 * inch, max_height=6.2 * inch)
                if image_flowable:
                    story.append(image_flowable)
                else:
                    story.append(self._body_paragraph("Chart image could not be rendered from the supplied payload."))
