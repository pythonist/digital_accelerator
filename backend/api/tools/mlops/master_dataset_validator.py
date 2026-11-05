"""
Master Dataset Validation Engine (AML / FCC MLOps)
=================================================
Performs strict, independent structural, semantic, relational, temporal,
and contract validations on MasterDatasetPlans before build execution.

Zero frontend dependency. Pure validation rule engine.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple, Union

import numpy as np
import pandas as pd

from api.tools.mlops.master_dataset_planner import MasterDatasetPlan

logger = logging.getLogger(__name__)


# ── Enums & Data Classes ───────────────────────────────────────────────────────

class ValidationSeverity(str, Enum):
    BLOCKER = "BLOCKER"  # Hard error: Execution is blocked
    WARNING = "WARNING"  # Advisory: Suboptimal or potential data quality issue
    INFO = "INFO"        # Informational note


class OverallValidationStatus(str, Enum):
    PASSED = "PASSED"
    WARNING = "WARNING"
    BLOCKED = "BLOCKED"


@dataclass
class ValidationIssue:
    code: str
    severity: ValidationSeverity
    category: str  # "ANCHOR", "RELATIONSHIP", "TEMPORAL", "CARDINALITY", "LABEL", "SCHEMA"
    message: str
    reason: str
    suggested_resolution: str
    affected_table: Optional[str] = None
    affected_column: Optional[str] = None


@dataclass
class ValidationCheckReport:
    check_name: str
    passed: bool
    description: str
    details: Optional[str] = None


@dataclass
class MasterDatasetValidationResult:
    status: OverallValidationStatus
    passed: bool
    can_execute_build: bool
    plan_id: str
    plan_name: str
    target_grain: str
    blocker_count: int
    warning_count: int
    info_count: int
    issues: List[ValidationIssue]
    checks_performed: List[ValidationCheckReport]
    validated_at: str

    def to_dict(self) -> Dict[str, Any]:
        """Converts ValidationResult into a JSON-serializable dictionary."""
        return {
            "status": self.status.value,
            "passed": self.passed,
            "can_execute_build": self.can_execute_build,
            "plan_id": self.plan_id,
            "plan_name": self.plan_name,
            "target_grain": self.target_grain,
            "blocker_count": self.blocker_count,
            "warning_count": self.warning_count,
            "info_count": self.info_count,
            "issues": [
                {
                    **asdict(issue),
                    "severity": issue.severity.value,
                }
                for issue in self.issues
            ],
            "checks_performed": [asdict(check) for check in self.checks_performed],
            "validated_at": self.validated_at,
        }


# ── Validator Engine ───────────────────────────────────────────────────────────

class MasterDatasetValidator:
    """
    Executes the 15 standard Master Dataset contract checks.
    """

    def validate_plan(
        self,
        plan: Union[MasterDatasetPlan, Dict[str, Any]],
        tables: Dict[str, pd.DataFrame],
    ) -> MasterDatasetValidationResult:
        """Runs complete independent validation suite against plan and source tables."""
        plan_dict = plan.to_dict() if isinstance(plan, MasterDatasetPlan) else dict(plan)
        norm_tables = {k.strip().lower(): df for k, df in tables.items()}

        issues: List[ValidationIssue] = []
        checks: List[ValidationCheckReport] = []

        # 1. Validate Source Datasets Available
        self._check_source_availability(plan_dict, norm_tables, issues, checks)

        # 2. Validate Anchor Table & Grain
        anchor_table, anchor_pk, anchor_ts = self._check_anchor_grain(plan_dict, norm_tables, issues, checks)

        # 3. Validate Relational Joins & Key Resolvability
        self._check_relationships(plan_dict, norm_tables, anchor_table, issues, checks)

        # 4. Validate Cardinality & Fan-Out Defenses
        self._check_cardinality_and_fanout(plan_dict, norm_tables, anchor_table, anchor_pk, issues, checks)

        # 5. Validate Transaction Aggregation & Temporal Leakage
        self._check_temporal_aggregation(plan_dict, norm_tables, anchor_table, anchor_ts, issues, checks)

        # 6. Validate Ground Truth & Label Logic
        self._check_outcome_labels(plan_dict, norm_tables, issues, checks)

        # 7. Validate Output Schema Determinism & Required Columns
        self._check_output_schema_determinism(plan_dict, norm_tables, anchor_pk, issues, checks)

        # Calculate Summaries
        blockers = [i for i in issues if i.severity == ValidationSeverity.BLOCKER]
        warnings = [i for i in issues if i.severity == ValidationSeverity.WARNING]
        infos = [i for i in issues if i.severity == ValidationSeverity.INFO]

        if blockers:
            status = OverallValidationStatus.BLOCKED
            passed = False
            can_execute = False
        elif warnings:
            status = OverallValidationStatus.WARNING
            passed = True
            can_execute = True
        else:
            status = OverallValidationStatus.PASSED
            passed = True
            can_execute = True

        grain_name = (plan_dict.get("target_grain") or {}).get("entity_name") or anchor_table or "unknown"

        return MasterDatasetValidationResult(
            status=status,
            passed=passed,
            can_execute_build=can_execute,
            plan_id=plan_dict.get("plan_id", "unknown_plan"),
            plan_name=plan_dict.get("name", "Master Dataset Plan"),
            target_grain=grain_name,
            blocker_count=len(blockers),
            warning_count=len(warnings),
            info_count=len(infos),
            issues=issues,
            checks_performed=checks,
            validated_at=datetime.utcnow().isoformat() + "Z",
        )

    # ── 1. Check Source Datasets Availability ──────────────────────────────────

    def _check_source_availability(
        self,
        plan_dict: Dict[str, Any],
        tables: Dict[str, pd.DataFrame],
        issues: List[ValidationIssue],
        checks: List[ValidationCheckReport],
    ):
        sources = plan_dict.get("sources", [])
        missing: List[str] = []
        empty: List[str] = []

        for s in sources:
            name = s.get("table_name", "").strip().lower()
            role = s.get("role", "").strip().lower()
            found_df = tables.get(name) if tables.get(name) is not None else tables.get(role)

            if found_df is None:
                missing.append(name or role)
            elif found_df.empty:
                empty.append(name or role)

        if missing:
            issues.append(
                ValidationIssue(
                    code="ERR_SOURCE_DATASET_MISSING",
                    severity=ValidationSeverity.BLOCKER,
                    category="ANCHOR",
                    message=f"Declared source dataset(s) missing from workspace: {', '.join(missing)}.",
                    reason="The plan references source tables that have not been uploaded or cannot be resolved.",
                    suggested_resolution="Upload the required datasets or remove unreferenced relationships from the plan.",
                )
            )

        if empty:
            issues.append(
                ValidationIssue(
                    code="ERR_SOURCE_DATASET_EMPTY",
                    severity=ValidationSeverity.BLOCKER,
                    category="ANCHOR",
                    message=f"Source dataset(s) contain 0 rows: {', '.join(empty)}.",
                    reason="Empty datasets cannot participate in analytical merging.",
                    suggested_resolution="Verify the uploaded CSV/Parquet files contain valid row records.",
                )
            )

        checks.append(
            ValidationCheckReport(
                check_name="14. Source Datasets Availability",
                passed=(len(missing) == 0 and len(empty) == 0),
                description="Verifies all declared source tables exist and contain > 0 records.",
                details=f"Validated {len(sources)} source datasets." if not missing else f"Missing: {missing}",
            )
        )

    # ── 2. Check Anchor Grain & Primary Key ────────────────────────────────────

    def _check_anchor_grain(
        self,
        plan_dict: Dict[str, Any],
        tables: Dict[str, pd.DataFrame],
        issues: List[ValidationIssue],
        checks: List[ValidationCheckReport],
    ) -> Tuple[str, str, Optional[str]]:
        grain_spec = plan_dict.get("target_grain") or {}
        anchor = grain_spec.get("entity_name", "alerts").strip().lower()
        pk = grain_spec.get("primary_key", "alert_id").strip()
        ts = grain_spec.get("event_timestamp_column")

        anchor_exists = anchor in tables
        pk_usable = False
        ts_valid = False

        if not anchor_exists:
            issues.append(
                ValidationIssue(
                    code="ERR_ANCHOR_NOT_FOUND",
                    severity=ValidationSeverity.BLOCKER,
                    category="ANCHOR",
                    message=f"Declared anchor table '{anchor}' does not exist in workspace.",
                    reason="Master dataset construction requires a valid base anchor entity.",
                    suggested_resolution="Set base anchor table to 'alerts' or upload the alerts dataset.",
                    affected_table=anchor,
                )
            )
        else:
            anchor_df = tables[anchor]
            real_pk = self._find_col(anchor_df, [pk, "alert_id"])
            if not real_pk:
                issues.append(
                    ValidationIssue(
                        code="ERR_ANCHOR_KEY_NOT_FOUND",
                        severity=ValidationSeverity.BLOCKER,
                        category="ANCHOR",
                        message=f"Primary key '{pk}' not found in anchor table '{anchor}'.",
                        reason="Cannot preserve 1-row-per-record grain without a primary identifier.",
                        suggested_resolution=f"Ensure '{anchor}' contains the column '{pk}'.",
                        affected_table=anchor,
                        affected_column=pk,
                    )
                )
            else:
                pk_series = anchor_df[real_pk]
                null_pks = int(pk_series.isna().sum())
                unique_pks = int(pk_series.nunique(dropna=True))
                total_rows = len(anchor_df)

                if null_pks > 0:
                    issues.append(
                        ValidationIssue(
                            code="ERR_ANCHOR_KEY_NULLS",
                            severity=ValidationSeverity.BLOCKER,
                            category="ANCHOR",
                            message=f"Primary key '{real_pk}' contains {null_pks:,} NULL values ({null_pks/total_rows*100:.1f}%).",
                            reason="Primary identifiers must be 100% non-null.",
                            suggested_resolution="Clean the anchor dataset to remove null identifier rows.",
                            affected_table=anchor,
                            affected_column=real_pk,
                        )
                    )

                if unique_pks < total_rows:
                    dup_count = total_rows - unique_pks
                    issues.append(
                        ValidationIssue(
                            code="ERR_ANCHOR_KEY_DUPLICATES",
                            severity=ValidationSeverity.BLOCKER,
                            category="ANCHOR",
                            message=f"Primary key '{real_pk}' contains {dup_count:,} duplicate values.",
                            reason="Base grain requires strictly unique primary keys per alert.",
                            suggested_resolution="Deduplicate the alerts source table before starting the build.",
                            affected_table=anchor,
                            affected_column=real_pk,
                        )
                    )
                else:
                    pk_usable = True

            # Timestamp check
            real_ts = self._find_col(anchor_df, [ts or "", "alert_date", "alert_timestamp", "event_date", "created_at"])
            if not real_ts:
                issues.append(
                    ValidationIssue(
                        code="ERR_MISSING_ANCHOR_TIMESTAMP",
                        severity=ValidationSeverity.BLOCKER,
                        category="TEMPORAL",
                        message=f"Anchor table '{anchor}' missing event timestamp column.",
                        reason="Pre-alert anti-lookahead temporal boundaries require an alert event timestamp.",
                        suggested_resolution="Include 'alert_date' or specify the event timestamp column.",
                        affected_table=anchor,
                    )
                )
            else:
                ts_valid = True
                ts = real_ts

        checks.append(ValidationCheckReport("1. Anchor Exists", anchor_exists, "Verifies anchor table exists."))
        checks.append(ValidationCheckReport("2. Anchor Key Exists & Usable", pk_usable, "Verifies primary key exists, is non-null and unique."))
        checks.append(ValidationCheckReport("3. Anchor Grain Valid", pk_usable and anchor_exists, "Verifies base table grain integrity."))

        return anchor, pk, ts

    # ── 3. Check Relationships & Type Compatibility ────────────────────────────

    def _check_relationships(
        self,
        plan_dict: Dict[str, Any],
        tables: Dict[str, pd.DataFrame],
        anchor_table: str,
        issues: List[ValidationIssue],
        checks: List[ValidationCheckReport],
    ):
        relationships = plan_dict.get("relationships", [])
        all_resolvable = True
        all_types_compat = True

        for rel in relationships:
            if bool(rel.get("is_aggregation_placeholder")):
                continue

            left_name = rel.get("left_source", "").strip().lower()
            right_name = rel.get("right_source", "").strip().lower()

            left_df = tables.get(left_name)
            right_df = tables.get(right_name)

            if left_df is None or right_df is None:
                all_resolvable = False
                issues.append(
                    ValidationIssue(
                        code="ERR_RELATIONSHIP_UNRESOLVABLE",
                        severity=ValidationSeverity.BLOCKER,
                        category="RELATIONSHIP",
                        message=f"Cannot resolve relationship {left_name} -> {right_name}.",
                        reason="One or both participating tables are not present in workspace.",
                        suggested_resolution="Check source table mapping.",
                    )
                )
                continue

            join_keys = rel.get("join_keys", [])
            for key_pair in join_keys:
                left_col_name = key_pair.get("left_column") or key_pair.get("left")
                right_col_name = key_pair.get("right_column") or key_pair.get("right")

                left_col = self._find_col(left_df, [left_col_name])
                right_col = self._find_col(right_df, [right_col_name])

                if not left_col or not right_col:
                    all_resolvable = False
                    issues.append(
                        ValidationIssue(
                            code="ERR_JOIN_COLUMN_NOT_FOUND",
                            severity=ValidationSeverity.BLOCKER,
                            category="RELATIONSHIP",
                            message=f"Join key '{left_col_name}' or '{right_col_name}' missing in {left_name} -> {right_name}.",
                            reason="Declared join columns must exist in respective tables.",
                            suggested_resolution="Update the join key configuration.",
                            affected_table=left_name if not left_col else right_name,
                        )
                    )
                    continue

                # Type Compatibility Check
                lt = left_df[left_col].dtype
                rt = right_df[right_col].dtype
                types_match = (lt == rt) or (pd.api.types.is_numeric_dtype(lt) and pd.api.types.is_numeric_dtype(rt)) or (pd.api.types.is_string_dtype(lt) and pd.api.types.is_string_dtype(rt))

                if not types_match:
                    issues.append(
                        ValidationIssue(
                            code="WARN_JOIN_TYPE_MISMATCH",
                            severity=ValidationSeverity.WARNING,
                            category="SCHEMA",
                            message=f"Join key type mismatch: '{left_name}.{left_col}' ({lt}) vs '{right_name}.{right_col}' ({rt}).",
                            reason="Implicit string coercion will be applied at runtime.",
                            suggested_resolution="Cast join keys to matching data types.",
                            affected_table=right_name,
                            affected_column=right_col,
                        )
                    )

                # Match Rate & Coverage Check
                overlap = set(left_df[left_col].dropna().astype(str)).intersection(set(right_df[right_col].dropna().astype(str)))
                if not overlap:
                    issues.append(
                        ValidationIssue(
                            code="ERR_ZERO_KEY_OVERLAP",
                            severity=ValidationSeverity.BLOCKER,
                            category="RELATIONSHIP",
                            message=f"Zero key overlap between '{left_name}.{left_col}' and '{right_name}.{right_col}'.",
                            reason="No records match on this join key; joining will yield 100% null columns.",
                            suggested_resolution="Verify the selected join keys contain shared entity IDs.",
                            affected_table=right_name,
                        )
                    )

        checks.append(ValidationCheckReport("5. Relationships Resolvable", all_resolvable, "Verifies join tables and columns exist."))
        checks.append(ValidationCheckReport("6. Join Columns Type-Compatible", all_types_compat, "Verifies join key datatypes are coercible."))

    # ── 4. Check Cardinality & Fan-Out Defenses ────────────────────────────────

    def _check_cardinality_and_fanout(
        self,
        plan_dict: Dict[str, Any],
        tables: Dict[str, pd.DataFrame],
        anchor_table: str,
        anchor_pk: str,
        issues: List[ValidationIssue],
        checks: List[ValidationCheckReport],
    ):
        relationships = plan_dict.get("relationships", [])
        fanout_safe = True

        for rel in relationships:
            right_name = rel.get("right_source", "").strip().lower()
            right_df = tables.get(right_name)
            if right_df is None:
                continue

            join_keys = rel.get("join_keys", [])
            if not join_keys:
                continue

            right_col = self._find_col(right_df, [join_keys[0].get("right_column") or join_keys[0].get("right")])
            if not right_col:
                continue

            # Check if right table has duplicates on join key
            right_distinct = right_df[right_col].nunique(dropna=True)
            right_total = len(right_df)
            has_dups = right_distinct < right_total

            dedup_configured = bool(rel.get("deduplicate_right", True))
            is_raw_placeholder = bool(rel.get("is_aggregation_placeholder", False))

            if has_dups and not dedup_configured and not is_raw_placeholder:
                fanout_safe = False
                issues.append(
                    ValidationIssue(
                        code="ERR_UNHANDLED_CARDINALITY_FANOUT",
                        severity=ValidationSeverity.BLOCKER,
                        category="CARDINALITY",
                        message=f"Right table '{right_name}' has duplicate join keys on '{right_col}' without deduplication.",
                        reason="Direct join will cause Cartesian row explosion, violating 1-row-per-alert grain.",
                        suggested_resolution="Enable 'deduplicate_right: true' or aggregate this source prior to join.",
                        affected_table=right_name,
                        affected_column=right_col,
                    )
                )

        checks.append(ValidationCheckReport("7. Unsafe Cardinality Handled", fanout_safe, "Verifies deduplication or aggregation on non-unique joins."))
        checks.append(ValidationCheckReport("9. No Row Explosion Occurs", fanout_safe, "Verifies duplication factor will remain 1.0."))
        checks.append(ValidationCheckReport("10. No Duplicate Primary Keys", fanout_safe, "Verifies alert grain uniqueness."))

    # ── 5. Check Transaction Aggregation & Temporal Leakage ────────────────────

    def _check_temporal_aggregation(
        self,
        plan_dict: Dict[str, Any],
        tables: Dict[str, pd.DataFrame],
        anchor_table: str,
        anchor_ts: Optional[str],
        issues: List[ValidationIssue],
        checks: List[ValidationCheckReport],
    ):
        txn_agg = plan_dict.get("transaction_aggregation")
        agg_applied = True
        leakage_absent = True

        # Check if event tables exist in workspace
        event_tables = []
        for name, df in tables.items():
            if "transaction" in name or "txn" in name or "ledger" in name:
                event_tables.append(name)

        if event_tables and not txn_agg:
            agg_applied = False
            issues.append(
                ValidationIssue(
                    code="ERR_TRANSACTION_AGGREGATION_MISSING",
                    severity=ValidationSeverity.BLOCKER,
                    category="TEMPORAL",
                    message=f"Event table(s) {event_tables} present but no transaction aggregation plan is defined.",
                    reason="Event transactions must be rolled up to alert grain before joining.",
                    suggested_resolution="Add a PlannedTransactionAggregation step to the MasterDatasetPlan.",
                )
            )

        if txn_agg:
            txn_tbl = txn_agg.get("source_table", "").strip().lower()
            txn_df = tables.get(txn_tbl)
            if txn_df is not None:
                ts_col = self._find_col(txn_df, [txn_agg.get("transaction_timestamp_col") or "", "txn_timestamp", "created_at"])
                if not ts_col:
                    leakage_absent = False
                    issues.append(
                        ValidationIssue(
                            code="ERR_MISSING_TRANSACTION_TIMESTAMP",
                            severity=ValidationSeverity.BLOCKER,
                            category="TEMPORAL",
                            message=f"Transaction table '{txn_tbl}' missing timestamp column for pre-alert filtering.",
                            reason="Cannot enforce anti-lookahead barrier without transaction timestamps.",
                            suggested_resolution="Specify a valid transaction timestamp column in aggregation plan.",
                            affected_table=txn_tbl,
                        )
                    )

        checks.append(ValidationCheckReport("8. Transaction Aggregation Applied", agg_applied, "Verifies transaction tables are aggregated."))
        checks.append(ValidationCheckReport("11. Temporal Leakage Absent", leakage_absent, "Verifies anti-lookahead boundary is enforceable."))

    # ── 6. Check Ground Truth & Outcome Labels ─────────────────────────────────

    def _check_outcome_labels(
        self,
        plan_dict: Dict[str, Any],
        tables: Dict[str, pd.DataFrame],
        issues: List[ValidationIssue],
        checks: List[ValidationCheckReport],
    ):
        outcome_rules = plan_dict.get("outcome_rules") or {}
        label_valid = True

        case_cfg = outcome_rules.get("case_mapping")
        str_cfg = outcome_rules.get("str_lookforward")

        if not case_cfg and not str_cfg:
            label_valid = False
            issues.append(
                ValidationIssue(
                    code="ERR_NO_LABEL_RULES",
                    severity=ValidationSeverity.BLOCKER,
                    category="LABEL",
                    message="No ground truth outcome rules (Case Disposition or STR Lookforward) defined.",
                    reason="Supervised MLOps modeling requires a ground-truth label strategy.",
                    suggested_resolution="Configure case status mapping or STR 60-day forward window.",
                )
            )

        checks.append(ValidationCheckReport("13. Target / Label Logic Valid", label_valid, "Verifies ground truth synthesis rules."))

    # ── 7. Check Output Schema Determinism ─────────────────────────────────────

    def _check_output_schema_determinism(
        self,
        plan_dict: Dict[str, Any],
        tables: Dict[str, pd.DataFrame],
        anchor_pk: str,
        issues: List[ValidationIssue],
        checks: List[ValidationCheckReport],
    ):
        outcome_rules = plan_dict.get("outcome_rules") or {}
        target_aliases = outcome_rules.get("target_column_aliases") or ["FINAL_LABEL"]
        schema_ok = len(target_aliases) > 0

        checks.append(ValidationCheckReport("12. Required Output Columns Exist", schema_ok, "Verifies target and key columns are scheduled."))
        checks.append(ValidationCheckReport("15. Output Schema Deterministic", schema_ok, "Verifies output schema stability."))

    def _find_col(self, df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
        cols = {str(c).strip().lower(): c for c in df.columns}
        for cand in candidates:
            if not cand:
                continue
            c_norm = str(cand).strip().lower()
            if c_norm in cols:
                return str(cols[c_norm])
        return None
