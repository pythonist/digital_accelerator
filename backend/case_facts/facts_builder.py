"""
Case Facts Builder - Deterministic Logic Engine
backend/case_facts/facts_builder.py
"""

from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import sqlite3
import os
import dateutil.parser

from .facts_schema import (
    CaseFacts, RiskLevel, RiskDriver, TransactionPattern, 
    NetworkSummary, SimilarCase, PlaybookMatch, PolicyReference
)

from services.db_schema import DatabaseManager

async def build_case_facts(
    case_id: str,
    env_id: str,
    tenant_id: str,
    db_manager: DatabaseManager
) -> CaseFacts:
    """
    Main entry point - builds complete case facts using deterministic logic.
    """
    
    # 1. Resolve Database Path
    db_path = None
    if hasattr(db_manager, 'get_env_db_path'):
        db_path = db_manager.get_env_db_path(env_id)
    
    if not db_path:
        possible_paths = [
            f"data/environments/{env_id}/database.db",
            f"../data/environments/{env_id}/database.db",
            f"data/environments/{env_id}/investigation.db",
            f"../data/environments/{env_id}/investigation.db",
            f"data/{tenant_id}/{env_id}/database.db",
            f"../data/{tenant_id}/{env_id}/database.db",
            f"backend/data/environments/{env_id}/database.db",
            f"data/aml_database.db",
            f"../data/aml_database.db"
        ]
        for path in possible_paths:
            if os.path.exists(path):
                db_path = path
                break
    
    if not db_path:
        db_path = db_manager.db_path

    # 2. Connect
    conn = db_manager.connect(db_path)
    if not conn:
        raise ValueError(f"Could not connect to database for environment {env_id}")
    
    cursor = conn.cursor()
    
    try:
        # 3. Deterministic Fact Gathering
        
        # A. Find the Transaction Table & Columns First (Crucial for dates)
        txn_info = _resolve_transaction_table(cursor)
        
        # B. Determine "Anchor Date" (The 'Now' for this specific case)
        # If data is from 2023, we want metrics relative to 2023, not 2026.
        anchor_date = _get_case_anchor_date(case_id, cursor, txn_info)
        print(f"Anchor Date for {case_id}: {anchor_date}")

        # C. Fetch Case Metadata
        case_meta = _fetch_case_metadata(case_id, cursor, anchor_date)
        
        # D. Compute Patterns (Using Anchor Date)
        patterns = _compute_patterns(case_id, cursor, txn_info, anchor_date)
        
        # E. Extract Risk Drivers
        risk_data = _extract_risk_drivers(case_id, cursor, case_meta, patterns)
        
        # F. Calculate Score
        overall_risk = _calculate_overall_risk(
            risk_data['drivers'],
            patterns,
            case_meta
        )
        
        # G. Network Summary
        network = _build_minimal_network(case_id, cursor, txn_info)
        
        # 4. Construct Final Object
        case_facts = CaseFacts(
            case_id=case_id,
            env_id=env_id,
            tenant_id=tenant_id,
            
            # Metadata
            alert_type=case_meta['alert_type'],
            alert_date=case_meta['alert_date'],
            customer_id=case_meta['customer_id'],
            customer_name=case_meta.get('customer_name', 'Unknown'),
            customer_risk_rating=case_meta['risk_rating'],
            
            # Analysis
            risk_drivers=risk_data['drivers'],
            overall_risk_score=overall_risk,
            
            patterns_7d=patterns['7d'],
            patterns_30d=patterns['30d'],
            patterns_all=patterns['all'],
            
            network=network,
            
            # Placeholders
            similar_cases=[], 
            playbook_matches=[],  
            policy_references=[],  
            
            # Context
            rules_triggered=risk_data.get('rules_triggered', []),
            typologies_detected=risk_data.get('typologies_detected', []),
            previous_alerts_count=case_meta.get('prev_alerts', 0),
            previous_sars_count=case_meta.get('prev_sars', 0),
            
            # Flags
            requires_escalation=overall_risk > 75,
            requires_manual_review=True
        )
        
        return case_facts
        
    finally:
        db_manager.close_connection(conn)


# --- Helper Functions ---

def _resolve_transaction_table(cursor):
    """Finds the best matching transaction table and columns."""
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cursor.fetchall()]
    
    # Priority list for table names
    candidates = ['transactions', 'transaction', 'txns', 'trans', 'txn_log']
    txn_table = None
    
    # 1. Exact or partial match
    for cand in candidates:
        match = next((t for t in tables if cand in t.lower()), None)
        if match:
            txn_table = match
            break
            
    if not txn_table:
        return None

    # 2. Get Columns
    cursor.execute(f"PRAGMA table_info({txn_table})")
    cols = {c[1].lower(): c[1] for c in cursor.fetchall()}
    
    # 3. Smart Column Mapping
    date_candidates = [cols[k] for k in cols if ('txn_timestamp' in k or k in ['timestamp'])] + [
        cols[k] for k in cols if any(x in k for x in ['date', 'time', 'created', 'dt'])
    ]
    date_col = next((c for c in date_candidates if c), None)
    return {
        'table': txn_table,
        'case_col': next((cols[k] for k in cols if k in ['case_id', 'caseid', 'case_no', 'case']), None),
        'amt_col': next((cols[k] for k in cols if any(x in k for x in ['amount', 'amt', 'vol', 'value'])), None),
        'date_col': date_col
    }

def _get_case_anchor_date(case_id, cursor, txn_info):
    """Finds the LATEST transaction date for this case to use as 'Now'."""
    if not txn_info or not txn_info['date_col'] or not txn_info['case_col']:
        return datetime.now()

    try:
        query = f"SELECT MAX({txn_info['date_col']}) FROM {txn_info['table']} WHERE {txn_info['case_col']} = ?"
        cursor.execute(query, (case_id,))
        res = cursor.fetchone()
        if res and res[0]:
            return _parse_date(res[0])
    except Exception as e:
        print(f"Warning: Error finding anchor date: {e}")
    
    return datetime.now()

def _fetch_case_metadata(case_id: str, cursor, anchor_date: datetime) -> Dict[str, Any]:
    """Fetch basic case info, using anchor_date as fallback for alert_date."""
    
    try:
        cursor.execute("PRAGMA table_info(cases)")
        columns = [c[1] for c in cursor.fetchall()]
    except Exception:
        return _default_metadata(case_id, anchor_date)
    
    if not columns:
        return _default_metadata(case_id, anchor_date)
    
    col_map = {c.lower(): c for c in columns}
    
    # Robust ID finding
    case_col = next((c for c in columns if 'case' in c.lower() and 'id' in c.lower()), None)
    if not case_col: return _default_metadata(case_id, anchor_date)

    def get_col(key_candidates):
        for k in key_candidates:
            if k in col_map: return f'c.{col_map[k]}'
        return "NULL"

    def parse_int(value):
        try:
            if value is None or str(value).strip() == "":
                return 0
            return int(float(value))
        except Exception:
            return 0

    query = f"""
    SELECT 
        c.{case_col} as case_id,
        {get_col(['alert_type', 'alerttype', 'type'])} as alert_type,
        {get_col(['alert_date', 'alertdate', 'date', 'created_at'])} as alert_date,
        {get_col(['customer_id', 'customerid'])} as customer_id,
        {get_col(['customer_name', 'customername'])} as customer_name,
        {get_col(['customer_risk_rating', 'risk_rating', 'risk_level', 'risk'])} as risk_rating,
        {get_col(['prior_alerts_count', 'previous_alerts_count', 'prev_alerts'])} as prev_alerts,
        {get_col(['prior_case_count', 'previous_sars_count', 'prev_sars', 'linked_cases_count'])} as prev_sars
    FROM cases c
    WHERE c.{case_col} = ?
    """
    
    cursor.execute(query, (case_id,))
    row = cursor.fetchone()
    
    if not row:
        return _default_metadata(case_id, anchor_date)
    
    row_dict = {}
    for idx, col in enumerate(cursor.description):
        row_dict[col[0]] = row[idx]
    
    return {
        'alert_type': row_dict.get('alert_type') or 'Manual Review',
        'alert_date': _parse_date(row_dict.get('alert_date')) or anchor_date,
        'customer_id': row_dict.get('customer_id') or 'Unspecified',
        'customer_name': row_dict.get('customer_name') or 'Unknown Entity',
        'risk_rating': _parse_risk_level(row_dict.get('risk_rating')),
        'prev_alerts': parse_int(row_dict.get('prev_alerts')),
        'prev_sars': parse_int(row_dict.get('prev_sars'))
    }

def _default_metadata(case_id, anchor_date):
    return {
        'alert_type': 'Manual Investigation',
        'alert_date': anchor_date,
        'customer_id': 'Unknown',
        'customer_name': 'Unknown',
        'risk_rating': RiskLevel.MEDIUM,
        'prev_alerts': 0,
        'prev_sars': 0
    }

def _compute_patterns(case_id: str, cursor, txn_info, anchor_date: datetime) -> Dict[str, TransactionPattern]:
    """Compute patterns relative to the Anchor Date."""
    
    if not txn_info or not txn_info['case_col'] or not txn_info['amt_col']:
        return _empty_patterns_dict()
    
    patterns = {}
    
    # We calculate based on the CASE'S timeline, not real-world time
    for period, days in [('7d', 7), ('30d', 30), ('all', 999999)]:
        
        # Dynamic Query Construction
        query_parts = [
            f"COUNT(*) as count",
            f"COALESCE(SUM({txn_info['amt_col']}), 0) as volume",
            f"COALESCE(AVG({txn_info['amt_col']}), 0) as avg_amt",
            f"COALESCE(MAX({txn_info['amt_col']}), 0) as max_amt",
            f"COALESCE(MIN({txn_info['amt_col']}), 0) as min_amt"
        ]
        
        query = f"SELECT {', '.join(query_parts)} FROM {txn_info['table']} WHERE {txn_info['case_col']} = ?"
        params = [case_id]

        # Time travel logic: Look back from the Anchor Date
        if days < 999999 and txn_info['date_col']:
            cutoff = anchor_date - timedelta(days=days)
            # We want transactions BETWEEN cutoff and anchor_date
            query += f" AND {txn_info['date_col']} >= ? AND {txn_info['date_col']} <= ?"
            params.append(cutoff.isoformat())
            params.append(anchor_date.isoformat())
        
        cursor.execute(query, params)
        row = cursor.fetchone()
        
        if row:
            count = row[0] or 0
            volume = float(row[1] or 0)
            avg_amt = float(row[2] or 0)
            
            cash_ratio = 0.0
            # Rough cash heuristic (looking for 'cash' in any column) if possible
            # For now, simplistic calculation to avoid complex dynamic SQL
            if count > 0 and volume > 0:
                 # If AVG amount is round number, increase risk
                 if avg_amt % 100 == 0: cash_ratio = 0.4
            
            patterns[period] = TransactionPattern(
                period=period,
                total_count=count,
                total_volume=volume,
                currency="USD",
                avg_amount=avg_amt,
                median_amount=float(row[3] or 0), # Using Max as proxy for median in summary
                cash_ratio=cash_ratio,
                round_amount_ratio=0.0,
                transactions_per_day=count / (days if days < 999 else 1),
                peak_hour=None,
                weekend_ratio=0.0,
                unique_counterparties=0,
                unique_beneficiaries=0,
                unique_geolocations=0,
                below_threshold_count=0,
                rapid_sequence_count=0,
                circular_flow_detected=False
            )
        else:
            patterns[period] = _empty_pattern(period)
    
    return patterns

def _empty_patterns_dict():
    return {p: _empty_pattern(p) for p in ['7d', '30d', 'all']}

def _extract_risk_drivers(case_id: str, cursor, case_meta: Dict, patterns: Dict) -> Dict:
    drivers = []
    rules_triggered = []
    
    # 1. Volume Driver
    vol_30 = patterns['30d'].total_volume
    if vol_30 > 50000:
        drivers.append(RiskDriver(
            factor="High Monthly Volume",
            severity=RiskLevel.HIGH if vol_30 > 150000 else RiskLevel.MEDIUM,
            value=vol_30,
            threshold=50000,
            explanation=f"30-day volume of ${vol_30:,.2f} is significant",
            source="pattern_engine"
        ))
    elif vol_30 > 10000:
         drivers.append(RiskDriver(
            factor="Moderate Transaction Volume",
            severity=RiskLevel.LOW,
            value=vol_30,
            threshold=10000,
            explanation=f"Active account with ${vol_30:,.2f} volume",
            source="pattern_engine"
        ))

    # 2. Velocity Driver
    cnt_7 = patterns['7d'].total_count
    if cnt_7 > 10:
        drivers.append(RiskDriver(
            factor="High Transaction Velocity",
            severity=RiskLevel.HIGH,
            value=cnt_7,
            threshold=10,
            explanation=f"{cnt_7} transactions in the last 7 days of activity",
            source="pattern_engine"
        ))

    # 3. Risk Rating Driver
    if case_meta['risk_rating'] in [RiskLevel.HIGH, RiskLevel.CRITICAL]:
        drivers.append(RiskDriver(
            factor="High Risk Customer Entity",
            severity=case_meta['risk_rating'],
            value=case_meta['risk_rating'].value,
            threshold=None,
            explanation=f"Entity flagged as {case_meta['risk_rating'].value} risk",
            source="kyc"
        ))

    return {
        'drivers': drivers,
        'rules_triggered': rules_triggered,
        'typologies_detected': []
    }

def _calculate_overall_risk(risk_drivers: List[RiskDriver], patterns: Dict, case_meta: Dict) -> float:
    
    score = 0
    
    # 1. Base Score from Rating
    base_scores = {RiskLevel.LOW: 10, RiskLevel.MEDIUM: 30, RiskLevel.HIGH: 60, RiskLevel.CRITICAL: 90}
    score += base_scores.get(case_meta['risk_rating'], 20)
    
    # 2. Volume Adder
    vol = patterns['30d'].total_volume
    if vol > 100000: score += 25
    elif vol > 50000: score += 15
    elif vol > 10000: score += 5
    
    # 3. Velocity Adder
    if patterns['7d'].total_count > 10: score += 15
    
    # 4. Driver Adder
    score += len(risk_drivers) * 5
    
    return min(100, score)

def _build_minimal_network(case_id: str, cursor, txn_info) -> NetworkSummary:
    if not txn_info or not txn_info['case_col']:
        return _empty_network()
        
    try:
        cursor.execute(f"SELECT COUNT(*) FROM {txn_info['table']} WHERE {txn_info['case_col']} = ?", (case_id,))
        edge_count = cursor.fetchone()[0] or 0
        node_count = max(2, int(edge_count * 0.6))
        
        return NetworkSummary(
            total_nodes=node_count,
            total_edges=edge_count,
            density=0.5, # Placeholder
            central_nodes=[], high_risk_nodes=[], circular_flows=0, 
            layering_depth=1, cross_border_hops=0, isolated_clusters=0, suspicious_clusters=[]
        )
    except:
        return _empty_network()

# --- Utility ---

def _severity_to_score(severity: RiskLevel) -> float:
    return {RiskLevel.LOW: 5, RiskLevel.MEDIUM: 15, RiskLevel.HIGH: 25, RiskLevel.CRITICAL: 35}.get(severity, 10)

def _parse_date(date_str):
    if not date_str: return None
    if isinstance(date_str, datetime): return date_str
    try:
        return dateutil.parser.parse(str(date_str))
    except:
        return None

def _parse_risk_level(risk_str) -> RiskLevel:
    if isinstance(risk_str, RiskLevel): return risk_str
    risk_map = {'low': RiskLevel.LOW, 'medium': RiskLevel.MEDIUM, 'high': RiskLevel.HIGH, 'critical': RiskLevel.CRITICAL}
    return risk_map.get(str(risk_str).lower(), RiskLevel.MEDIUM)

def _empty_pattern(period: str) -> TransactionPattern:
    return TransactionPattern(
        period=period, total_count=0, total_volume=0.0, currency='USD',
        avg_amount=0.0, median_amount=0.0, cash_ratio=0.0, round_amount_ratio=0.0,
        transactions_per_day=0.0, peak_hour=None, weekend_ratio=0.0,
        unique_counterparties=0, unique_beneficiaries=0, unique_geolocations=0,
        below_threshold_count=0, rapid_sequence_count=0, circular_flow_detected=False
    )

def _empty_network() -> NetworkSummary:
    return NetworkSummary(
        total_nodes=0, total_edges=0, density=0.0, central_nodes=[],
        high_risk_nodes=[], circular_flows=0, layering_depth=0,
        cross_border_hops=0, isolated_clusters=0, suspicious_clusters=[]
    )
