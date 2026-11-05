"""
Master Dataset Planner (AML / FCC MLOps)
========================================
Consumes intelligence profiles, candidate relationships, and the Master Dataset
Contract to synthesize a canonical, fully validated MasterDatasetPlan.

The Planner strictly evaluates relationship cardinality against the declared
anchor grain (1 row per alert) to guarantee:
- Zero Cartesian fan-out
- Zero temporal look-ahead leakage
- Strict pre-alert transaction behavioral feature vector generation
- Ground-truth outcome reconciliation (Case disposition + 60-day STR forward link)
- Complete human-readable explanation and machine-readable plan payload

Zero UI coupling. Pure analytical planning engine.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple

import pandas as pd

from api.tools.mlops.master_dataset_intelligence import (
    CandidateRelationship,
    CardinalityType,
    IntelligenceReport,
    LeakageRisk,
    MasterDatasetIntelligenceEngine,
    RowImpact,
    SafetyStatus,
    SemanticType,
    TableProfile,
    TableRole,
)

logger = logging.getLogger(__name__)


# ── Domain Plan Schemas ────────────────────────────────────────────────────────

class JoinType(str, Enum):
    LEFT_OUTER = "LEFT_OUTER"
    INNER = "INNER"
    RIGHT_OUTER = "RIGHT_OUTER"


class JoinSafety(str, Enum):
    SAFE_ENRICHMENT = "SAFE_ENRICHMENT"
    REQUIRES_AGGREGATION = "REQUIRES_AGGREGATION"
    REQUIRES_DEDUPLICATION = "REQUIRES_DEDUPLICATION"
    UNSAFE_FANOUT = "UNSAFE_FANOUT"
    UNSAFE_LEAKAGE = "UNSAFE_LEAKAGE"
    LOW_MATCH_RATE = "LOW_MATCH_RATE"


@dataclass
class TargetGrain:
    entity_name: str
    primary_key: str
    event_timestamp_column: Optional[str]
    description: str = "1 row per alert decision"


@dataclass
class PlanSource:
    role: str
    table_name: str
    dataset_id: Optional[int] = None
    row_count: int = 0
    column_count: int = 0
    primary_key: Optional[str] = None
    timestamp_column: Optional[str] = None


@dataclass
class KeyMapping:
    left_column: str
    right_column: str


@dataclass
class PlannedRelationship:
    id: str
    left_source: str
    right_source: str
    join_type: JoinType
    join_keys: List[KeyMapping]
    cardinality: CardinalityType
    safety_status: JoinSafety
    row_impact: RowImpact
    match_rate: float
    deduplicate_right: bool
    is_aggregation_placeholder: bool
    explanation: str


@dataclass
class TemporalLookbackWindow:
    name: str
    lookback_days: Optional[int]
    description: str


@dataclass
class AggregatedMetricDefinition:
    name: str
    expression: str
    category: str
    fill_na: Any
    description: str


@dataclass
class PlannedTransactionAggregation:
    id: str
    source_table: str
    anchor_link_source: str
    anchor_join_key: str
    account_join_key: str
    temporal_barrier_expression: str
    transaction_timestamp_col: str
    alert_timestamp_col: str
    windows: List[TemporalLookbackWindow]
    metrics: List[AggregatedMetricDefinition]
    total_metrics_count: int
    fanout_prevention_guarantee: str


@dataclass
class CaseDispositionMapping:
    source_column: str
    positive_values: List[str]
    negative_values: List[str]
    unlabeled_values: List[str]


@dataclass
class STRLookforwardConfig:
    enabled: bool
    source_table: str
    account_key: str
    str_date_col: str
    alert_date_col: str
    window_days: int
    fanout_resolution_rule: str


@dataclass
class PlannedOutcomeRules:
    strategy_name: str
    case_mapping: Optional[CaseDispositionMapping]
    str_lookforward: Optional[STRLookforwardConfig]
    target_column_aliases: List[str]
    filter_unlabeled: bool
    explanation: str


@dataclass
class PlannedTransformation:
    type: str
    column: str
    value: Any
    reason: str


@dataclass
class ValidationBlocker:
    code: str
    severity: str  # "BLOCKER", "WARNING"
    message: str
    recommendation: str


@dataclass
class UserDecisionRequired:
    id: str
    title: str
    description: str
    options: List[Dict[str, Any]]
    default_value: Any


@dataclass
class MasterDatasetPlan:
    plan_id: str
    plan_version: str
    name: str
    description: str
    target_grain: TargetGrain
    sources: List[PlanSource]
    relationships: List[PlannedRelationship]
    transaction_aggregation: Optional[PlannedTransactionAggregation]
    outcome_rules: PlannedOutcomeRules
    transformations: List[PlannedTransformation]
    excluded_identifier_columns: List[str]
    validation_blockers: List[ValidationBlocker]
    required_user_decisions: List[UserDecisionRequired]
    system_recommendations: List[str]
    human_readable_summary: str
    generated_at: str

    def to_dict(self) -> Dict[str, Any]:
        """Converts plan dataclass into a JSON-serializable dictionary."""
        return {
            "plan_id": self.plan_id,
            "plan_version": self.plan_version,
            "name": self.name,
            "description": self.description,
            "target_grain": asdict(self.target_grain),
            "sources": [asdict(s) for s in self.sources],
            "relationships": [
                {
                    **asdict(r),
                    "join_type": r.join_type.value,
                    "cardinality": r.cardinality.value,
                    "safety_status": r.safety_status.value,
                    "row_impact": r.row_impact.value,
                }
                for r in self.relationships
            ],
            "transaction_aggregation": asdict(self.transaction_aggregation) if self.transaction_aggregation else None,
            "outcome_rules": asdict(self.outcome_rules),
            "transformations": [asdict(t) for t in self.transformations],
            "excluded_identifier_columns": self.excluded_identifier_columns,
            "validation_blockers": [asdict(b) for b in self.validation_blockers],
            "required_user_decisions": [asdict(d) for d in self.required_user_decisions],
            "system_recommendations": self.system_recommendations,
            "human_readable_summary": self.human_readable_summary,
            "generated_at": self.generated_at,
        }


# ── Planner Engine ─────────────────────────────────────────────────────────────

class MasterDatasetPlanner:
    """
    Synthesizes intelligence inspection results into a formal MasterDatasetPlan.
    """

    STANDARD_METRIC_SPECS = [
        # Horizon volume & counts
        ("vol", "SUM(txn_amount)", "VOLUME", 0.0, "Total transaction volume in time window"),
        ("cnt", "COUNT(transaction_id)", "COUNT", 0, "Total transaction count in time window"),
        ("avg_amt", "AVG(txn_amount)", "AVERAGE", 0.0, "Average transaction amount in time window"),
        ("max_amt", "MAX(txn_amount)", "EXTREME", 0.0, "Maximum transaction amount in time window"),
        ("std_amt", "STDDEV(txn_amount)", "DISPERSION", 0.0, "Standard deviation of transaction amount"),
        # Typology counts
        ("cash_cnt", "SUM(CASE WHEN txn_type IN ('CASH', 'CASH_DEPOSIT', 'CASH_WITHDRAWAL') THEN 1 ELSE 0 END)", "TYPOLOGY", 0, "Cash transaction count"),
        ("swift_cnt", "SUM(CASE WHEN txn_type = 'SWIFT' THEN 1 ELSE 0 END)", "TYPOLOGY", 0, "SWIFT wire transaction count"),
        ("hr_dest_cnt", "SUM(CASE WHEN is_high_risk_dest = 1 THEN 1 ELSE 0 END)", "JURISDICTION", 0, "Count of txns to high risk destinations"),
        ("fatf_dest_cnt", "SUM(CASE WHEN is_fatf_dest = 1 THEN 1 ELSE 0 END)", "JURISDICTION", 0, "Count of txns to FATF grey/black listed countries"),
        # Operational timing
        ("offhour_cnt", "SUM(CASE WHEN is_off_hours = 1 THEN 1 ELSE 0 END)", "TIMING", 0, "Transactions outside 08:00 - 20:00"),
        ("weekend_cnt", "SUM(CASE WHEN is_weekend = 1 THEN 1 ELSE 0 END)", "TIMING", 0, "Transactions on Saturday/Sunday"),
        # Inflow / Outflow
        ("credit_vol", "SUM(CASE WHEN txn_direction IN ('CREDIT','CR','IN') THEN txn_amount ELSE 0 END)", "FLOW", 0.0, "Total incoming credit volume"),
        ("debit_vol", "SUM(CASE WHEN txn_direction IN ('DEBIT','DR','OUT') THEN txn_amount ELSE 0 END)", "FLOW", 0.0, "Total outgoing debit volume"),
    ]

    def create_plan(
        self,
        report: IntelligenceReport,
        plan_name: str = "AML Alert Suppression Master Dataset Plan",
        plan_id: Optional[str] = None,
        custom_overrides: Optional[Dict[str, Any]] = None,
    ) -> MasterDatasetPlan:
        """Generates the master dataset plan from the intelligence report."""
        overrides = custom_overrides or {}
        p_id = plan_id or f"plan_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"

        # 1. Determine Target Grain & Anchor Table
        anchor_table, anchor_pk, anchor_timestamp, grain_blockers = self._determine_anchor_grain(report, overrides)

        # 2. Extract Sources
        sources = self._extract_sources(report)

        # 3. Categorize & Plan Relationships
        planned_rels, rel_blockers, user_decisions = self._plan_relationships(report, anchor_table, overrides)

        # 4. Plan Transaction Aggregation Strategy
        txn_agg, txn_blockers = self._plan_transaction_aggregation(report, anchor_table, anchor_timestamp, overrides)

        # 5. Plan Ground Truth Outcome Strategy
        outcome_rules, outcome_blockers = self._plan_outcome_rules(report, anchor_table, anchor_timestamp, overrides)

        # 6. Plan Transformations & Excluded Identifiers
        transformations, excluded_ids = self._plan_transformations_and_exclusions(report, anchor_table)

        # 7. Collect All Validation Blockers & Warnings
        all_blockers = grain_blockers + rel_blockers + txn_blockers + outcome_blockers

        # 8. Synthesize Recommendations & Human Readable Narrative
        recommendations = self._synthesize_recommendations(report, planned_rels, txn_agg, outcome_rules)
        narrative = self._generate_human_readable_summary(
            anchor_table=anchor_table,
            anchor_pk=anchor_pk,
            sources=sources,
            planned_rels=planned_rels,
            txn_agg=txn_agg,
            outcome_rules=outcome_rules,
            blockers=all_blockers,
        )

        return MasterDatasetPlan(
            plan_id=p_id,
            plan_version="2.0.0",
            name=plan_name,
            description="Declarative data-building plan enforcing alert grain, pre-alert transaction aggregation, and ground-truth label synthesis.",
            target_grain=TargetGrain(
                entity_name=anchor_table,
                primary_key=anchor_pk,
                event_timestamp_column=anchor_timestamp,
                description=f"1 row per {anchor_table} record (Alert Decision Grain)",
            ),
            sources=sources,
            relationships=planned_rels,
            transaction_aggregation=txn_agg,
            outcome_rules=outcome_rules,
            transformations=transformations,
            excluded_identifier_columns=excluded_ids,
            validation_blockers=all_blockers,
            required_user_decisions=user_decisions,
            system_recommendations=recommendations,
            human_readable_summary=narrative,
            generated_at=datetime.utcnow().isoformat() + "Z",
        )

    # ── 1. Target Grain Determination ──────────────────────────────────────────

    def _determine_anchor_grain(
        self,
        report: IntelligenceReport,
        overrides: Dict[str, Any],
    ) -> Tuple[str, str, Optional[str], List[ValidationBlocker]]:
        blockers: List[ValidationBlocker] = []
        anchor = overrides.get("base_dataset_type") or report.recommended_anchor

        if not anchor or anchor not in report.table_profiles:
            # Fallback
            for name, prof in report.table_profiles.items():
                if prof.dataset_role == TableRole.ANCHOR_ALERT:
                    anchor = name
                    break
            if not anchor and report.table_profiles:
                anchor = list(report.table_profiles.keys())[0]

        if not anchor:
            blockers.append(
                ValidationBlocker(
                    code="NO_ANCHOR_TABLE",
                    severity="BLOCKER",
                    message="No anchor table could be detected or selected in workspace.",
                    recommendation="Upload an 'alerts' table containing alert_id and account_id.",
                )
            )
            return "alerts", "alert_id", None, blockers

        prof = report.table_profiles[anchor]
        pk_candidates = prof.primary_key_candidates
        anchor_pk = pk_candidates[0] if pk_candidates else "alert_id"
        if not pk_candidates:
            # Check for alert_id column
            for col in prof.columns:
                if "alert_id" in col.lower():
                    anchor_pk = col
                    break

        anchor_timestamp = prof.timestamp_columns[0] if prof.timestamp_columns else None
        if not anchor_timestamp:
            for col in prof.columns:
                if any(k in col.lower() for k in ["date", "time", "created"]):
                    anchor_timestamp = col
                    break

        if prof.dataset_role != TableRole.ANCHOR_ALERT:
            blockers.append(
                ValidationBlocker(
                    code="NON_STANDARD_ANCHOR_GRAIN",
                    severity="WARNING",
                    message=f"Selected anchor table '{anchor}' is not an 'alerts' table. Master grain will be '{anchor}'.",
                    recommendation="For AML False Positive Suppression, use 'alerts' as anchor table.",
                )
            )

        if not anchor_timestamp:
            blockers.append(
                ValidationBlocker(
                    code="MISSING_ANCHOR_TIMESTAMP",
                    severity="BLOCKER",
                    message=f"Anchor table '{anchor}' does not have a parseable timestamp column.",
                    recommendation="Ensure the alerts table includes 'alert_date' or 'created_at' to prevent temporal leakage.",
                )
            )

        return anchor, anchor_pk, anchor_timestamp, blockers

    # ── 2. Source Extraction ───────────────────────────────────────────────────

    def _extract_sources(self, report: IntelligenceReport) -> List[PlanSource]:
        sources: List[PlanSource] = []
        for name, prof in report.table_profiles.items():
            pk = prof.primary_key_candidates[0] if prof.primary_key_candidates else None
            ts = prof.timestamp_columns[0] if prof.timestamp_columns else None
            sources.append(
                PlanSource(
                    role=prof.dataset_role.value,
                    table_name=name,
                    row_count=prof.row_count,
                    column_count=prof.column_count,
                    primary_key=pk,
                    timestamp_column=ts,
                )
            )
        return sources

    # ── 3. Relationship Planning ───────────────────────────────────────────────

    def _plan_relationships(
        self,
        report: IntelligenceReport,
        anchor_table: str,
        overrides: Dict[str, Any],
    ) -> Tuple[List[PlannedRelationship], List[ValidationBlocker], List[UserDecisionRequired]]:
        planned_rels: List[PlannedRelationship] = []
        blockers: List[ValidationBlocker] = []
        user_decisions: List[UserDecisionRequired] = []

        joined_tables: Set[str] = {anchor_table}
        profiles = report.table_profiles

        # Find best candidate relationships from intelligence report
        rels_by_pair: Dict[Tuple[str, str], CandidateRelationship] = {}
        for r in report.candidate_relationships:
            pair = (r.source_table, r.target_table)
            if pair not in rels_by_pair or r.confidence_score > rels_by_pair[pair].confidence_score:
                rels_by_pair[pair] = r

        # 3.1. Plan Cases Join (Anchor -> Cases)
        case_tables = [n for n, p in profiles.items() if p.dataset_role == TableRole.CASE_INVESTIGATION]
        for c_table in case_tables:
            rel = self._get_best_bidirectional_rel(anchor_table, c_table, rels_by_pair)
            if rel:
                planned_rels.append(
                    PlannedRelationship(
                        id=f"rel_{anchor_table}_to_{c_table}",
                        left_source=anchor_table,
                        right_source=c_table,
                        join_type=JoinType.LEFT_OUTER,
                        join_keys=[KeyMapping(rel.source_column, rel.target_column)],
                        cardinality=rel.cardinality,
                        safety_status=JoinSafety.SAFE_ENRICHMENT,
                        row_impact=RowImpact.ROW_PRESERVING,
                        match_rate=rel.match_rate,
                        deduplicate_right=True,
                        is_aggregation_placeholder=False,
                        explanation=f"Enriches alerts with case disposition outcomes. Match rate: {rel.match_rate:.1f}%. Deduplicated on {rel.target_column}.",
                    )
                )
                joined_tables.add(c_table)

        # 3.2. Plan Accounts Join (Anchor -> Accounts)
        acct_tables = [n for n, p in profiles.items() if p.dataset_role == TableRole.ACCOUNT_PROFILE]
        for a_table in acct_tables:
            rel = self._get_best_bidirectional_rel(anchor_table, a_table, rels_by_pair)
            if rel:
                is_safe = rel.cardinality in {CardinalityType.ONE_TO_ONE, CardinalityType.MANY_TO_ONE}
                safety = JoinSafety.SAFE_ENRICHMENT if is_safe else JoinSafety.UNSAFE_FANOUT
                planned_rels.append(
                    PlannedRelationship(
                        id=f"rel_{anchor_table}_to_{a_table}",
                        left_source=anchor_table,
                        right_source=a_table,
                        join_type=JoinType.LEFT_OUTER,
                        join_keys=[KeyMapping(rel.source_column, rel.target_column)],
                        cardinality=rel.cardinality,
                        safety_status=safety,
                        row_impact=RowImpact.ROW_PRESERVING,
                        match_rate=rel.match_rate,
                        deduplicate_right=True,
                        is_aggregation_placeholder=False,
                        explanation=f"Enriches alerts with account KYC attributes. Match rate: {rel.match_rate:.1f}%. Safe N:1 entity lookup.",
                    )
                )
                joined_tables.add(a_table)

                # 3.3. Plan Customers Join (Accounts -> Customers)
                cust_tables = [n for n, p in profiles.items() if p.dataset_role == TableRole.CUSTOMER_PROFILE]
                for cust_table in cust_tables:
                    c_rel = self._get_best_bidirectional_rel(a_table, cust_table, rels_by_pair)
                    if c_rel:
                        planned_rels.append(
                            PlannedRelationship(
                                id=f"rel_{a_table}_to_{cust_table}",
                                left_source=a_table,
                                right_source=cust_table,
                                join_type=JoinType.LEFT_OUTER,
                                join_keys=[KeyMapping(c_rel.source_column, c_rel.target_column)],
                                cardinality=c_rel.cardinality,
                                safety_status=JoinSafety.SAFE_ENRICHMENT,
                                row_impact=RowImpact.ROW_PRESERVING,
                                match_rate=c_rel.match_rate,
                                deduplicate_right=True,
                                is_aggregation_placeholder=False,
                                explanation=f"Enriches accounts with customer beneficial ownership & KYC risk profile. Match rate: {c_rel.match_rate:.1f}%.",
                            )
                        )
                        joined_tables.add(cust_table)

        # 3.4. Flag Unsafe Direct Event Joins
        event_tables = [n for n, p in profiles.items() if p.is_event_table or p.dataset_role == TableRole.TRANSACTION_EVENT]
        for e_table in event_tables:
            rel = self._get_best_bidirectional_rel(anchor_table, e_table, rels_by_pair)
            if rel and rel.cardinality in {CardinalityType.ONE_TO_MANY, CardinalityType.MANY_TO_MANY}:
                planned_rels.append(
                    PlannedRelationship(
                        id=f"rel_{anchor_table}_to_{e_table}_raw",
                        left_source=anchor_table,
                        right_source=e_table,
                        join_type=JoinType.LEFT_OUTER,
                        join_keys=[KeyMapping(rel.source_column, rel.target_column)],
                        cardinality=rel.cardinality,
                        safety_status=JoinSafety.REQUIRES_AGGREGATION,
                        row_impact=RowImpact.FAN_OUT,
                        match_rate=rel.match_rate,
                        deduplicate_right=False,
                        is_aggregation_placeholder=True,
                        explanation=(
                            f"DIRECT JOIN BLOCKED: 1 alert maps to multiple transactions in '{e_table}' ({rel.cardinality.value}). "
                            f"Direct join would cause Cartesian explosion. Transaction Aggregation step must be used instead."
                        ),
                    )
                )

        return planned_rels, blockers, user_decisions

    def _get_best_bidirectional_rel(
        self,
        tbl1: str,
        tbl2: str,
        rels: Dict[Tuple[str, str], CandidateRelationship],
    ) -> Optional[CandidateRelationship]:
        if (tbl1, tbl2) in rels:
            return rels[(tbl1, tbl2)]
        if (tbl2, tbl1) in rels:
            # Flip
            r = rels[(tbl2, tbl1)]
            return CandidateRelationship(
                source_table=tbl1,
                source_column=r.target_column,
                target_table=tbl2,
                target_column=r.source_column,
                match_rate=r.match_rate,
                source_uniqueness=r.target_uniqueness,
                target_uniqueness=r.source_uniqueness,
                cardinality=r.cardinality,
                row_impact=r.row_impact,
                safety_status=r.safety_status,
                aggregation_required=r.aggregation_required,
                confidence_score=r.confidence_score,
                reason=r.reason,
                overlap_count=r.overlap_count,
                source_distinct_count=r.target_distinct_count,
                target_distinct_count=r.source_distinct_count,
            )
        return None

    # ── 4. Transaction Aggregation Planning ────────────────────────────────────

    def _plan_transaction_aggregation(
        self,
        report: IntelligenceReport,
        anchor_table: str,
        anchor_timestamp: Optional[str],
        overrides: Dict[str, Any],
    ) -> Tuple[Optional[PlannedTransactionAggregation], List[ValidationBlocker]]:
        blockers: List[ValidationBlocker] = []
        profiles = report.table_profiles

        txn_table = None
        for name, prof in profiles.items():
            if prof.dataset_role == TableRole.TRANSACTION_EVENT or prof.is_event_table:
                txn_table = name
                break

        if not txn_table:
            return None, blockers

        txn_prof = profiles[txn_table]
        txn_ts = txn_prof.timestamp_columns[0] if txn_prof.timestamp_columns else "txn_timestamp"
        alert_ts = anchor_timestamp or "alert_date"

        # Determine account key
        acct_col = "account_id"
        for col in txn_prof.columns:
            if any(k in col.lower() for k in ["account_id", "acct_id", "account"]):
                acct_col = col
                break

        windows = [
            TemporalLookbackWindow("w7", 7, "7-day immediate burst velocity"),
            TemporalLookbackWindow("w30", 30, "30-day monthly behavioral baseline"),
            TemporalLookbackWindow("w90", 90, "90-day quarterly structuring window"),
            TemporalLookbackWindow("w365", 365, "365-day annual long-term baseline"),
            TemporalLookbackWindow("all", None, "Lifetime historical statistics"),
        ]

        metrics: List[AggregatedMetricDefinition] = []
        for suffix, expr, cat, fill, desc in self.STANDARD_METRIC_SPECS:
            for w in windows:
                if w.name == "all" and suffix in {"vol", "cnt", "avg_amt", "max_amt", "std_amt"}:
                    metrics.append(
                        AggregatedMetricDefinition(
                            name=f"total_txn_{suffix}" if suffix in {"vol"} else f"{suffix}_txn",
                            expression=expr,
                            category=cat,
                            fill_na=fill,
                            description=f"{desc} (all time)",
                        )
                    )
                elif w.name != "all":
                    metrics.append(
                        AggregatedMetricDefinition(
                            name=f"{w.name}_{suffix}",
                            expression=expr,
                            category=cat,
                            fill_na=fill,
                            description=f"{desc} ({w.name})",
                        )
                    )

        # Derived Typology and Velocity ratios
        derived_specs = [
            ("velocity_ratio", "max_txn_amount / (avg_txn_amount + 1.0)", "VELOCITY", 0.0, "Peak to average velocity multiplier"),
            ("vol_spike_30_vs_90", "w30_vol / (w90_vol + 1.0)", "SPIKE", 0.0, "30-day volume surge relative to 90-day baseline"),
            ("cnt_spike_30_vs_90", "w30_cnt / (w90_cnt + 1.0)", "SPIKE", 0.0, "30-day transaction count surge relative to 90-day baseline"),
            ("vol_spike_7_vs_30", "w7_vol / (w30_vol + 1.0)", "SPIKE", 0.0, "7-day burst volume relative to 30-day baseline"),
            ("pct_just_below_10k", "structuring_txn_cnt / (w90_cnt + 1.0) * 100.0", "STRUCTURING", 0.0, "Percentage of transactions in $8k-$10k smurfing band"),
            ("counterparty_hhi", "SUM(square(share)) over 30d", "CONCENTRATION", 0.0, "Herfindahl-Hirschman index of 30-day beneficiary concentration"),
            ("layering_score", "swift_cnt_30d * unique_dest_30d", "LAYERING", 0.0, "Cross-border rapid disbursement layering index"),
            ("pass_through_ratio_30d", "MIN(credit_vol, debit_vol) / (MAX(credit_vol, debit_vol) + 1.0)", "FLOW", 0.0, "30-day rapid in-and-out pass-through ratio"),
            ("cash_intensity_30d", "w30_cash_cnt / (w30_cnt + 1.0) * 100.0", "CASH", 0.0, "30-day cash deposit and withdrawal intensity"),
        ]
        for name, expr, cat, fill, desc in derived_specs:
            metrics.append(
                AggregatedMetricDefinition(
                    name=name,
                    expression=expr,
                    category=cat,
                    fill_na=fill,
                    description=desc,
                )
            )

        planned_agg = PlannedTransactionAggregation(
            id="agg_pre_alert_txns",
            source_table=txn_table,
            anchor_link_source=anchor_table,
            anchor_join_key="alert_id",
            account_join_key=acct_col,
            temporal_barrier_expression=f"{txn_table}.{txn_ts} < {anchor_table}.{alert_ts}",
            transaction_timestamp_col=txn_ts,
            alert_timestamp_col=alert_ts,
            windows=windows,
            metrics=metrics,
            total_metrics_count=len(metrics),
            fanout_prevention_guarantee="Transactions are grouped strictly by alert_id prior to merging, guaranteeing 1 vector per alert.",
        )

        return planned_agg, blockers

    # ── 5. Ground Truth Outcome Planning ───────────────────────────────────────

    def _plan_outcome_rules(
        self,
        report: IntelligenceReport,
        anchor_table: str,
        anchor_timestamp: Optional[str],
        overrides: Dict[str, Any],
    ) -> Tuple[PlannedOutcomeRules, List[ValidationBlocker]]:
        blockers: List[ValidationBlocker] = []
        profiles = report.table_profiles

        # Check for Cases Table
        case_table = None
        for name, prof in profiles.items():
            if prof.dataset_role == TableRole.CASE_INVESTIGATION:
                case_table = name
                break

        # Check for STR Table
        str_table = None
        for name, prof in profiles.items():
            if prof.dataset_role == TableRole.STR_REGULATORY:
                str_table = name
                break

        case_mapping = None
        if case_table:
            case_prof = profiles[case_table]
            status_col = "case_status"
            for col in case_prof.columns:
                if "status" in col.lower():
                    status_col = col
                    break

            case_mapping = CaseDispositionMapping(
                source_column=status_col,
                positive_values=["CLOSED_SAR_FILED", "SAR_FILED", "SAR FILED", "TRUE_POSITIVE"],
                negative_values=["CLOSED_FALSE_POSITIVE", "FALSE_POSITIVE", "CLOSED_MONITORING", "MONITORING"],
                unlabeled_values=["OPEN", "IN_REVIEW", "PENDING", "ESCALATED", "UNKNOWN"],
            )

        str_config = None
        if str_table:
            str_prof = profiles[str_table]
            str_date = str_prof.timestamp_columns[0] if str_prof.timestamp_columns else "str_filed_date"
            acct_key = "account_id"
            for col in str_prof.columns:
                if any(k in col.lower() for k in ["account_id", "acct_id", "acct"]):
                    acct_key = col
                    break

            str_config = STRLookforwardConfig(
                enabled=True,
                source_table=str_table,
                account_key=acct_key,
                str_date_col=str_date,
                alert_date_col=anchor_timestamp or "alert_date",
                window_days=60,
                fanout_resolution_rule="Assign TP_FROM_STR=1 strictly to the single alert closest before STR filing on the same account.",
            )

        if not case_mapping and not str_config:
            blockers.append(
                ValidationBlocker(
                    code="NO_LABEL_SOURCES_FOUND",
                    severity="BLOCKER",
                    message="Neither a 'cases' nor an 'str' table was detected. Ground truth labels cannot be derived.",
                    recommendation="Upload a cases table with case_status or an STR report table.",
                )
            )

        strategy_name = (
            "str_lookforward_with_case_fallback" if (str_config and case_mapping)
            else ("str_lookforward_only" if str_config else "case_status_disposition_only")
        )

        explanation = (
            "Ground truth target FINAL_LABEL is derived by evaluating: "
            "1. Positive if an STR was filed within 60 days post-alert (closest alert per account). "
            "2. Positive if Case Status indicates SAR_FILED / TRUE_POSITIVE. "
            "3. Negative (0) if Case Status indicates FALSE_POSITIVE / MONITORING. "
            "4. Unlabeled / open alerts are automatically excluded from the final training frame."
        )

        outcome_rules = PlannedOutcomeRules(
            strategy_name=strategy_name,
            case_mapping=case_mapping,
            str_lookforward=str_config,
            target_column_aliases=["FINAL_LABEL", "IS_TRUE_POS", "str_label"],
            filter_unlabeled=True,
            explanation=explanation,
        )

        return outcome_rules, blockers

    # ── 6. Transformations & Excluded Columns ──────────────────────────────────

    def _plan_transformations_and_exclusions(
        self,
        report: IntelligenceReport,
        anchor_table: str,
    ) -> Tuple[List[PlannedTransformation], List[str]]:
        transformations: List[PlannedTransformation] = [
            PlannedTransformation("IMPUTE_DEFAULT", "case_id", "NO_CASE", "Assign 'NO_CASE' to un-escalated alerts"),
            PlannedTransformation("IMPUTE_DEFAULT", "priority", "NONE", "Assign 'NONE' priority to un-escalated alerts"),
            PlannedTransformation("IMPUTE_DEFAULT", "resolution_days", 0, "Default 0 resolution days for non-investigated alerts"),
        ]

        excluded_ids = [
            "alert_id",
            "case_id",
            "account_id",
            "customer_id",
            "transaction_id",
            "str_id",
            "investigator_id",
        ]

        # Scan for any other identifier columns across all profiles
        for prof in report.table_profiles.values():
            for col_name, col_prof in prof.columns.items():
                if col_prof.semantic_type == SemanticType.IDENTIFIER and col_name.lower() not in excluded_ids:
                    excluded_ids.append(col_name)

        return transformations, sorted(list(set(excluded_ids)))

    # ── 7. Recommendations & Narrative ─────────────────────────────────────────

    def _synthesize_recommendations(
        self,
        report: IntelligenceReport,
        planned_rels: List[PlannedRelationship],
        txn_agg: Optional[PlannedTransactionAggregation],
        outcome_rules: PlannedOutcomeRules,
    ) -> List[str]:
        recs = [
            "Maintain alert grain invariant (1 row = 1 alert) as the non-negotiable target anchor.",
            "Pre-aggregate all transaction events prior to join to prevent Cartesian fan-out.",
            "Enforce strict temporal boundary (TXN_TIMESTAMP < ALERT_DATE) to guarantee zero look-ahead leakage.",
        ]
        if outcome_rules.str_lookforward and outcome_rules.str_lookforward.enabled:
            recs.append("Utilize 60-day STR forward window with closest-alert attribution to capture true positive outcomes.")
        if outcome_rules.filter_unlabeled:
            recs.append("Exclude unresolved / in-review alerts to train models strictly on verified ground truth.")

        return recs

    def _generate_human_readable_summary(
        self,
        anchor_table: str,
        anchor_pk: str,
        sources: List[PlanSource],
        planned_rels: List[PlannedRelationship],
        txn_agg: Optional[PlannedTransactionAggregation],
        outcome_rules: PlannedOutcomeRules,
        blockers: List[ValidationBlocker],
    ) -> str:
        lines: List[str] = [
            f"# Master Dataset Plan: AML Alert Suppression",
            f"**Anchor Grain:** `{anchor_table}` (1 row per {anchor_pk})",
            f"**Total Source Tables:** {len(sources)} ({', '.join(s.table_name for s in sources)})",
            "",
            "## 1. Relational Graph & Safety Evaluation",
        ]

        for r in planned_rels:
            keys_str = " AND ".join(f"{k.left_column} = {k.right_column}" for k in r.join_keys)
            status_tag = "[SAFE]" if r.safety_status == JoinSafety.SAFE_ENRICHMENT else ("[AGGREGATION_REQUIRED]" if r.safety_status == JoinSafety.REQUIRES_AGGREGATION else "[UNSAFE]")
            lines.append(f"- {status_tag} **{r.left_source} -> {r.right_source}** (Join: `{r.join_type.value}`, On: `{keys_str}`)")
            lines.append(f"  - Cardinality: `{r.cardinality.value}` | Match Rate: `{r.match_rate:.1f}%` | Safety: `{r.safety_status.value}`")
            lines.append(f"  - *{r.explanation}*")

        if txn_agg:
            lines.extend([
                "",
                "## 2. Transaction Temporal Feature Aggregation",
                f"- **Source Table:** `{txn_agg.source_table}` (Grouped strictly by `{txn_agg.anchor_join_key}`)",
                f"- **Anti-Leakage Barrier:** `{txn_agg.temporal_barrier_expression}`",
                f"- **Lookback Windows:** 7 days, 30 days, 90 days, 365 days, Lifetime",
                f"- **Total Generated Metrics:** {txn_agg.total_metrics_count} domain features (volume, velocity, structuring, cash intensity, FATF concentration, layering)",
                f"- **Fan-Out Guarantee:** {txn_agg.fanout_prevention_guarantee}",
            ])

        lines.extend([
            "",
            "## 3. Ground Truth Outcome & Label Synthesis",
            f"- **Strategy:** `{outcome_rules.strategy_name}`",
            f"- **Target Columns:** `{', '.join(outcome_rules.target_column_aliases)}`",
            f"- *{outcome_rules.explanation}*",
        ])

        if blockers:
            lines.extend([
                "",
                "## 4. Validation Issues & Blockers",
            ])
            for b in blockers:
                tag = "[BLOCKER]" if b.severity == "BLOCKER" else "[WARNING]"
                lines.append(f"- {tag} **{b.code}**: {b.message}")
                lines.append(f"  - Recommendation: *{b.recommendation}*")
        else:
            lines.extend([
                "",
                "## 4. Validation Status",
                "[OK] Plan is structurally sound, leak-free, and ready for execution.",
            ])

        return "\n".join(lines)
