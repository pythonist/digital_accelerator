"""
Case Facts Schema - Integrated with your existing DB structure
backend/case_facts/facts_schema.py
"""

from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
from datetime import datetime
from enum import Enum


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class RiskDriver(BaseModel):
    """Individual risk factor from rule engine or typology detector"""
    factor: str
    severity: RiskLevel
    value: Any
    threshold: Optional[Any] = None
    explanation: str
    source: str  # "rule_engine", "typology_detector", "graph_analysis"


class TransactionPattern(BaseModel):
    """Aggregated transaction statistics - computed from your DB"""
    period: str  # "7d", "30d", "all"
    total_count: int
    total_volume: float
    currency: str = "USD"
    
    # Behavioral metrics
    avg_amount: float
    median_amount: float
    cash_ratio: float
    round_amount_ratio: float
    
    # Temporal patterns
    transactions_per_day: float
    peak_hour: Optional[int] = None
    weekend_ratio: float
    
    # Network metrics
    unique_counterparties: int
    unique_beneficiaries: int
    unique_geolocations: int
    
    # Red flags
    below_threshold_count: int
    rapid_sequence_count: int
    circular_flow_detected: bool


class NetworkNode(BaseModel):
    """Entity in the transaction network"""
    entity_id: str
    entity_type: str  # "customer", "beneficiary", "intermediary"
    name: Optional[str] = None
    total_volume: float
    transaction_count: int
    risk_score: Optional[float] = None


class NetworkSummary(BaseModel):
    """Graph-based network analysis from graph_builder"""
    total_nodes: int
    total_edges: int
    density: float
    
    # Key entities
    central_nodes: List[NetworkNode]
    high_risk_nodes: List[NetworkNode]
    
    # Patterns
    circular_flows: int
    layering_depth: int
    cross_border_hops: int
    
    # Clusters
    isolated_clusters: int
    suspicious_clusters: List[Dict[str, Any]]


class SimilarCase(BaseModel):
    """Feature-based similar case (replaces FAISS for cases)"""
    case_id: str
    similarity_score: float  # 0.0 to 1.0
    outcome: str  # "SAR_filed", "closed_no_action", "escalated"
    matched_features: List[str]
    key_differences: List[str]
    
    # Compact summary
    alert_type: str
    investigation_date: datetime
    final_decision: str


class PlaybookMatch(BaseModel):
    """AML Playbook match result"""
    playbook_name: str
    confidence: float
    matched_conditions: List[str]
    missing_conditions: List[str]
    regulatory_reference: Optional[str] = None
    investigation_hints: List[str]


class PolicyReference(BaseModel):
    """Relevant policy or regulatory reference from doc_rag"""
    doc_title: str
    section: str
    relevance_score: float
    snippet: str


class CaseFacts(BaseModel):
    """
    Complete case facts package - deterministic, auditable, LLM-free
    This is what the LLM Copilot receives (and ONLY this)
    """
    
    # Metadata
    case_id: str
    env_id: str
    tenant_id: str
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    
    # Alert basics (from your cases table)
    alert_type: str
    alert_date: datetime
    customer_id: str
    customer_name: Optional[str] = None
    customer_risk_rating: RiskLevel
    
    # Core analysis (deterministic)
    risk_drivers: List[RiskDriver]
    overall_risk_score: float  # 0-100
    
    # Transaction analysis (from your transactions table)
    patterns_7d: TransactionPattern
    patterns_30d: TransactionPattern
    patterns_all: TransactionPattern
    
    # Network analysis (from graph_builder)
    network: NetworkSummary
    
    # Contextual intelligence
    similar_cases: List[SimilarCase]
    playbook_matches: List[PlaybookMatch]
    
    # Regulatory context (from doc_rag - this is OK to use)
    policy_references: List[PolicyReference]
    
    # Investigation context
    rules_triggered: List[str]
    typologies_detected: List[str]
    previous_alerts_count: int
    previous_sars_count: int
    
    # Flags
    requires_sar: Optional[bool] = None
    requires_escalation: bool = False
    requires_manual_review: bool = True


class CopilotRequest(BaseModel):
    """Request to LLM Copilot - always includes full facts"""
    case_facts: CaseFacts
    action: str  # "draft_summary", "explain_risk", "map_guidelines", etc.
    user_question: Optional[str] = None
    context: Optional[Dict[str, Any]] = None


class CopilotResponse(BaseModel):
    """LLM Copilot response - narrative only"""
    action: str
    narrative: str
    suggestions: Optional[List[str]] = None
    guideline_mappings: Optional[List[str]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)