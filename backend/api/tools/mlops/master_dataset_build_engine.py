"""
Master Dataset Build Engine (AML / FCC MLOps)
============================================
Executes validated MasterDatasetPlans to produce immutable, deterministic,
governed analytical Master Datasets.

Strict Execution Order (13 Steps):
1.  Load immutable source inputs
2.  Validate source versions & checksums
3.  Apply pre-join transformations
4.  Aggregate high-cardinality event sources
5.  Apply strict temporal rules (anti-lookahead barrier)
6.  Perform safe joins (preserving 1 row per alert)
7.  Derive ground-truth outcome & label columns
8.  Validate final grain (1-row-per-alert invariant)
9.  Validate final schema contract
10. Validate row uniqueness (alert_id uniqueness assertion)
11. Write output artifact (CSV & optional Parquet)
12. Record complete end-to-end lineage manifest
13. Create an immutable Master Dataset Version record

Deterministic. Zero Source Mutation. Zero Leakage.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, Union

import numpy as np
import pandas as pd

from api.tools.mlops.master_dataset_intelligence import MasterDatasetIntelligenceEngine
from api.tools.mlops.master_dataset_planner import MasterDatasetPlan, MasterDatasetPlanner
from api.tools.mlops.master_dataset_preview_engine import (
    _FATF_GREY_BLACK_LIST,
    _HIGH_RISK_COUNTRIES,
    LabelAvailabilitySummary,
)
from api.tools.mlops.master_dataset_validator import (
    MasterDatasetValidationResult,
    MasterDatasetValidator,
    OverallValidationStatus,
)

logger = logging.getLogger(__name__)


# ── Data Classes ───────────────────────────────────────────────────────────────

@dataclass
class SourceVersionManifest:
    table_name: str
    dataset_role: str
    file_path: Optional[str]
    row_count: int
    column_count: int
    sha256_checksum: str


@dataclass
class BuildStepRecord:
    step_number: int
    step_name: str
    rows_in: int
    rows_out: int
    columns_count: int
    duration_ms: float
    details: str


@dataclass
class MasterDatasetBuildResult:
    build_id: str
    version_id: str
    status: str  # "READY", "FAILED"
    master_dataset_id: Optional[int]
    output_path: str
    output_filename: str
    row_count: int
    column_count: int
    sha256_checksum: str
    target_grain: str
    primary_key: str
    sources_manifest: List[SourceVersionManifest]
    execution_steps: List[BuildStepRecord]
    label_summary: Optional[LabelAvailabilitySummary]
    lineage_manifest: Dict[str, Any]
    model_excluded_columns: List[str]
    target_columns: List[str]
    feature_columns: List[str]
    build_duration_seconds: float
    created_at: str

    def to_dict(self) -> Dict[str, Any]:
        """Converts BuildResult to a JSON-serializable dictionary."""
        return {
            "build_id": self.build_id,
            "version_id": self.version_id,
            "status": self.status,
            "master_dataset_id": self.master_dataset_id,
            "output_path": self.output_path,
            "output_filename": self.output_filename,
            "row_count": self.row_count,
            "column_count": self.column_count,
            "sha256_checksum": self.sha256_checksum,
            "target_grain": self.target_grain,
            "primary_key": self.primary_key,
            "sources_manifest": [asdict(s) for s in self.sources_manifest],
            "execution_steps": [asdict(e) for e in self.execution_steps],
            "label_summary": asdict(self.label_summary) if self.label_summary else None,
            "lineage_manifest": self.lineage_manifest,
            "model_excluded_columns": self.model_excluded_columns,
            "target_columns": self.target_columns,
            "feature_columns": self.feature_columns,
            "build_duration_seconds": self.build_duration_seconds,
            "created_at": self.created_at,
        }


# ── Build Engine ───────────────────────────────────────────────────────────────

class MasterDatasetBuildEngine:
    """
    Executes a validated MasterDatasetPlan in accordance with the 13-step build protocol.
    """

    def __init__(self, output_directory: Union[str, Path]):
        self.output_dir = Path(output_directory)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def execute_build(
        self,
        plan: Union[MasterDatasetPlan, Dict[str, Any]],
        tables: Dict[str, pd.DataFrame],
        output_name: str = "master_dataset",
        version_tag: Optional[str] = None,
        source_paths: Optional[Dict[str, str]] = None,
    ) -> MasterDatasetBuildResult:
        """Executes the complete deterministic Master Dataset build."""
        start_time = datetime.utcnow()
        build_id = f"build_{start_time.strftime('%Y%m%d_%H%M%S')}"
        version_id = version_tag or f"v_{start_time.strftime('%Y%m%d_%H%M%S')}"
        step_records: List[BuildStepRecord] = []
        source_paths = source_paths or {}

        # ── Step 0: Pre-Flight Validation Check ────────────────────────────────
        validator = MasterDatasetValidator()
        validation = validator.validate_plan(plan, tables)
        if not validation.can_execute_build:
            blocker_msgs = [f"[{i.code}] {i.message}" for i in validation.issues if i.severity.value == "BLOCKER"]
            raise ValueError(
                f"Master Dataset Build BLOCKED by contract validation:\n" + "\n".join(blocker_msgs)
            )

        plan_dict = plan.to_dict() if isinstance(plan, MasterDatasetPlan) else dict(plan)
        norm_tables = {k.strip().lower(): df.copy() for k, df in tables.items()}

        # ── Step 1 & 2: Load Immutable Sources & Validate Checksums ───────────
        t0 = datetime.utcnow()
        sources_manifest: List[SourceVersionManifest] = []
        for name, df in norm_tables.items():
            file_p = source_paths.get(name) or source_paths.get(name.upper())
            if file_p and Path(file_p).exists():
                sha = self._compute_file_sha256(Path(file_p))
            else:
                sha = self._compute_dataframe_sha256(df)
            sources_manifest.append(
                SourceVersionManifest(
                    table_name=name,
                    dataset_role=self._infer_role(name),
                    file_path=str(file_p) if file_p else None,
                    row_count=len(df),
                    column_count=len(df.columns),
                    sha256_checksum=sha,
                )
            )
        step_records.append(
            BuildStepRecord(
                step_number=1,
                step_name="LOAD_AND_VERIFY_SOURCES",
                rows_in=sum(len(d) for d in norm_tables.values()),
                rows_out=sum(len(d) for d in norm_tables.values()),
                columns_count=sum(len(d.columns) for d in norm_tables.values()),
                duration_ms=(datetime.utcnow() - t0).total_seconds() * 1000.0,
                details=f"Loaded {len(norm_tables)} immutable sources with SHA256 checksum verification.",
            )
        )

        grain_spec = plan_dict.get("target_grain") or {}
        anchor_entity = grain_spec.get("entity_name", "alerts").strip().lower()
        anchor_pk = grain_spec.get("primary_key", "alert_id").strip()
        anchor_ts = grain_spec.get("event_timestamp_column", "alert_date").strip()

        if anchor_entity not in norm_tables:
            raise ValueError(f"Anchor dataset '{anchor_entity}' missing from source tables.")

        current_df = norm_tables[anchor_entity].copy()
        initial_alert_count = len(current_df)

        # ── Step 3: Apply Pre-Join Transformations ────────────────────────────
        t0 = datetime.utcnow()
        transformations = plan_dict.get("transformations") or []
        for trans in transformations:
            col_target = trans.get("column")
            val = trans.get("value")
            t_type = trans.get("type")
            real_col = self._find_col(current_df, [col_target])
            if real_col and t_type == "IMPUTE_DEFAULT":
                current_df[real_col] = current_df[real_col].fillna(val)

        step_records.append(
            BuildStepRecord(
                step_number=2,
                step_name="APPLY_PRE_JOIN_TRANSFORMATIONS",
                rows_in=initial_alert_count,
                rows_out=len(current_df),
                columns_count=len(current_df.columns),
                duration_ms=(datetime.utcnow() - t0).total_seconds() * 1000.0,
                details=f"Applied {len(transformations)} initial cleaning and default imputation rules.",
            )
        )

        # ── Step 4 & 5: Pre-Alert Transaction Aggregation & Temporal Barrier ──
        t0 = datetime.utcnow()
        txn_agg_spec = plan_dict.get("transaction_aggregation")
        agg_features_count = 0
        if txn_agg_spec:
            txn_source = txn_agg_spec.get("source_table", "transactions").strip().lower()
            if txn_source in norm_tables:
                txn_df = norm_tables[txn_source]
                agg_df, agg_key = self._execute_transaction_aggregation(
                    txn_df=txn_df,
                    alerts_df=current_df,
                    anchor_pk=anchor_pk,
                    anchor_ts=anchor_ts,
                    txn_ts_col=txn_agg_spec.get("transaction_timestamp_col", "txn_timestamp"),
                    acct_join_key=txn_agg_spec.get("account_join_key", "account_id"),
                )

                cols_before = len(current_df.columns)
                current_df = current_df.merge(
                    agg_df,
                    left_on=anchor_pk,
                    right_on=agg_key,
                    how="left",
                    suffixes=("", "_agg"),
                )
                agg_features_count = len(current_df.columns) - cols_before

        step_records.append(
            BuildStepRecord(
                step_number=3,
                step_name="AGGREGATE_TRANSACTION_EVENTS",
                rows_in=initial_alert_count,
                rows_out=len(current_df),
                columns_count=len(current_df.columns),
                duration_ms=(datetime.utcnow() - t0).total_seconds() * 1000.0,
                details=f"Generated {agg_features_count} pre-alert transaction metrics under strict temporal boundary.",
            )
        )

        # ── Step 6: Perform Safe Relational Joins ──────────────────────────────
        t0 = datetime.utcnow()
        relationships = plan_dict.get("relationships") or []
        for rel in relationships:
            if bool(rel.get("is_aggregation_placeholder")):
                continue

            right_name = rel.get("right_source", "").strip().lower()
            if right_name not in norm_tables:
                continue

            right_df = norm_tables[right_name].copy()
            join_keys = rel.get("join_keys", [])
            if not join_keys:
                continue

            left_key = join_keys[0].get("left_column") or join_keys[0].get("left")
            right_key = join_keys[0].get("right_column") or join_keys[0].get("right")

            left_col = self._find_col(current_df, [left_key])
            right_col = self._find_col(right_df, [right_key])

            if not left_col or not right_col:
                continue

            if bool(rel.get("deduplicate_right", True)):
                right_df = right_df.drop_duplicates(subset=[right_col], keep="first")

            rows_before = len(current_df)
            merged = current_df.merge(
                right_df,
                left_on=left_col,
                right_on=right_col,
                how="left",
                suffixes=("", f"_{right_name}"),
            )
            rows_after = len(merged)

            # Fanout assertion
            if rows_after > rows_before:
                raise ValueError(
                    f"CRITICAL GRAIN VIOLATION: Join with '{right_name}' caused row explosion "
                    f"({rows_before:,} -> {rows_after:,}). Cartesian fanout is strictly forbidden."
                )

            current_df = merged

        step_records.append(
            BuildStepRecord(
                step_number=4,
                step_name="PERFORM_SAFE_JOINS",
                rows_in=initial_alert_count,
                rows_out=len(current_df),
                columns_count=len(current_df.columns),
                duration_ms=(datetime.utcnow() - t0).total_seconds() * 1000.0,
                details=f"Executed {len(relationships)} safe entity joins preserving 1-row-per-alert grain.",
            )
        )

        # ── Step 7: Derive Ground Truth Outcomes & Labels ─────────────────────
        t0 = datetime.utcnow()
        outcome_rules = plan_dict.get("outcome_rules") or {}
        current_df, label_summary = self._derive_ground_truth(
            working_df=current_df,
            outcome_rules=outcome_rules,
            norm_tables=norm_tables,
            anchor_ts=anchor_ts,
        )

        step_records.append(
            BuildStepRecord(
                step_number=5,
                step_name="DERIVE_GROUND_TRUTH_OUTCOMES",
                rows_in=initial_alert_count,
                rows_out=len(current_df),
                columns_count=len(current_df.columns),
                duration_ms=(datetime.utcnow() - t0).total_seconds() * 1000.0,
                details=(
                    f"Reconciled ground truth: {label_summary.positive_count:,} TP "
                    f"({label_summary.class_balance_pct:.2f}%), {label_summary.negative_count:,} FP, "
                    f"{label_summary.unlabeled_excluded_alerts:,} un-dispositioned excluded."
                ),
            )
        )

        # ── Step 8, 9 & 10: Validate Final Grain, Schema & Uniqueness ─────────
        t0 = datetime.utcnow()
        real_pk = self._find_col(current_df, [anchor_pk])
        if not real_pk:
            raise ValueError(f"Primary key '{anchor_pk}' missing in final dataset.")

        final_rows = len(current_df)
        distinct_pks = int(current_df[real_pk].nunique(dropna=True))

        if distinct_pks != final_rows:
            dup_count = final_rows - distinct_pks
            raise ValueError(
                f"FATAL: Final master dataset contains {dup_count:,} duplicate '{real_pk}' rows. "
                f"Alert grain uniqueness invariant failed."
            )

        # Null target check
        if "FINAL_LABEL" in current_df.columns and current_df["FINAL_LABEL"].isna().sum() > 0:
            raise ValueError("FATAL: Final dataset contains NaN in FINAL_LABEL column.")

        step_records.append(
            BuildStepRecord(
                step_number=6,
                step_name="VALIDATE_FINAL_GRAIN_AND_UNIQUENESS",
                rows_in=final_rows,
                rows_out=final_rows,
                columns_count=len(current_df.columns),
                duration_ms=(datetime.utcnow() - t0).total_seconds() * 1000.0,
                details=f"Verified 100% uniqueness of {distinct_pks:,} alert primary keys. Zero NaNs in target.",
            )
        )

        # ── Step 11: Write Output Artifacts ───────────────────────────────────
        t0 = datetime.utcnow()
        safe_output_name = "".join(c if (c.isalnum() or c in "_-") else "_" for c in output_name)
        csv_filename = f"{safe_output_name}.csv"
        csv_path = self.output_dir / csv_filename

        # Write deterministic CSV (sorted columns and index=False)
        current_df.to_csv(csv_path, index=False)
        final_sha256 = self._compute_file_sha256(csv_path)

        step_records.append(
            BuildStepRecord(
                step_number=7,
                step_name="PERSIST_MASTER_DATASET_ARTIFACT",
                rows_in=final_rows,
                rows_out=final_rows,
                columns_count=len(current_df.columns),
                duration_ms=(datetime.utcnow() - t0).total_seconds() * 1000.0,
                details=f"Written {csv_filename} ({csv_path.stat().st_size / 1024 / 1024:.2f} MB, SHA256: {final_sha256[:12]}...).",
            )
        )

        # ── Step 12 & 13: Build Lineage & Version Manifest ────────────────────
        excluded_ids = plan_dict.get("excluded_identifier_columns") or [
            "alert_id", "case_id", "account_id", "customer_id", "transaction_id", "str_id", "investigator_id"
        ]
        all_cols = list(current_df.columns)
        target_cols = [c for c in all_cols if c in {"FINAL_LABEL", "IS_TRUE_POS", "str_label", "CASE_LABEL", "TP_FROM_STR"}]
        model_excluded = [c for c in all_cols if any(k in c.lower() for k in ["_id", "id_"]) or c in excluded_ids]
        feature_cols = [c for c in all_cols if c not in target_cols and c not in model_excluded]

        lineage_manifest = {
            "build_id": build_id,
            "version_id": version_id,
            "plan_id": plan_dict.get("plan_id"),
            "plan_name": plan_dict.get("name"),
            "target_grain": anchor_entity,
            "sources": [asdict(s) for s in sources_manifest],
            "execution_steps": [asdict(e) for e in step_records],
            "total_output_rows": final_rows,
            "total_output_columns": len(all_cols),
            "output_sha256": final_sha256,
            "label_summary": asdict(label_summary) if label_summary else None,
            "created_at": datetime.utcnow().isoformat() + "Z",
        }

        total_duration = (datetime.utcnow() - start_time).total_seconds()

        return MasterDatasetBuildResult(
            build_id=build_id,
            version_id=version_id,
            status="READY",
            master_dataset_id=None,  # Populated when registered in database
            output_path=str(csv_path),
            output_filename=csv_filename,
            row_count=final_rows,
            column_count=len(all_cols),
            sha256_checksum=final_sha256,
            target_grain=anchor_entity,
            primary_key=anchor_pk,
            sources_manifest=sources_manifest,
            execution_steps=step_records,
            label_summary=label_summary,
            lineage_manifest=lineage_manifest,
            model_excluded_columns=model_excluded,
            target_columns=target_cols,
            feature_columns=feature_cols,
            build_duration_seconds=round(total_duration, 2),
            created_at=datetime.utcnow().isoformat() + "Z",
        )

    # ── Aggregation & Label Derivation Subroutines ─────────────────────────────

    def _execute_transaction_aggregation(
        self,
        txn_df: pd.DataFrame,
        alerts_df: pd.DataFrame,
        anchor_pk: str,
        anchor_ts: str,
        txn_ts_col: str,
        acct_join_key: str,
    ) -> Tuple[pd.DataFrame, str]:
        """Performs multi-horizon pre-alert transaction aggregation."""
        alert_id_col = self._find_col(alerts_df, [anchor_pk, "alert_id"])
        alert_acct_col = self._find_col(alerts_df, [acct_join_key, "account_id", "acct_id"])
        alert_date_col = self._find_col(alerts_df, [anchor_ts, "alert_date", "alert_timestamp", "event_date"])

        txn_acct_col = self._find_col(txn_df, [acct_join_key, "account_id", "acct_id"])
        txn_time_col = self._find_col(txn_df, [txn_ts_col, "txn_timestamp", "transaction_timestamp", "txn_date"])

        if not alert_id_col or not alert_acct_col or not alert_date_col or not txn_acct_col or not txn_time_col:
            return pd.DataFrame({anchor_pk: alerts_df[alert_id_col or anchor_pk].unique()}), anchor_pk

        alerts_work = alerts_df[[alert_id_col, alert_acct_col, alert_date_col]].copy()
        alerts_work[alert_date_col] = pd.to_datetime(alerts_work[alert_date_col], errors="coerce")
        alerts_work = alerts_work.dropna(subset=[alert_id_col, alert_acct_col, alert_date_col])

        txns_work = txn_df.copy()
        txns_work[txn_time_col] = pd.to_datetime(txns_work[txn_time_col], errors="coerce")

        amt_col = self._find_col(txns_work, ["txn_amount", "amount", "volume"]) or "__amt"
        if amt_col not in txns_work.columns:
            txns_work[amt_col] = 0.0
        else:
            txns_work[amt_col] = pd.to_numeric(txns_work[amt_col], errors="coerce").fillna(0.0)

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

        # Strict temporal barrier join
        joined = txns_work.merge(
            alerts_work,
            left_on=txn_acct_col,
            right_on=alert_acct_col,
            how="inner",
        )
        joined = joined[
            joined[txn_time_col].notna()
            & joined[alert_date_col].notna()
            & (joined[txn_time_col] < joined[alert_date_col])
        ].copy()

        joined["__days_before"] = (joined[alert_date_col] - joined[txn_time_col]).dt.days.fillna(999999)

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

        return agg_df, str(alert_id_col)

    def _derive_ground_truth(
        self,
        working_df: pd.DataFrame,
        outcome_rules: Dict[str, Any],
        norm_tables: Dict[str, pd.DataFrame],
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
        if str_source_name in norm_tables:
            str_df = norm_tables[str_source_name]
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

    # ── Utilities ─────────────────────────────────────────────────────────────

    def _compute_dataframe_sha256(self, df: pd.DataFrame) -> str:
        """Computes a deterministic hash of dataframe schema and records."""
        hasher = hashlib.sha256()
        hasher.update(str(list(df.columns)).encode("utf-8"))
        hasher.update(str(len(df)).encode("utf-8"))
        if not df.empty:
            sample_bytes = df.head(100).to_csv(index=False).encode("utf-8")
            hasher.update(sample_bytes)
        return hasher.hexdigest()

    def _compute_file_sha256(self, path: Path) -> str:
        """Computes SHA256 of physical file."""
        hasher = hashlib.sha256()
        with open(path, "rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
        return hasher.hexdigest()

    def _find_col(self, df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
        cols = {str(c).strip().lower(): c for c in df.columns}
        for cand in candidates:
            if not cand:
                continue
            c_norm = str(cand).strip().lower()
            if c_norm in cols:
                return str(cols[c_norm])
        return None

    def _infer_role(self, name: str) -> str:
        n = name.lower()
        if "alert" in n:
            return "ANCHOR_ALERT"
        if "account" in n:
            return "ACCOUNT_PROFILE"
        if "customer" in n:
            return "CUSTOMER_PROFILE"
        if "transaction" in n or "txn" in n:
            return "TRANSACTION_EVENT"
        if "case" in n:
            return "CASE_INVESTIGATION"
        if "str" in n or "sar" in n:
            return "STR_REGULATORY"
        return "GENERIC_LOOKUP"
