from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class BehaviourReconstructionMeta:
    behavior_run_id: int
    entity_level: str
    metric_name: str
    aggregation_level: str
    lookback_days: int
    transaction_type: str


@dataclass
class BehaviourReconstructionResult:
    meta: BehaviourReconstructionMeta
    raw_transactions: List[Dict[str, Any]]
    filter_summary: Dict[str, Any]
    aggregated_rows: List[Dict[str, Any]]
    lookback_window: Dict[str, Optional[str]]
    included_rows: List[Any]
    excluded_rows: List[Any]
    formula: Dict[str, Any]
    integrity: Dict[str, Any]

