"""
Master Dataset Preview Engine (AML / FCC MLOps)
==============================================
Executes a MasterDatasetPlan against controlled sample or full in-memory data
to calculate operation-by-operation execution traces, join coverages,
duplication factors, aggregation impacts, and label distributions.

Strictly validates against the Master Dataset Contract:
- Enforces declared grain (1 row per alert)
- Prevents Cartesian fan-out and row explosions
- Enforces strict pre-alert anti-lookahead temporal boundaries
- Derives ground-truth outcome labels
- NEVER writes to persistent production storage during preview
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple, Union

import numpy as np
import pandas as pd

from api.tools.mlops.master_dataset_planner import (
    CardinalityType,
    JoinSafety,
    JoinType,
    MasterDatasetPlan,
    RowImpact,
)

logger = logging.getLogger(__name__)


# ── High-Risk Jurisdictions Constants ──────────────────────────────────────────
_HIGH_RISK_COUNTRIES = {
    "AF", "AL", "BB", "BF", "BS", "BW", "CD", "CI", "DZ", "GH",
    "HT", "IR", "IQ", "JM", "JO", "KH", "KP", "KY", "LB", "ML",
    "MM", "MO", "MZ", "NG", "NI", "PA", "PK", "RU", "SD", "SN",
    "SY", "TT", "UG", "UZ", "VE", "VG", "VN", "VU", "YE", "ZW",
}

_FATF_GREY_BLACK_LIST = {"KY", "VG", "NG", "IR", "PK", "SY", "MM", "YE", "KP"}


# ── Data Classes ───────────────────────────────────────────────────────────────

@dataclass
class ExecutionStepTrace:
    step_number: int
    operation_type: str  # "ANCHOR_INIT", "ENRICHMENT_JOIN", "TRANSACTION_AGGREGATION", "OUTCOME_LABELING", "TRANSFORMATION"
    source_name: str
    target_name: Optional[str]
    description: str
    rows_before: int
    rows_after: int
    row_delta: int
    matched_rows: Optional[int]
    coverage_pct: Optional[float]
    duplication_factor: float
    fanout_detected: bool
    columns_before_count: int
    columns_after_count: int
    introduced_columns: List[str]
    removed_columns: List[str]
    step_summary: str


@dataclass
class LabelAvailabilitySummary:
    strategy: str
    total_alerts: int
    labelled_alerts: int
    unlabeled_excluded_alerts: int
    positive_count: int
    negative_count: int
    class_balance_pct: float
    str_attributed_positives: int
    case_attributed_positives: int
    str_fanout_removed_count: int


@dataclass
class PreviewContractValidation:
    passed: bool
    grain_preserved: bool
    primary_key_unique: bool
    anti_lookahead_leakage_free: bool
    ground_truth_valid: bool
    violations: List[str]


@dataclass
class PreviewResult:
    plan_id: str
    plan_name: str
    target_grain: str
    primary_key: str
    initial_rows: int
    final_rows: int
    final_columns_count: int
    columns: List[str]
    execution_trace: List[ExecutionStepTrace]
    human_readable_trace: List[str]
    label_summary: Optional[LabelAvailabilitySummary]
    contract_validation: PreviewContractValidation
    sample_rows: List[Dict[str, Any]]
    column_sources_map: Dict[str, str]
    preview_rows_count: int
    generated_at: str

    def to_dict(self) -> Dict[str, Any]:
        """Converts PreviewResult into a JSON-serializable dictionary."""
        return {
            "plan_id": self.plan_id,
            "plan_name": self.plan_name,
            "target_grain": self.target_grain,
            "primary_key": self.primary_key,
            "initial_rows": self.initial_rows,
            "final_rows": self.final_rows,
            "final_columns_count": self.final_columns_count,
            "columns": self.columns,
            "execution_trace": [asdict(t) for t in self.execution_trace],
            "human_readable_trace": self.human_readable_trace,
            "label_summary": asdict(self.label_summary) if self.label_summary else None,
            "contract_validation": asdict(self.contract_validation),
            "sample_rows": self.sample_rows,
            "column_sources_map": self.column_sources_map,
            "preview_rows_count": self.preview_rows_count,
            "generated_at": self.generated_at,
        }


# ── Preview Engine ─────────────────────────────────────────────────────────────

class MasterDatasetPreviewEngine:
    """
    Executes dry-run preview builds according to a MasterDatasetPlan.
    """

    def __init__(self, sample_limit: int = 20000, preview_display_limit: int = 50):
        self.sample_limit = sample_limit
        self.preview_display_limit = preview_display_limit

    def execute_preview(
        self,
        plan: Union[MasterDatasetPlan, Dict[str, Any]],
        tables: Dict[str, pd.DataFrame],
    ) -> PreviewResult:
        """Executes the plan in dry-run mode and calculates complete execution traces."""
        plan_dict = plan.to_dict() if isinstance(plan, MasterDatasetPlan) else dict(plan)

        # 1. Resolve Tables & Roles
        by_role = self._resolve_tables_by_role(plan_dict, tables)

        # 2. Extract Plan Specifications
        grain_spec = plan_dict.get("target_grain") or {}
        anchor_entity = grain_spec.get("entity_name") or "alerts"
        anchor_pk = grain_spec.get("primary_key") or "alert_id"
        anchor_ts = grain_spec.get("event_timestamp_column") or "alert_date"

        if anchor_entity not in by_role:
            raise ValueError(f"Anchor dataset '{anchor_entity}' is missing from available workspace tables.")

        anchor_df = by_role[anchor_entity].copy()
        if self.sample_limit and len(anchor_df) > self.sample_limit:
            anchor_df = anchor_df.head(self.sample_limit).copy()

        current_df = anchor_df
        execution_trace: List[ExecutionStepTrace] = []
        human_trace: List[str] = []
        column_sources: Dict[str, str] = {str(c): anchor_entity for c in current_df.columns}
        violations: List[str] = []

        step_counter = 1

        # Step 0: Anchor Initialization
        init_rows = len(current_df)
        execution_trace.append(
            ExecutionStepTrace(
                step_number=step_counter,
                operation_type="ANCHOR_INIT",
                source_name=anchor_entity,
                target_name=None,
                description=f"Initialize base grain table '{anchor_entity}' with {init_rows:,} alerts.",
                rows_before=init_rows,
                rows_after=init_rows,
                row_delta=0,
                matched_rows=init_rows,
                coverage_pct=100.0,
                duplication_factor=1.0,
                fanout_detected=False,
                columns_before_count=len(current_df.columns),
                columns_after_count=len(current_df.columns),
                introduced_columns=list(current_df.columns),
                removed_columns=[],
                step_summary=f"{anchor_entity}: {init_rows:,} alerts",
            )
        )
        human_trace.append(f"{anchor_entity}\n{init_rows:,} rows")

        # 3. Execute Planned Relational Joins
        relationships = plan_dict.get("relationships") or []
        for rel in relationships:
            if bool(rel.get("is_aggregation_placeholder")):
                continue  # Skip raw placeholders; handled in aggregation stage

            right_table_name = rel.get("right_source")
            if right_table_name not in by_role:
                violations.append(f"Planned relationship target table '{right_table_name}' was not found in workspace.")
                continue

            right_df = by_role[right_table_name].copy()
            join_keys = rel.get("join_keys") or []
            if not join_keys:
                violations.append(f"Relationship for '{right_table_name}' has no join keys defined.")
                continue

            left_key = join_keys[0].get("left_column") or join_keys[0].get("left")
            right_key = join_keys[0].get("right_column") or join_keys[0].get("right")

            left_col = self._find_col(current_df, [left_key])
            right_col = self._find_col(right_df, [right_key])

            if not left_col or not right_col:
                violations.append(f"Join key mismatch: Could not locate '{left_key}' in working frame or '{right_key}' in '{right_table_name}'.")
                continue

            step_counter += 1
            rows_before = len(current_df)
            cols_before = list(current_df.columns)

            # Deduplicate right table if configured
            if bool(rel.get("deduplicate_right", True)):
                right_df = right_df.drop_duplicates(subset=[right_col], keep="first")

            matched_count = int(current_df[left_col].dropna().astype(str).isin(right_df[right_col].dropna().astype(str)).sum())
            coverage_pct = float(matched_count / max(rows_before, 1) * 100.0)

            # Merge
            merged = current_df.merge(
                right_df,
                left_on=left_col,
                right_on=right_col,
                how="left",
                suffixes=("", f"_{right_table_name}"),
            )
            rows_after = len(merged)
            dup_factor = float(rows_after / max(rows_before, 1))
            fanout = dup_factor > 1.0001

            if fanout:
                violations.append(
                    f"ROW EXPLOSION DETECTED on joining '{right_table_name}': "
                    f"Rows inflated from {rows_before:,} to {rows_after:,} (Duplication factor: {dup_factor:.4f}). "
                    f"Violates 1-row-per-alert grain invariant!"
                )

            new_cols = [c for c in merged.columns if c not in cols_before]
            for nc in new_cols:
                column_sources[str(nc)] = right_table_name

            execution_trace.append(
                ExecutionStepTrace(
                    step_number=step_counter,
                    operation_type="ENRICHMENT_JOIN",
                    source_name=rel.get("left_source"),
                    target_name=right_table_name,
                    description=f"LEFT JOIN '{right_table_name}' ON {left_col} = {right_col}.",
                    rows_before=rows_before,
                    rows_after=rows_after,
                    row_delta=rows_after - rows_before,
                    matched_rows=matched_count,
                    coverage_pct=round(coverage_pct, 2),
                    duplication_factor=round(dup_factor, 4),
                    fanout_detected=fanout,
                    columns_before_count=len(cols_before),
                    columns_after_count=len(merged.columns),
                    introduced_columns=new_cols,
                    removed_columns=[],
                    step_summary=f"-> join {right_table_name}: {rows_after:,} rows ({coverage_pct:.1f}% coverage)",
                )
            )
            human_trace.append(f"-> join {right_table_name}\n{rows_after:,} rows")
            current_df = merged

        # 4. Execute Transaction Aggregation
        txn_agg_spec = plan_dict.get("transaction_aggregation")
        if txn_agg_spec:
            txn_source_name = txn_agg_spec.get("source_table")
            if txn_source_name in by_role:
                txn_df = by_role[txn_source_name].copy()
                step_counter += 1
                rows_before = len(current_df)
                cols_before = list(current_df.columns)

                # Compute Aggregation
                agg_df, agg_key, leak_free = self._compute_pre_alert_aggregations(
                    txn_df=txn_df,
                    alerts_df=current_df,
                    anchor_pk=anchor_pk,
                    anchor_ts=anchor_ts,
                    txn_ts_col=txn_agg_spec.get("transaction_timestamp_col") or "txn_timestamp",
                    acct_join_key=txn_agg_spec.get("account_join_key") or "account_id",
                )

                if not leak_free:
                    violations.append("TEMPORAL LEAKAGE DETECTED: Pre-alert transaction aggregation contained post-alert records.")

                summaries_count = len(agg_df)
                human_trace.append(f"-> aggregate historical {txn_source_name}\n{summaries_count:,} alert-level summaries")

                # Attach Aggregations to Alerts
                merged_agg = current_df.merge(
                    agg_df,
                    left_on=anchor_pk,
                    right_on=agg_key,
                    how="left",
                    suffixes=("", "_agg"),
                )
                rows_after = len(merged_agg)
                dup_factor = float(rows_after / max(rows_before, 1))

                new_cols = [c for c in merged_agg.columns if c not in cols_before]
                for nc in new_cols:
                    column_sources[str(nc)] = f"{txn_source_name}_agg"

                execution_trace.append(
                    ExecutionStepTrace(
                        step_number=step_counter,
                        operation_type="TRANSACTION_AGGREGATION",
                        source_name=txn_source_name,
                        target_name=anchor_entity,
                        description=(
                            f"Aggregated {len(txn_df):,} transactions into {len(new_cols)} behavioral metrics "
                            f"under strict temporal filter (TXN_TIMESTAMP < ALERT_DATE)."
                        ),
                        rows_before=rows_before,
                        rows_after=rows_after,
                        row_delta=0,
                        matched_rows=summaries_count,
                        coverage_pct=100.0,
                        duplication_factor=round(dup_factor, 4),
                        fanout_detected=dup_factor > 1.0001,
                        columns_before_count=len(cols_before),
                        columns_after_count=len(merged_agg.columns),
                        introduced_columns=new_cols,
                        removed_columns=[],
                        step_summary=f"-> attach transaction features: {rows_after:,} rows (+{len(new_cols)} features)",
                    )
                )
                human_trace.append(f"-> attach transaction features\n{rows_after:,} rows")
                current_df = merged_agg

        # 5. Apply Transformations (Imputations, Defaults)
        transformations = plan_dict.get("transformations") or []
        for trans in transformations:
            col_target = trans.get("column")
            val = trans.get("value")
            t_type = trans.get("type")
            real_col = self._find_col(current_df, [col_target])
            if real_col:
                if t_type == "IMPUTE_DEFAULT":
                    current_df[real_col] = current_df[real_col].fillna(val)

        # 6. Apply Outcome & Label Derivation
        outcome_rules = plan_dict.get("outcome_rules") or {}
        label_summary = None
        if outcome_rules:
            step_counter += 1
            rows_before = len(current_df)
            cols_before = list(current_df.columns)

            labelled_df, l_summary = self._derive_ground_truth_labels(
                working_df=current_df,
                outcome_rules=outcome_rules,
                by_role=by_role,
                anchor_ts=anchor_ts,
            )

            rows_after = len(labelled_df)
            label_summary = l_summary
            new_cols = [c for c in labelled_df.columns if c not in cols_before]
            for nc in new_cols:
                column_sources[str(nc)] = "label_engine"

            execution_trace.append(
                ExecutionStepTrace(
                    step_number=step_counter,
                    operation_type="OUTCOME_LABELING",
                    source_name="outcome_rules",
                    target_name=anchor_entity,
                    description=(
                        f"Reconciled STR lookforward (60d) and case dispositions. "
                        f"{l_summary.positive_count:,} True Positives ({l_summary.class_balance_pct:.1f}%), "
                        f"{l_summary.unlabeled_excluded_alerts:,} open alerts excluded."
                    ),
                    rows_before=rows_before,
                    rows_after=rows_after,
                    row_delta=rows_after - rows_before,
                    matched_rows=rows_after,
                    coverage_pct=round(rows_after / max(rows_before, 1) * 100.0, 2),
                    duplication_factor=1.0,
                    fanout_detected=False,
                    columns_before_count=len(cols_before),
                    columns_after_count=len(labelled_df.columns),
                    introduced_columns=new_cols,
                    removed_columns=[],
                    step_summary=f"-> derive outcome: {rows_after:,} labelled rows ({l_summary.positive_count:,} TP, {l_summary.negative_count:,} FP)",
                )
            )
            human_trace.append(f"-> derive outcome\n{rows_after:,} labelled rows")
            current_df = labelled_df

        # 7. Final Master Dataset Contract Assertions
        pk_col = self._find_col(current_df, [anchor_pk])
        pk_unique = bool(pk_col and current_df[pk_col].nunique() == len(current_df))
        if not pk_unique:
            violations.append(f"PRIMARY KEY VIOLATION: '{anchor_pk}' is not unique in output dataset.")

        contract_passed = len(violations) == 0

        # Sample rows for preview
        sample_records = (
            current_df.head(self.preview_display_limit)
            .fillna("")
            .to_dict(orient="records")
        )

        return PreviewResult(
            plan_id=plan_dict.get("plan_id", "preview_plan"),
            plan_name=plan_dict.get("name", "Master Dataset Preview"),
            target_grain=anchor_entity,
            primary_key=anchor_pk,
            initial_rows=init_rows,
            final_rows=len(current_df),
            final_columns_count=len(current_df.columns),
            columns=list(current_df.columns),
            execution_trace=execution_trace,
            human_readable_trace=human_trace,
            label_summary=label_summary,
            contract_validation=PreviewContractValidation(
                passed=contract_passed,
                grain_preserved=pk_unique and len(violations) == 0,
                primary_key_unique=pk_unique,
                anti_lookahead_leakage_free=True,
                ground_truth_valid=label_summary is not None and label_summary.positive_count > 0,
                violations=violations,
            ),
            sample_rows=sample_records,
            column_sources_map=column_sources,
            preview_rows_count=len(sample_records),
            generated_at=datetime.utcnow().isoformat() + "Z",
        )

    # ── Internal Helper Methods ────────────────────────────────────────────────

    def _resolve_tables_by_role(
        self,
        plan_dict: Dict[str, Any],
        tables: Dict[str, pd.DataFrame],
    ) -> Dict[str, pd.DataFrame]:
        by_role: Dict[str, pd.DataFrame] = {}
        for name, df in tables.items():
            by_role[name.strip().lower()] = df

        # Map plan source roles
        for src in plan_dict.get("sources", []):
            tbl = src.get("table_name", "").strip().lower()
            role = src.get("role", "").strip().lower()
            if tbl in by_role and role and role not in by_role:
                by_role[role] = by_role[tbl]

        return by_role

    def _compute_pre_alert_aggregations(
        self,
        txn_df: pd.DataFrame,
        alerts_df: pd.DataFrame,
        anchor_pk: str,
        anchor_ts: str,
        txn_ts_col: str,
        acct_join_key: str,
    ) -> Tuple[pd.DataFrame, str, bool]:
        """Calculates multi-horizon pre-alert transaction behavioral features."""
        alert_id_col = self._find_col(alerts_df, [anchor_pk, "alert_id"])
        alert_acct_col = self._find_col(alerts_df, [acct_join_key, "account_id", "acct_id"])
        alert_date_col = self._find_col(alerts_df, [anchor_ts, "alert_date", "alert_timestamp", "event_date"])

        txn_acct_col = self._find_col(txn_df, [acct_join_key, "account_id", "acct_id"])
        txn_time_col = self._find_col(txn_df, [txn_ts_col, "txn_timestamp", "transaction_timestamp", "txn_date"])

        if not alert_id_col or not alert_acct_col or not alert_date_col or not txn_acct_col or not txn_time_col:
            # Fallback empty
            return pd.DataFrame({anchor_pk: alerts_df[alert_id_col or anchor_pk].unique()}), anchor_pk, True

        alerts_work = alerts_df[[alert_id_col, alert_acct_col, alert_date_col]].copy()
        alerts_work[alert_date_col] = pd.to_datetime(alerts_work[alert_date_col], errors="coerce")
        alerts_work = alerts_work.dropna(subset=[alert_id_col, alert_acct_col, alert_date_col])

        txns_work = txn_df.copy()
        txns_work[txn_time_col] = pd.to_datetime(txns_work[txn_time_col], errors="coerce")

        amt_col = self._find_col(txns_work, ["txn_amount", "amount", "volume"])
        if amt_col:
            txns_work[amt_col] = pd.to_numeric(txns_work[amt_col], errors="coerce").fillna(0.0)
        else:
            amt_col = "__amount"
            txns_work[amt_col] = 0.0

        type_col = self._find_col(txns_work, ["txn_type", "type"])
        if type_col:
            type_u = txns_work[type_col].astype(str).str.upper()
            txns_work["__is_cash"] = type_u.isin(["CASH", "CASH_DEPOSIT", "CASH_WITHDRAWAL"]).astype(int)
            txns_work["__is_swift"] = (type_u == "SWIFT").astype(int)
        else:
            txns_work["__is_cash"] = 0
            txns_work["__is_swift"] = 0

        ben_col = self._find_col(txns_work, ["beneficiary_country", "destination_country", "country"])
        if ben_col:
            ben_u = txns_work[ben_col].astype(str).str.upper()
            txns_work["__is_hr_dest"] = ben_u.isin(_HIGH_RISK_COUNTRIES).astype(int)
            txns_work["__is_fatf_dest"] = ben_u.isin(_FATF_GREY_BLACK_LIST).astype(int)
        else:
            txns_work["__is_hr_dest"] = 0
            txns_work["__is_fatf_dest"] = 0

        dir_col = self._find_col(txns_work, ["txn_direction", "direction", "dr_cr"])
        if dir_col:
            dir_u = txns_work[dir_col].astype(str).str.upper()
            txns_work["__credit_vol"] = np.where(dir_u.isin(["CREDIT", "CR", "IN"]), txns_work[amt_col], 0.0)
            txns_work["__debit_vol"] = np.where(dir_u.isin(["DEBIT", "DR", "OUT"]), txns_work[amt_col], 0.0)
        else:
            txns_work["__credit_vol"] = 0.0
            txns_work["__debit_vol"] = 0.0

        # Enforce Anti-Leakage Join
        joined = txns_work.merge(
            alerts_work,
            left_on=txn_acct_col,
            right_on=alert_acct_col,
            how="inner",
        )
        pre_filter_len = len(joined)
        # Strict temporal barrier: TXN_TIMESTAMP < ALERT_DATE
        joined = joined[
            joined[txn_time_col].notna()
            & joined[alert_date_col].notna()
            & (joined[txn_time_col] < joined[alert_date_col])
        ].copy()

        leak_free = True
        joined["__days_before"] = (joined[alert_date_col] - joined[txn_time_col]).dt.days.fillna(999999)

        # Multi-Window Aggregation
        def _window_agg(days: int, prefix: str) -> pd.DataFrame:
            sub = joined[joined["__days_before"] <= float(days)]
            if sub.empty:
                return pd.DataFrame(columns=[alert_id_col])
            spec = {
                f"{prefix}_vol": (amt_col, "sum"),
                f"{prefix}_cnt": (amt_col, "count"),
                f"{prefix}_avg_amt": (amt_col, "mean"),
                f"{prefix}_max_amt": (amt_col, "max"),
                f"{prefix}_std_amt": (amt_col, "std"),
                f"{prefix}_cash_cnt": ("__is_cash", "sum"),
                f"{prefix}_swift_cnt": ("__is_swift", "sum"),
                f"{prefix}_hr_dest_cnt": ("__is_hr_dest", "sum"),
                f"{prefix}_credit_vol": ("__credit_vol", "sum"),
                f"{prefix}_debit_vol": ("__debit_vol", "sum"),
            }
            return sub.groupby(alert_id_col, dropna=False).agg(**spec).reset_index()

        all_spec = {
            "total_txn_volume": (amt_col, "sum"),
            "txn_count": (amt_col, "count"),
            "avg_txn_amount": (amt_col, "mean"),
            "max_txn_amount": (amt_col, "max"),
            "std_txn_amount": (amt_col, "std"),
            "cash_txn_count": ("__is_cash", "sum"),
            "swift_txn_count": ("__is_swift", "sum"),
            "pct_high_risk_dest": ("__is_hr_dest", "mean"),
        }
        all_agg = joined.groupby(alert_id_col, dropna=False).agg(**all_spec).reset_index()

        agg_df = alerts_work[[alert_id_col]].drop_duplicates().copy()
        for part in [all_agg, _window_agg(7, "w7"), _window_agg(30, "w30"), _window_agg(90, "w90"), _window_agg(365, "w365")]:
            if part is not None and not part.empty:
                agg_df = agg_df.merge(part, on=alert_id_col, how="left")

        # Derived Ratios
        for col in agg_df.columns:
            if col != alert_id_col:
                agg_df[col] = pd.to_numeric(agg_df[col], errors="coerce").fillna(0.0)

        def _col(name: str) -> pd.Series:
            return agg_df[name] if name in agg_df.columns else pd.Series(0.0, index=agg_df.index)

        agg_df["velocity_ratio"] = _col("max_txn_amount") / (_col("avg_txn_amount") + 1.0)
        agg_df["vol_spike_30_vs_90"] = _col("w30_vol") / (_col("w90_vol") + 1.0)
        agg_df["cnt_spike_30_vs_90"] = _col("w30_cnt") / (_col("w90_cnt") + 1.0)
        agg_df["vol_spike_7_vs_30"] = _col("w7_vol") / (_col("w30_vol") + 1.0)
        agg_df["pass_through_ratio_30d"] = np.minimum(_col("w30_credit_vol"), _col("w30_debit_vol")) / (np.maximum(_col("w30_credit_vol"), _col("w30_debit_vol")) + 1.0)
        agg_df["cash_intensity_30d"] = (_col("w30_cash_cnt") / (_col("w30_cnt") + 1.0)) * 100.0

        return agg_df, str(alert_id_col), leak_free

    def _derive_ground_truth_labels(
        self,
        working_df: pd.DataFrame,
        outcome_rules: Dict[str, Any],
        by_role: Dict[str, pd.DataFrame],
        anchor_ts: str,
    ) -> Tuple[pd.DataFrame, LabelAvailabilitySummary]:
        out = working_df.copy()
        case_status_col = self._find_col(out, ["case_status", "status", "disposition"])
        status_map = {
            "CLOSED_SAR_FILED": 1.0,
            "SAR_FILED": 1.0,
            "SAR FILED": 1.0,
            "TRUE_POSITIVE": 1.0,
            "CLOSED_FALSE_POSITIVE": 0.0,
            "FALSE_POSITIVE": 0.0,
            "CLOSED_MONITORING": 0.0,
            "MONITORING": 0.0,
        }
        if case_status_col:
            norm_status = out[case_status_col].astype(str).str.strip().str.upper()
            case_labels = norm_status.map(status_map)
        else:
            case_labels = pd.Series(np.nan, index=out.index)

        # STR Lookforward
        tp_from_str = pd.Series(0, index=out.index, dtype="int64")
        str_fanout_removed = 0
        str_candidates = 0

        str_source_name = (outcome_rules.get("str_lookforward") or {}).get("source_table") or "str_reports"
        str_source_name = str_source_name.lower()
        if str_source_name in by_role:
            str_df = by_role[str_source_name]
            str_acct_col = self._find_col(str_df, ["account_id", "acct_id"])
            str_date_col = self._find_col(str_df, ["str_filed_date", "sar_filed_date", "report_date", "date"])
            acct_col = self._find_col(out, ["account_id", "acct_id"])
            alert_dt_col = self._find_col(out, [anchor_ts, "alert_date", "alert_timestamp"])

            if str_acct_col and str_date_col and acct_col and alert_dt_col:
                str_hist = str_df[[str_acct_col, str_date_col]].copy()
                str_hist[str_date_col] = pd.to_datetime(str_hist[str_date_col], errors="coerce")
                str_hist = str_hist.dropna(subset=[str_acct_col, str_date_col])

                if not str_hist.empty:
                    str_lookup = str_hist.groupby(str_acct_col)[str_date_col].apply(list).to_dict()
                    alert_dates = pd.to_datetime(out[alert_dt_col], errors="coerce")
                    days_to_next_str = pd.Series(np.nan, index=out.index, dtype="float64")

                    for idx, (acct, alert_dt) in enumerate(zip(out[acct_col], alert_dates)):
                        if pd.isna(acct) or pd.isna(alert_dt):
                            continue
                        acct_key = str(acct)
                        cutoff = alert_dt + pd.to_timedelta(60, unit="D")
                        forward_days = [
                            float((d - alert_dt).days)
                            for d in str_lookup.get(acct_key, [])
                            if alert_dt < d <= cutoff
                        ]
                        if forward_days:
                            days_to_next_str.iat[idx] = float(min(forward_days))

                    cand_mask = days_to_next_str.notna()
                    str_candidates = int(cand_mask.sum())
                    if str_candidates > 0:
                        cand_df = pd.DataFrame(
                            {"__acct": out[acct_col].astype(str), "__days": days_to_next_str},
                            index=out.index,
                        ).loc[cand_mask].copy()
                        primary_idx = cand_df.groupby("__acct")["__days"].idxmin()
                        tp_from_str.loc[primary_idx.values] = 1
                        str_fanout_removed = max(0, str_candidates - int(tp_from_str.sum()))

        out["TP_FROM_STR"] = tp_from_str
        out["CASE_LABEL"] = case_labels
        out["FINAL_LABEL"] = np.where(out["TP_FROM_STR"] == 1, 1.0, out["CASE_LABEL"])
        out["IS_TRUE_POS"] = out["FINAL_LABEL"]
        out["str_label"] = out["FINAL_LABEL"]

        n_total = len(out)
        n_excluded = int(out["FINAL_LABEL"].isna().sum())
        labelled = out[out["FINAL_LABEL"].notna()].copy()
        if not labelled.empty:
            labelled["FINAL_LABEL"] = labelled["FINAL_LABEL"].astype(int)
            labelled["IS_TRUE_POS"] = labelled["FINAL_LABEL"].astype(int)
            labelled["str_label"] = labelled["FINAL_LABEL"].astype(int)

        n_labelled = len(labelled)
        n_pos = int((labelled["FINAL_LABEL"] == 1).sum()) if n_labelled else 0
        n_neg = int((labelled["FINAL_LABEL"] == 0).sum()) if n_labelled else 0

        summary = LabelAvailabilitySummary(
            strategy=outcome_rules.get("strategy_name", "reconciled_ground_truth"),
            total_alerts=n_total,
            labelled_alerts=n_labelled,
            unlabeled_excluded_alerts=n_excluded,
            positive_count=n_pos,
            negative_count=n_neg,
            class_balance_pct=round(float(n_pos / max(n_labelled, 1) * 100.0), 2),
            str_attributed_positives=int(tp_from_str.sum()),
            case_attributed_positives=int((case_labels == 1.0).sum()),
            str_fanout_removed_count=str_fanout_removed,
        )

        return labelled, summary

    def _find_col(self, df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
        cols = {str(c).strip().lower(): c for c in df.columns}
        for cand in candidates:
            if not cand:
                continue
            c_norm = str(cand).strip().lower()
            if c_norm in cols:
                return str(cols[c_norm])
        return None
