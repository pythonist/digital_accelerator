"""
Master Dataset Intelligence Engine (AML / FCC MLOps)
=====================================================
Analyzes uploaded datasets, discovers candidate keys, models relationships,
detects cardinalities, assesses fan-out / leakage risks, and recommends safe
join & aggregation strategies for alert-level analytical master datasets.

Zero UI dependency. Pure domain intelligence.
"""

from __future__ import annotations

import logging
import math
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, Union

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ── Enums & Domain Types ───────────────────────────────────────────────────────

class SemanticType(str, Enum):
    IDENTIFIER = "IDENTIFIER"
    TIMESTAMP = "TIMESTAMP"
    CURRENCY_AMOUNT = "CURRENCY_AMOUNT"
    CATEGORICAL = "CATEGORICAL"
    NUMERIC_METRIC = "NUMERIC_METRIC"
    FLAG = "FLAG"
    FREE_TEXT = "FREE_TEXT"
    UNKNOWN = "UNKNOWN"


class TableRole(str, Enum):
    ANCHOR_ALERT = "ANCHOR_ALERT"
    ACCOUNT_PROFILE = "ACCOUNT_PROFILE"
    CUSTOMER_PROFILE = "CUSTOMER_PROFILE"
    TRANSACTION_EVENT = "TRANSACTION_EVENT"
    CASE_INVESTIGATION = "CASE_INVESTIGATION"
    STR_REGULATORY = "STR_REGULATORY"
    GENERIC_LOOKUP = "GENERIC_LOOKUP"
    UNKNOWN = "UNKNOWN"


class CardinalityType(str, Enum):
    ONE_TO_ONE = "ONE_TO_ONE"
    MANY_TO_ONE = "MANY_TO_ONE"
    ONE_TO_MANY = "ONE_TO_MANY"
    MANY_TO_MANY = "MANY_TO_MANY"


class RowImpact(str, Enum):
    ROW_PRESERVING = "ROW_PRESERVING"
    FAN_OUT = "FAN_OUT"
    ROW_REDUCING = "ROW_REDUCING"


class SafetyStatus(str, Enum):
    SAFE = "SAFE"
    REQUIRES_AGGREGATION = "REQUIRES_AGGREGATION"
    REQUIRES_DEDUPLICATION = "REQUIRES_DEDUPLICATION"
    UNSAFE_LEAKAGE = "UNSAFE_LEAKAGE"
    LOW_MATCH_RATE = "LOW_MATCH_RATE"
    UNSAFE_CARDINALITY = "UNSAFE_CARDINALITY"


# ── Data Classes ───────────────────────────────────────────────────────────────

@dataclass
class ColumnProfile:
    name: str
    data_type: str
    semantic_type: SemanticType
    null_count: int
    null_pct: float
    distinct_count: int
    uniqueness_ratio: float
    is_candidate_pk: bool
    is_candidate_fk: bool
    sample_values: List[Any] = field(default_factory=list)
    min_val: Optional[Any] = None
    max_val: Optional[Any] = None


@dataclass
class TableProfile:
    table_name: str
    dataset_role: TableRole
    row_count: int
    column_count: int
    primary_key_candidates: List[str]
    foreign_key_candidates: List[str]
    timestamp_columns: List[str]
    is_event_table: bool
    min_date: Optional[str] = None
    max_date: Optional[str] = None
    columns: Dict[str, ColumnProfile] = field(default_factory=dict)


@dataclass
class CandidateRelationship:
    source_table: str
    source_column: str
    target_table: str
    target_column: str
    match_rate: float
    source_uniqueness: float
    target_uniqueness: float
    cardinality: CardinalityType
    row_impact: RowImpact
    safety_status: SafetyStatus
    aggregation_required: bool
    confidence_score: float
    reason: str
    overlap_count: int
    source_distinct_count: int
    target_distinct_count: int


@dataclass
class LeakageRisk:
    table_name: str
    column_name: str
    risk_type: str
    severity: str  # "HIGH", "MEDIUM", "LOW"
    description: str
    recommendation: str


@dataclass
class IntelligenceReport:
    generated_at: str
    table_profiles: Dict[str, TableProfile]
    candidate_relationships: List[CandidateRelationship]
    recommended_anchor: Optional[str]
    leakage_risks: List[LeakageRisk]
    suggested_join_sequence: List[Dict[str, Any]]
    warnings: List[str]

    def to_dict(self) -> Dict[str, Any]:
        """Convert dataclass to JSON-serializable dictionary."""
        return {
            "generated_at": self.generated_at,
            "table_profiles": {
                k: {
                    **asdict(v),
                    "dataset_role": v.dataset_role.value,
                    "columns": {
                        col_name: {
                            **asdict(col_prof),
                            "semantic_type": col_prof.semantic_type.value,
                        }
                        for col_name, col_prof in v.columns.items()
                    },
                }
                for k, v in self.table_profiles.items()
            },
            "candidate_relationships": [
                {
                    **asdict(rel),
                    "cardinality": rel.cardinality.value,
                    "row_impact": rel.row_impact.value,
                    "safety_status": rel.safety_status.value,
                }
                for rel in self.candidate_relationships
            ],
            "recommended_anchor": self.recommended_anchor,
            "leakage_risks": [asdict(risk) for risk in self.leakage_risks],
            "suggested_join_sequence": self.suggested_join_sequence,
            "warnings": self.warnings,
        }


# ── Intelligence Engine ────────────────────────────────────────────────────────

class MasterDatasetIntelligenceEngine:
    """
    Analyzes schemas and datasets to derive keys, relationships, cardinalities,
    and fan-out safety guarantees for alert-grain analytical master datasets.
    """

    ID_PATTERNS = [
        r"^(id|.*_id|id_.*)$",
        r"^(alert_id|account_id|acct_id|customer_id|cust_id|transaction_id|txn_id|case_id|str_id|sar_id)$",
    ]

    TIMESTAMP_PATTERNS = [
        r".*(date|time|timestamp|created_at|updated_at|opened|closed|filed).*",
    ]

    CURRENCY_PATTERNS = [
        r".*(amount|amt|volume|vol|balance|turnover|credit|debit|limit|revenue).*",
    ]

    ROLE_PATTERNS = {
        TableRole.ANCHOR_ALERT: [r"alert.*", r".*alerts.*"],
        TableRole.ACCOUNT_PROFILE: [r"account.*", r".*accounts.*", r"acct.*"],
        TableRole.CUSTOMER_PROFILE: [r"customer.*", r".*customers.*", r"cust.*", r"entity.*", r"party.*"],
        TableRole.TRANSACTION_EVENT: [r"transaction.*", r".*transactions.*", r"txn.*", r"payments.*", r"ledger.*"],
        TableRole.CASE_INVESTIGATION: [r"case.*", r".*cases.*", r"investigation.*"],
        TableRole.STR_REGULATORY: [r"str.*", r"sar.*", r".*reports.*", r"regulatory.*"],
    }

    def __init__(self, sample_limit: int = 100000):
        self.sample_limit = sample_limit

    # ── 1. Schema Profiling & Semantic Classification ──────────────────────────

    def profile_dataset(self, name: str, df: pd.DataFrame) -> TableProfile:
        """Profiles a single dataset and extracts semantic column metadata."""
        row_count = len(df)
        col_profiles: Dict[str, ColumnProfile] = {}
        pk_candidates: List[str] = []
        fk_candidates: List[str] = []
        timestamp_cols: List[str] = []
        min_date: Optional[str] = None
        max_date: Optional[str] = None

        for col in df.columns:
            series = df[col]
            data_type = str(series.dtype)
            null_count = int(series.isna().sum())
            null_pct = float(null_count / max(row_count, 1) * 100.0)
            distinct_count = int(series.nunique(dropna=True))
            uniqueness_ratio = float(distinct_count / max(row_count - null_count, 1))

            col_lower = str(col).strip().lower()

            # Semantic classification
            semantic_type = self._classify_semantic_type(col_lower, series, uniqueness_ratio)

            is_candidate_pk = bool(
                uniqueness_ratio >= 0.999
                and null_count == 0
                and row_count > 0
                and self._matches_id_pattern(col_lower)
            )

            is_candidate_fk = bool(
                self._matches_id_pattern(col_lower)
                and not is_candidate_pk
            ) or (self._matches_id_pattern(col_lower) and distinct_count > 1)

            if is_candidate_pk:
                pk_candidates.append(col)
            if is_candidate_fk:
                fk_candidates.append(col)

            # Sample values & Min/Max
            sample_vals = series.dropna().head(5).tolist()
            sample_clean = [
                str(v) if isinstance(v, (datetime, pd.Timestamp)) else v
                for v in sample_vals
            ]

            min_val = None
            max_val = None
            if semantic_type == SemanticType.TIMESTAMP:
                timestamp_cols.append(col)
                try:
                    dt_series = pd.to_datetime(series, errors="coerce").dropna()
                    if not dt_series.empty:
                        min_dt = dt_series.min().isoformat()
                        max_dt = dt_series.max().isoformat()
                        min_val = min_dt
                        max_val = max_dt
                        if min_date is None or min_dt < min_date:
                            min_date = min_dt
                        if max_date is None or max_dt > max_date:
                            max_date = max_dt
                except Exception:
                    pass

            col_profiles[col] = ColumnProfile(
                name=col,
                data_type=data_type,
                semantic_type=semantic_type,
                null_count=null_count,
                null_pct=round(null_pct, 2),
                distinct_count=distinct_count,
                uniqueness_ratio=round(uniqueness_ratio, 4),
                is_candidate_pk=is_candidate_pk,
                is_candidate_fk=is_candidate_fk,
                sample_values=sample_clean,
                min_val=min_val,
                max_val=max_val,
            )

        # Detect table role & event nature
        role = self._detect_table_role(name, col_profiles, row_count)
        is_event_table = bool(
            role == TableRole.TRANSACTION_EVENT
            or (len(timestamp_cols) > 0 and len(pk_candidates) == 0 and row_count > 500)
        )

        return TableProfile(
            table_name=name,
            dataset_role=role,
            row_count=row_count,
            column_count=len(df.columns),
            primary_key_candidates=pk_candidates,
            foreign_key_candidates=fk_candidates,
            timestamp_columns=timestamp_cols,
            is_event_table=is_event_table,
            min_date=min_date,
            max_date=max_date,
            columns=col_profiles,
        )

    def _classify_semantic_type(self, col_lower: str, series: pd.Series, uniqueness: float) -> SemanticType:
        if self._matches_id_pattern(col_lower):
            return SemanticType.IDENTIFIER

        if any(re.match(p, col_lower) for p in self.TIMESTAMP_PATTERNS):
            return SemanticType.TIMESTAMP

        if any(re.match(p, col_lower) for p in self.CURRENCY_PATTERNS):
            return SemanticType.CURRENCY_AMOUNT

        if series.nunique() <= 2 and (col_lower.startswith("is_") or col_lower.endswith("_flag")):
            return SemanticType.FLAG

        if pd.api.types.is_numeric_dtype(series.dtype):
            return SemanticType.NUMERIC_METRIC

        if pd.api.types.is_string_dtype(series.dtype) or pd.api.types.is_object_dtype(series.dtype) or isinstance(series.dtype, pd.CategoricalDtype):
            if series.nunique() < 100:
                return SemanticType.CATEGORICAL
            return SemanticType.FREE_TEXT

        return SemanticType.UNKNOWN

    def _matches_id_pattern(self, col_lower: str) -> bool:
        return any(re.match(p, col_lower) for p in self.ID_PATTERNS)

    def _detect_table_role(self, table_name: str, col_profiles: Dict[str, ColumnProfile], row_count: int) -> TableRole:
        name_lower = table_name.lower()
        for role, patterns in self.ROLE_PATTERNS.items():
            if any(re.match(p, name_lower) for p in patterns):
                return role

        # Heuristic fallback by columns
        cols = set(col_profiles.keys())
        if "alert_id" in cols or "scenario_name" in cols:
            return TableRole.ANCHOR_ALERT
        if "account_id" in cols and ("account_type" in cols or "open_date" in cols):
            return TableRole.ACCOUNT_PROFILE
        if "customer_id" in cols and ("kyc_risk_rating" in cols or "pep_flag" in cols):
            return TableRole.CUSTOMER_PROFILE
        if "transaction_id" in cols or "txn_amount" in cols:
            return TableRole.TRANSACTION_EVENT
        if "case_id" in cols or "case_status" in cols:
            return TableRole.CASE_INVESTIGATION
        if "str_filed_date" in cols or "sar_filed_date" in cols:
            return TableRole.STR_REGULATORY

        return TableRole.UNKNOWN

    # ── 2. Relationship, Overlap & Cardinality Analysis ────────────────────────

    def analyze_relationships(
        self,
        tables: Dict[str, pd.DataFrame],
        profiles: Dict[str, TableProfile],
    ) -> List[CandidateRelationship]:
        """
        Inspects all table pairs and identifies candidate foreign key joins,
        calculating exact key overlap, cardinality, and safety metrics.
        """
        relationships: List[CandidateRelationship] = []

        table_names = list(tables.keys())
        for i, src_name in enumerate(table_names):
            for tgt_name in table_names:
                if src_name == tgt_name:
                    continue

                src_df = tables[src_name]
                tgt_df = tables[tgt_name]
                src_prof = profiles[src_name]
                tgt_prof = profiles[tgt_name]

                # Find candidate column match pairs
                candidate_pairs = self._find_candidate_join_pairs(src_prof, tgt_prof)

                for src_col, tgt_col in candidate_pairs:
                    rel = self._evaluate_relationship(
                        src_name=src_name,
                        src_col=src_col,
                        src_df=src_df,
                        src_prof=src_prof,
                        tgt_name=tgt_name,
                        tgt_col=tgt_col,
                        tgt_df=tgt_df,
                        tgt_prof=tgt_prof,
                    )
                    if rel is not None:
                        relationships.append(rel)

        # Sort by confidence descending
        relationships.sort(key=lambda r: r.confidence_score, reverse=True)
        return relationships

    def _find_candidate_join_pairs(self, src_prof: TableProfile, tgt_prof: TableProfile) -> List[Tuple[str, str]]:
        """Identifies column pairs with identical names or normalized semantic key aliases."""
        pairs: List[Tuple[str, str]] = []

        src_cols = src_prof.columns
        tgt_cols = tgt_prof.columns

        alias_groups = [
            {"account_id", "acct_id", "account_no", "account_number"},
            {"customer_id", "cust_id", "client_id", "party_id"},
            {"alert_id", "alert_number"},
            {"transaction_id", "txn_id"},
            {"case_id", "investigation_id"},
            {"str_id", "sar_id", "report_id"},
        ]

        for sc_name in src_cols:
            sc_norm = sc_name.strip().lower()
            for tc_name in tgt_cols:
                tc_norm = tc_name.strip().lower()

                # Exact match
                if sc_norm == tc_norm and (src_cols[sc_name].is_candidate_pk or src_cols[sc_name].is_candidate_fk or tgt_cols[tc_name].is_candidate_pk):
                    pairs.append((sc_name, tc_name))
                    continue

                # Alias group match
                for group in alias_groups:
                    if sc_norm in group and tc_norm in group:
                        pairs.append((sc_name, tc_name))
                        break

        return list(set(pairs))

    def _evaluate_relationship(
        self,
        src_name: str,
        src_col: str,
        src_df: pd.DataFrame,
        src_prof: TableProfile,
        tgt_name: str,
        tgt_col: str,
        tgt_df: pd.DataFrame,
        tgt_prof: TableProfile,
    ) -> Optional[CandidateRelationship]:
        """Calculates overlap, cardinality, and safety metrics for a specific column pair."""
        src_series = src_df[src_col].dropna()
        tgt_series = tgt_df[tgt_col].dropna()

        if src_series.empty or tgt_series.empty:
            return None

        src_set = set(src_series.astype(str).unique())
        tgt_set = set(tgt_series.astype(str).unique())

        overlap = src_set.intersection(tgt_set)
        overlap_count = len(overlap)

        if overlap_count == 0:
            return None

        match_rate = float(len(src_series[src_series.astype(str).isin(overlap)]) / max(len(src_df), 1) * 100.0)

        src_uniqueness = src_prof.columns[src_col].uniqueness_ratio
        tgt_uniqueness = tgt_prof.columns[tgt_col].uniqueness_ratio

        # Cardinality derivation
        is_src_unique = src_uniqueness >= 0.98
        is_tgt_unique = tgt_uniqueness >= 0.98

        if is_src_unique and is_tgt_unique:
            cardinality = CardinalityType.ONE_TO_ONE
            row_impact = RowImpact.ROW_PRESERVING
            safety_status = SafetyStatus.SAFE
            aggregation_required = False
            reason = f"Exact 1:1 key mapping between '{src_name}.{src_col}' and '{tgt_name}.{tgt_col}'."
        elif not is_src_unique and is_tgt_unique:
            cardinality = CardinalityType.MANY_TO_ONE
            row_impact = RowImpact.ROW_PRESERVING
            safety_status = SafetyStatus.SAFE
            aggregation_required = False
            reason = f"Safe lookup enrichment: Many rows in '{src_name}' map to unique entity in '{tgt_name}'."
        elif is_src_unique and not is_tgt_unique:
            cardinality = CardinalityType.ONE_TO_MANY
            row_impact = RowImpact.FAN_OUT
            aggregation_required = True
            safety_status = SafetyStatus.REQUIRES_AGGREGATION
            reason = (
                f"FAN-OUT HAZARD: 1 row in '{src_name}' matches multiple rows in '{tgt_name}'. "
                f"Requires pre-join temporal aggregation to preserve alert grain."
            )
        else:
            cardinality = CardinalityType.MANY_TO_MANY
            row_impact = RowImpact.FAN_OUT
            aggregation_required = True
            safety_status = SafetyStatus.UNSAFE_CARDINALITY
            reason = (
                f"CARTESIAN HAZARD: Both tables have duplicate values on join key. "
                f"Requires deduplication or aggregation prior to merge."
            )

        # Match rate penalty
        if match_rate < 50.0 and safety_status == SafetyStatus.SAFE:
            safety_status = SafetyStatus.LOW_MATCH_RATE
            reason += f" (Warning: Low join match rate {match_rate:.1f}%)"

        # Confidence calculation
        confidence = 0.5
        if src_col.lower() == tgt_col.lower():
            confidence += 0.25
        if match_rate >= 90.0:
            confidence += 0.20
        elif match_rate >= 70.0:
            confidence += 0.10
        if is_tgt_unique:
            confidence += 0.10

        confidence_score = round(min(1.0, confidence), 2)

        return CandidateRelationship(
            source_table=src_name,
            source_column=src_col,
            target_table=tgt_name,
            target_column=tgt_col,
            match_rate=round(match_rate, 2),
            source_uniqueness=round(src_uniqueness, 4),
            target_uniqueness=round(tgt_uniqueness, 4),
            cardinality=cardinality,
            row_impact=row_impact,
            safety_status=safety_status,
            aggregation_required=aggregation_required,
            confidence_score=confidence_score,
            reason=reason,
            overlap_count=overlap_count,
            source_distinct_count=len(src_set),
            target_distinct_count=len(tgt_set),
        )

    # ── 3. Data Leakage & Temporal Risk Detection ──────────────────────────────

    def detect_leakage_risks(
        self,
        tables: Dict[str, pd.DataFrame],
        profiles: Dict[str, TableProfile],
        relationships: List[CandidateRelationship],
    ) -> List[LeakageRisk]:
        """Scans schemas and relationships for temporal or ground-truth leakage hazards."""
        risks: List[LeakageRisk] = []

        # Find alert anchor table
        anchor_table = None
        for name, prof in profiles.items():
            if prof.dataset_role == TableRole.ANCHOR_ALERT:
                anchor_table = name
                break

        if not anchor_table:
            return risks

        anchor_prof = profiles[anchor_table]
        anchor_time_cols = anchor_prof.timestamp_columns

        # Check transaction event tables joined without lookback filter
        for name, prof in profiles.items():
            if prof.is_event_table and name != anchor_table:
                # Find relationships connecting anchor to this event table
                rels = [
                    r for r in relationships
                    if (r.source_table == anchor_table and r.target_table == name)
                    or (r.source_table == name and r.target_table == anchor_table)
                ]
                if rels:
                    risks.append(
                        LeakageRisk(
                            table_name=name,
                            column_name=",".join(prof.timestamp_columns) or "event_timestamp",
                            risk_type="TEMPORAL_LOOKAHEAD_LEAKAGE",
                            severity="HIGH",
                            description=(
                                f"Table '{name}' contains raw time-series events. Joining directly to '{anchor_table}' "
                                f"without enforcing `event_timestamp < alert_timestamp` will cause data leakage."
                            ),
                            recommendation="Apply strict pre-alert lookback window filtering before computing feature aggregates.",
                        )
                    )

        # Check for post-event outcome columns present in features
        suspicious_target_names = {"sar_filed", "is_sar", "sar_date", "case_outcome", "investigation_result"}
        for name, prof in profiles.items():
            if prof.dataset_role not in {TableRole.CASE_INVESTIGATION, TableRole.STR_REGULATORY}:
                for col in prof.columns:
                    if col.lower() in suspicious_target_names:
                        risks.append(
                            LeakageRisk(
                                table_name=name,
                                column_name=col,
                                risk_type="GROUND_TRUTH_LEAKAGE",
                                severity="HIGH",
                                description=(
                                    f"Column '{col}' in table '{name}' appears to contain post-investigation outcome labels. "
                                    f"Including it as a feature will cause target leakage."
                                ),
                                recommendation="Exclude this column from ML features or route it exclusively to ground truth labeling.",
                            )
                        )

        return risks

    # ── 4. Suggested Join Graph & Aggregation Plan ─────────────────────────────

    def generate_join_plan(
        self,
        profiles: Dict[str, TableProfile],
        relationships: List[CandidateRelationship],
    ) -> Tuple[Optional[str], List[Dict[str, Any]], List[str]]:
        """Synthesizes the optimal join plan and identifies required aggregations."""
        warnings: List[str] = []

        # Detect anchor table
        anchor = None
        for name, prof in profiles.items():
            if prof.dataset_role == TableRole.ANCHOR_ALERT:
                anchor = name
                break

        if not anchor:
            # Fallback to table with alert_id
            for name, prof in profiles.items():
                if "alert_id" in prof.columns:
                    anchor = name
                    break

        if not anchor:
            anchor = list(profiles.keys())[0] if profiles else None
            warnings.append("Could not find explicit 'alerts' anchor table. Using first available table as base grain.")

        join_sequence: List[Dict[str, Any]] = []
        if not anchor:
            return None, join_sequence, warnings

        # Build join sequence from anchor outward
        joined_tables: Set[str] = {anchor}

        # Step 1: Check for Cases
        for name, prof in profiles.items():
            if prof.dataset_role == TableRole.CASE_INVESTIGATION and name not in joined_tables:
                rel = self._find_best_rel(anchor, name, relationships)
                if rel:
                    join_sequence.append({
                        "step": len(join_sequence) + 1,
                        "source": name,
                        "join_type": "LEFT_OUTER",
                        "left_on": rel.source_column,
                        "right_on": rel.target_column,
                        "was_aggregated": False,
                        "reason": "Enrich alerts with case investigation ground truth.",
                    })
                    joined_tables.add(name)

        # Step 2: Check for Accounts
        for name, prof in profiles.items():
            if prof.dataset_role == TableRole.ACCOUNT_PROFILE and name not in joined_tables:
                rel = self._find_best_rel(anchor, name, relationships)
                if rel:
                    join_sequence.append({
                        "step": len(join_sequence) + 1,
                        "source": name,
                        "join_type": "LEFT_OUTER",
                        "left_on": rel.source_column,
                        "right_on": rel.target_column,
                        "was_aggregated": False,
                        "reason": "Enrich alerts with account profile attributes.",
                    })
                    joined_tables.add(name)

                    # Step 3: Customers joined via Accounts
                    for c_name, c_prof in profiles.items():
                        if c_prof.dataset_role == TableRole.CUSTOMER_PROFILE and c_name not in joined_tables:
                            c_rel = self._find_best_rel(name, c_name, relationships)
                            if c_rel:
                                join_sequence.append({
                                    "step": len(join_sequence) + 1,
                                    "source": c_name,
                                    "join_type": "LEFT_OUTER",
                                    "left_on": c_rel.source_column,
                                    "right_on": c_rel.target_column,
                                    "was_aggregated": False,
                                    "reason": "Enrich accounts with customer KYC risk profile.",
                                })
                                joined_tables.add(c_name)

        # Step 4: Check for Transactions (Requires Aggregation)
        for name, prof in profiles.items():
            if (prof.dataset_role == TableRole.TRANSACTION_EVENT or prof.is_event_table) and name not in joined_tables:
                join_sequence.append({
                    "step": len(join_sequence) + 1,
                    "source": f"{name}_agg",
                    "raw_source": name,
                    "join_type": "LEFT_OUTER",
                    "left_on": "alert_id",
                    "right_on": "alert_id",
                    "was_aggregated": True,
                    "reason": "Roll up pre-alert transactions over 7d, 30d, 90d, and 365d windows to prevent fan-out.",
                })
                joined_tables.add(name)

        return anchor, join_sequence, warnings

    def _find_best_rel(self, src: str, tgt: str, rels: List[CandidateRelationship]) -> Optional[CandidateRelationship]:
        matches = [
            r for r in rels
            if (r.source_table == src and r.target_table == tgt)
            or (r.source_table == tgt and r.target_table == src)
        ]
        if matches:
            return matches[0]
        return None

    # ── 5. Full Inspection Pipeline ───────────────────────────────────────────

    def inspect_workspace(self, datasets: Dict[str, pd.DataFrame]) -> IntelligenceReport:
        """Runs complete end-to-end intelligence inspection over all workspace datasets."""
        profiles: Dict[str, TableProfile] = {}
        for name, df in datasets.items():
            profiles[name] = self.profile_dataset(name, df)

        relationships = self.analyze_relationships(datasets, profiles)
        leakage_risks = self.detect_leakage_risks(datasets, profiles, relationships)
        anchor, join_plan, warnings = self.generate_join_plan(profiles, relationships)

        return IntelligenceReport(
            generated_at=datetime.utcnow().isoformat() + "Z",
            table_profiles=profiles,
            candidate_relationships=relationships,
            recommended_anchor=anchor,
            leakage_risks=leakage_risks,
            suggested_join_sequence=join_plan,
            warnings=warnings,
        )
