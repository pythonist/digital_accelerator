"""
eda_routes.py — AML MLOps EDA Blueprint
Dedicated high-performance routes for the SAS Viya-style EDA workbench.

Register in create_app() as:
    from api.tools.mlops.eda_routes import eda_bp
    app.register_blueprint(eda_bp, url_prefix='/api/eda')

Also add to mlopsApi.js under the eda section:
    edaOverview, edaColumnProfile, edaMissing, edaOutliers,
    edaDuplicates, edaCorrelation, edaFeatureTarget, edaQualityScore,
    edaLeakage, edaInsights, edaPairplot, edaTimeTrend,
    edaDistributionCompare
"""

from flask import Blueprint, request, jsonify
from pathlib import Path
import json
import re

# Re-use the shared env/tenant resolution from workbench_routes
# (copy the helpers here so this file is self-contained)
from api.service_locator import services
from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService
from api.tools.mlops.eda_service import EDAService
from api.tools.mlops.path_utils import resolve_env_root

eda_bp = Blueprint("eda", __name__)

_eda_svc = EDAService()

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _resolve_env_path(env_id: str, tenant_id: str) -> str:
    return str(resolve_env_root(env_id, tenant_id, create_if_missing=True))


def _get_env_ids():
    env_id = (
        request.args.get("env_id")
        or request.headers.get("X-Environment-ID")
        or services.metadata_manager.active_env
    )
    if not env_id:
        raise ValueError("X-Environment-ID header required")
    return request.tenant_id, env_id


def _get_mlops_service(env_root: str) -> MLOpsWorkbenchService:
    mlops_db = Path(env_root) / "mlops" / "duckdb" / "mlops.duckdb"
    return MLOpsWorkbenchService(mlops_db)


def _get_target_col(body: dict) -> str:
    return str(
        body.get("target_col")
        or body.get("target_column")
        or body.get("target")
        or ""
    ).strip()


def _first_list_item(value) -> str | None:
    if isinstance(value, (list, tuple)) and len(value) > 0:
        return value[0]
    return None


def _get_column(body: dict) -> str:
    col = body.get("column") or body.get("col") or _first_list_item(body.get("columns"))
    return str(col or "").strip()


def _get_columns(body: dict) -> list[str]:
    values = body.get("columns")
    if not isinstance(values, (list, tuple)):
        return []
    return [str(value).strip() for value in values if str(value).strip()]


def _get_xy_cols(body: dict) -> tuple[str, str]:
    x_col = body.get("x_col") or body.get("col_x") or body.get("column_x") or ""
    y_col = body.get("y_col") or body.get("col_y") or body.get("column_y") or ""
    return str(x_col).strip(), str(y_col).strip()


def _require_dataset(body: dict):
    """Resolve + return dataset dict from request body."""
    tenant_id, env_id = _get_env_ids()
    env_root  = _resolve_env_path(env_id, tenant_id)
    mlops_svc = _get_mlops_service(env_root)
    did       = int(body.get("dataset_id") or 0)
    dataset   = mlops_svc.get_dataset(tenant_id, env_id, did)
    if not dataset:
        raise ValueError("Dataset not found")
    return dataset


def _ok(data: dict, code: int = 200):
    return jsonify({"success": True, "data": data}), code


def _err(msg: str, code: int = 400, error_code: str = "BAD_REQUEST"):
    return jsonify({"success": False, "error": msg, "error_code": error_code}), code


def _extract_llm_json(raw_text: str):
    text = str(raw_text or "").strip()
    if not text:
        return None
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception:
        return None


def _clean_lines(values, max_items: int = 6) -> list[str]:
    if not isinstance(values, (list, tuple)):
        return []
    cleaned = []
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        cleaned.append(text)
        if len(cleaned) >= max_items:
            break
    return cleaned


def _build_eda_ai_fallback(body: dict, dataset: dict) -> dict:
    title = str(body.get("chart_title") or body.get("title") or "EDA analysis").strip()
    chart_key = str(body.get("chart_key") or "").strip()
    scope = str(body.get("analysis_scope") or "chart").strip().lower() or "chart"
    target_column = _get_target_col(body)
    chart_focus = str(body.get("chart_focus") or title or "this chart").strip()
    business_labels = body.get("business_labels") if isinstance(body.get("business_labels"), dict) else {}
    deterministic = body.get("deterministic_insight") if isinstance(body.get("deterministic_insight"), dict) else {}
    facts = _clean_lines(body.get("facts"), max_items=8)

    positive_label = str(
        business_labels.get("positive")
        or business_labels.get("target_display")
        or target_column
        or "the modeled outcome"
    ).strip()

    what = str(
        deterministic.get("what")
        or (
            f"{title} summarises {facts[0].lower()}"
            if facts
            else f"{title} shows the current pattern in {chart_focus.lower()}."
        )
    ).strip()

    why = str(
        deterministic.get("why")
        or (
            f"This matters because {facts[1].lower()}"
            if len(facts) > 1
            else f"This helps the team see whether {positive_label} is concentrated, separated, or evenly spread."
        )
    ).strip()

    how = str(
        deterministic.get("how_it_helps_model_building")
        or (
            f"Use this view to judge whether {chart_focus.lower()} should influence feature design, threshold choice, or review strategy."
        )
    ).strip()

    action = str(
        deterministic.get("action")
        or deterministic.get("recommended_action")
        or "Use this signal together with data quality, leakage, and validation checks before changing model rules."
    ).strip()

    watch_out = str(
        body.get("watch_out")
        or deterministic.get("watch_out")
        or "Treat this as one signal, not the full decision. Confirm the pattern with other EDA views before acting."
    ).strip()

    return {
        "analysis_source": "deterministic",
        "llm_available": False,
        "chart_title": title,
        "chart_key": chart_key,
        "analysis_scope": scope,
        "dataset_type": dataset.get("dataset_type"),
        "target_column": target_column,
        "business_labels": business_labels,
        "facts": facts,
        "sections": {
            "what_this_says": what,
            "why_it_matters": why,
            "how_it_helps_model_building": how,
            "recommended_action": action,
            "watch_out": watch_out,
        },
    }


def _maybe_upgrade_eda_ai_explanation(body: dict, dataset: dict, fallback: dict) -> dict:
    wrapper = getattr(services, "llm_provider", None) or getattr(services, "ollama_wrapper", None)
    if not wrapper:
        return fallback
    try:
        if not wrapper.check_connection():
            return fallback
    except Exception:
        return fallback

    prompt_payload = {
        "analysis_scope": fallback.get("analysis_scope"),
        "chart_title": fallback.get("chart_title"),
        "chart_key": fallback.get("chart_key"),
        "dataset_type": dataset.get("dataset_type"),
        "chart_focus": str(body.get("chart_focus") or "").strip(),
        "target_column": fallback.get("target_column"),
        "business_labels": fallback.get("business_labels"),
        "facts": fallback.get("facts") or [],
        "deterministic_sections": fallback.get("sections") or {},
    }
    system_prompt = (
        "You are an AML analytics assistant for FCC and transaction monitoring workbenches. "
        "Explain structured chart facts in grounded business language. "
        "Use only the facts provided. Do not invent numbers, columns, causes, or recommendations. "
        "Do not use em dashes. Keep each answer concise and specific. "
        "Return valid JSON with keys what_this_says, why_it_matters, "
        "how_it_helps_model_building, recommended_action, watch_out."
    )
    response = wrapper.generate(
        prompt=json.dumps(prompt_payload, default=str),
        system_prompt=system_prompt,
        temperature=0.2,
        max_tokens=380,
    )
    if not response or not response.get("success"):
        return fallback

    parsed = _extract_llm_json(response.get("response", ""))
    if not isinstance(parsed, dict):
        return fallback

    upgraded = dict(fallback)
    upgraded["analysis_source"] = "ai"
    upgraded["llm_available"] = True
    upgraded["provider"] = response.get("provider")
    upgraded["model"] = response.get("model")
    upgraded["generated_at"] = response.get("timestamp")

    sections = dict(upgraded.get("sections") or {})
    for key in (
        "what_this_says",
        "why_it_matters",
        "how_it_helps_model_building",
        "recommended_action",
        "watch_out",
    ):
        value = str(parsed.get(key) or "").strip()
        if value:
            sections[key] = value
    upgraded["sections"] = sections
    return upgraded


# ─── 1. Dataset Overview ─────────────────────────────────────────────────────

@eda_bp.route("/overview", methods=["POST"])
def eda_overview():
    """
    POST /api/eda/overview
    Body: { dataset_id, sample_rows? }

    Returns full dataset overview: shape, column roles, quality score,
    missing values, class balance, ID column detection.
    """
    try:
        body   = request.get_json(silent=True) or {}
        ds     = _require_dataset(body)
        result = _eda_svc.dataset_overview(ds, sample_rows=int(body.get("sample_rows") or 50_000))
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 404, "NOT_FOUND")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 2. Column Profile ────────────────────────────────────────────────────────

@eda_bp.route("/column-profile", methods=["POST"])
def eda_column_profile():
    """
    POST /api/eda/column-profile
    Body: { dataset_id, column, sample_rows?, n_bins?, target_col? }

    Per-column deep profile: stats, histogram, quantiles, top values,
    normality test, TP rate breakdown.
    """
    try:
        body   = request.get_json(silent=True) or {}
        column = _get_column(body)
        if not column:
            return _err("'column' is required")
        ds     = _require_dataset(body)
        result = _eda_svc.column_profile(
            ds,
            column      = column,
            sample_rows = int(body.get("sample_rows") or 50_000),
            n_bins      = int(body.get("n_bins") or body.get("bins") or 40),
            target_col  = _get_target_col(body) or None,
        )
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 400, "VALIDATION_ERROR")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 3. Missing Value Analysis ───────────────────────────────────────────────

@eda_bp.route("/missing", methods=["POST"])
def eda_missing():
    """
    POST /api/eda/missing
    Body: { dataset_id, sample_rows? }

    Detailed missing-value analysis with correlation of missingness patterns.
    """
    try:
        body   = request.get_json(silent=True) or {}
        ds     = _require_dataset(body)
        result = _eda_svc.missing_analysis(ds, sample_rows=int(body.get("sample_rows") or 50_000))
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 404, "NOT_FOUND")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 4. Outlier Detection ────────────────────────────────────────────────────

@eda_bp.route("/outliers", methods=["POST"])
def eda_outliers():
    """
    POST /api/eda/outliers
    Body: { dataset_id, columns?, sample_rows? }

    Multi-method outlier detection: IQR, Z-score, Modified Z-score, consensus.
    """
    try:
        body    = request.get_json(silent=True) or {}
        ds      = _require_dataset(body)
        columns = body.get("columns")  # optional list
        result  = _eda_svc.outlier_analysis(
            ds,
            columns     = columns,
            sample_rows = int(body.get("sample_rows") or 50_000),
        )
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 404, "NOT_FOUND")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 5. Duplicate Analysis ───────────────────────────────────────────────────

@eda_bp.route("/duplicates", methods=["POST"])
def eda_duplicates():
    """
    POST /api/eda/duplicates
    Body: { dataset_id, sample_rows? }
    """
    try:
        body   = request.get_json(silent=True) or {}
        ds     = _require_dataset(body)
        result = _eda_svc.duplicate_analysis(ds, sample_rows=int(body.get("sample_rows") or 100_000))
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 404, "NOT_FOUND")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 6. Correlation Matrix ───────────────────────────────────────────────────

@eda_bp.route("/correlation", methods=["POST"])
def eda_correlation():
    """
    POST /api/eda/correlation
    Body: { dataset_id, method?, columns?, sample_rows? }
    method: "pearson" | "spearman" | "kendall"
    """
    try:
        body   = request.get_json(silent=True) or {}
        ds     = _require_dataset(body)
        method = str(body.get("method") or "pearson").lower()
        if method not in ("pearson", "spearman", "kendall"):
            method = "pearson"
        result = _eda_svc.correlation_matrix(
            ds,
            method      = method,
            columns     = body.get("columns"),
            sample_rows = int(body.get("sample_rows") or 50_000),
        )
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 400, "VALIDATION_ERROR")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 7. Feature vs Target ─────────────────────────────────────────────────────

@eda_bp.route("/feature-target", methods=["POST"])
def eda_feature_target():
    """
    POST /api/eda/feature-target
    Body: { dataset_id, target_col, sample_rows? }

    Full feature importance analysis: point-biserial r, Cramér's V, IV/WoE.
    """
    try:
        body       = request.get_json(silent=True) or {}
        target_col = _get_target_col(body)
        if not target_col:
            return _err("'target_col' is required")
        analysis_mode = str(body.get("analysis_mode") or "auto").strip().lower()
        positive_class = body.get("positive_class")
        ds     = _require_dataset(body)
        result = _eda_svc.feature_target_analysis(
            ds,
            target_col  = target_col,
            sample_rows = int(body.get("sample_rows") or 50_000),
            feature_columns = _get_columns(body) or None,
            analysis_mode=analysis_mode,
            positive_class=positive_class,
        )
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 400, "VALIDATION_ERROR")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


@eda_bp.route("/feature-selection-workbench", methods=["POST"])
def eda_feature_selection_workbench():
    """
    POST /api/eda/feature-selection-workbench
    Body: {
      dataset_id,
      target_col?,
      columns?,
      sample_rows?,
      top_n?,
      var_threshold?,
      corr_threshold?,
      mad_threshold?,
      dispersion_threshold?
    }
    """
    try:
        body = request.get_json(silent=True) or {}
        ds = _require_dataset(body)
        result = _eda_svc.feature_selection_workbench(
            ds,
            target_col=_get_target_col(body) or None,
            sample_rows=int(body.get("sample_rows") or 50_000),
            selected_columns=_get_columns(body) or None,
            top_n=int(body.get("top_n") or 20),
            var_threshold=float(body.get("var_threshold") or 0.01),
            corr_threshold=float(body.get("corr_threshold") or 0.95),
            mad_threshold=(float(body["mad_threshold"]) if body.get("mad_threshold") is not None else None),
            dispersion_threshold=(float(body["dispersion_threshold"]) if body.get("dispersion_threshold") is not None else None),
        )
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 400, "VALIDATION_ERROR")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 8. Data Quality Score ───────────────────────────────────────────────────

@eda_bp.route("/quality-score", methods=["POST"])
def eda_quality_score():
    """
    POST /api/eda/quality-score
    Body: { dataset_id, sample_rows? }

    Returns quality score with 5 dimensions + recommendations.
    """
    try:
        body   = request.get_json(silent=True) or {}
        ds     = _require_dataset(body)
        result = _eda_svc.quality_score(ds, sample_rows=int(body.get("sample_rows") or 50_000))
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 404, "NOT_FOUND")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 9. Leakage Detection ────────────────────────────────────────────────────

@eda_bp.route("/leakage", methods=["POST"])
def eda_leakage():
    """
    POST /api/eda/leakage
    Body: { dataset_id, target_col, sample_rows? }
    """
    try:
        body       = request.get_json(silent=True) or {}
        target_col = _get_target_col(body)
        if not target_col:
            return _err("'target_col' is required")
        ds     = _require_dataset(body)
        result = _eda_svc.leakage_checks(
            ds,
            target_col  = target_col,
            sample_rows = int(body.get("sample_rows") or 50_000),
        )
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 400, "VALIDATION_ERROR")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 10. AML Insights ────────────────────────────────────────────────────────

@eda_bp.route("/insights", methods=["POST"])
def eda_insights():
    """
    POST /api/eda/insights
    Body: { dataset_id, target_col?, sample_rows? }

    Domain-aware AML insights: class imbalance, rule coverage, signal strength.
    """
    try:
        body   = request.get_json(silent=True) or {}
        ds     = _require_dataset(body)
        result = _eda_svc.aml_insights(
            ds,
            target_col  = _get_target_col(body) or None,
            sample_rows = int(body.get("sample_rows") or 50_000),
        )
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 404, "NOT_FOUND")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 11. Pairplot Data ───────────────────────────────────────────────────────

@eda_bp.route("/ai-chart-explain", methods=["POST", "OPTIONS"])
@eda_bp.route("/ai-chart-explain/", methods=["POST", "OPTIONS"])
def eda_ai_chart_explain():
    """
    POST /api/eda/ai-chart-explain
    Body: {
      dataset_id,
      chart_key?,
      chart_title?,
      chart_focus?,
      analysis_scope?,
      target_col?,
      business_labels?,
      deterministic_insight?,
      facts?
    }

    Deterministic-first chart explanation with optional LLM rewrite.
    """
    try:
        body = request.get_json(silent=True) or {}
        ds = _require_dataset(body)
        fallback = _build_eda_ai_fallback(body, ds)
        result = _maybe_upgrade_eda_ai_explanation(body, ds, fallback)
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 404, "NOT_FOUND")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


@eda_bp.route("/pairplot", methods=["POST"])
def eda_pairplot():
    """
    POST /api/eda/pairplot
    Body: { dataset_id, columns: string[], sample_rows? }
    """
    try:
        body    = request.get_json(silent=True) or {}
        columns = list(body.get("columns") or [])
        if len(columns) < 2:
            return _err("At least 2 columns required for pairplot")
        ds     = _require_dataset(body)
        result = _eda_svc.pairplot_data(
            ds,
            columns     = columns,
            sample_rows = int(body.get("sample_rows") or 2000),
        )
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 400, "VALIDATION_ERROR")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 12. Time Trend ──────────────────────────────────────────────────────────

@eda_bp.route("/time-trend", methods=["POST"])
def eda_time_trend():
    """
    POST /api/eda/time-trend
    Body: { dataset_id, date_col, metric_col?, target_col?, freq? }
    freq: "D" | "W" | "M" | "Q"
    """
    try:
        body     = request.get_json(silent=True) or {}
        date_col = str(body.get("date_col") or "").strip()
        if not date_col:
            return _err("'date_col' is required")
        ds     = _require_dataset(body)
        result = _eda_svc.time_trend(
            ds,
            date_col    = date_col,
            metric_col  = body.get("metric_col"),
            target_col  = _get_target_col(body) or None,
            freq        = str(body.get("freq") or "W").upper(),
            sample_rows = int(body.get("sample_rows") or 200_000),
        )
        if int(result.get("n_periods") or 0) <= 0:
            result["status"] = "empty"
            result["reason"] = (
                f"No valid time buckets could be built from date column '{date_col}'. "
                "Check date parsing and data availability for selected filters."
            )
        else:
            result["status"] = "ok"
            result["reason"] = ""
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 400, "VALIDATION_ERROR")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 13. Distribution Comparison ─────────────────────────────────────────────

@eda_bp.route("/distribution-compare", methods=["POST"])
def eda_distribution_compare():
    """
    POST /api/eda/distribution-compare
    Body: { dataset_id, column, group_col, sample_rows? }
    """
    try:
        body      = request.get_json(silent=True) or {}
        column    = str(body.get("column") or "").strip()
        group_col = str(body.get("group_col") or "").strip()
        if not column or not group_col:
            return _err("'column' and 'group_col' are required")
        ds     = _require_dataset(body)
        result = _eda_svc.distribution_comparison(
            ds,
            column      = column,
            group_col   = group_col,
            sample_rows = int(body.get("sample_rows") or 50_000),
        )
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 400, "VALIDATION_ERROR")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 13a. Bivariate Categorical ──────────────────────────────────────────────

@eda_bp.route("/bivariate-categorical", methods=["POST"])
def eda_bivariate_categorical():
    """
    POST /api/eda/bivariate-categorical
    Body: { dataset_id, x_col, y_col, target_col?, sample_rows? }

    Cross-tabulation of two categorical columns with optional TP rate matrix.
    """
    try:
        body      = request.get_json(silent=True) or {}
        x_col, y_col = _get_xy_cols(body)
        if not x_col or not y_col:
            return _err("'x_col' and 'y_col' are required")
        ds = _require_dataset(body)
        # Use workbench service implementation (EDAService does not provide this)
        tenant_id, env_id = _get_env_ids()
        env_root  = _resolve_env_path(env_id, tenant_id)
        mlops_svc = _get_mlops_service(env_root)
        result = mlops_svc.bivariate_categorical(
            ds,
            x_col,
            y_col,
            int(body.get("sample_rows") or 50_000),
            int(body.get("limit") or 15),
        )
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 400, "VALIDATION_ERROR")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 13b. Interaction Heatmap ─────────────────────────────────────────────────

@eda_bp.route("/interaction-heatmap", methods=["POST"])
def eda_interaction_heatmap():
    """
    POST /api/eda/interaction-heatmap
    Body: { dataset_id, feature_cols: string[], target_col, sample_rows? }

    Pairwise interaction strength (TP rate lift) between features.
    """
    try:
        body         = request.get_json(silent=True) or {}
        feature_cols = list(body.get("feature_cols") or body.get("columns") or [])
        ds = _require_dataset(body)
        # Use workbench service implementation (EDAService does not provide this)
        tenant_id, env_id = _get_env_ids()
        env_root  = _resolve_env_path(env_id, tenant_id)
        mlops_svc = _get_mlops_service(env_root)
        result = mlops_svc.interaction_heatmap(
            ds,
            feature_cols if len(feature_cols) > 0 else None,
            int(body.get("sample_rows") or 50_000),
        )
        return _ok(result)
    except ValueError as e:
        return _err(str(e), 400, "VALIDATION_ERROR")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")


# ─── 14. Segment Target (TP Rate by Segment) ─────────────────────────────────

@eda_bp.route("/segment-target", methods=["POST"])
def eda_segment_target():
    """
    POST /api/eda/segment-target
    Body: { dataset_id, segment_col, target_col, sample_rows? }

    Returns TP rate for each category of segment_col.
    Used by the Dashboard "TP rate by segment" panels.
    """
    try:
        body        = request.get_json(silent=True) or {}
        target_col  = _get_target_col(body)
        columns     = list(body.get("columns") or [])
        segment_col = str(body.get("segment_col") or body.get("column") or "").strip()
        if not columns and segment_col:
            columns = [segment_col]
        if not target_col or not columns:
            return _err("'target_col' and at least one segment column are required")

        ds = _require_dataset(body)

        # Use workbench service implementation for multi-column compatibility
        tenant_id, env_id = _get_env_ids()
        env_root  = _resolve_env_path(env_id, tenant_id)
        mlops_svc = _get_mlops_service(env_root)
        result = mlops_svc.segment_target(
            ds,
            target_col,
            columns,
            int(body.get("sample_rows") or 50_000),
            int(body.get("max_categories") or 25),
        )

        return _ok(result)
    except ValueError as e:
        return _err(str(e), 400, "VALIDATION_ERROR")
    except Exception as e:
        return _err(str(e), 500, "SERVER_ERROR")
