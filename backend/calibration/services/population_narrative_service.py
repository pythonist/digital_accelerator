# backend/calibration/services/population_narrative_service.py
"""
Population Narrative Service
Auto-generates human-readable explanations of population definition
"""
import json

class PopulationNarrativeService:
    """Generates audit-ready narratives"""
    
    @staticmethod
    def generate_narrative(scenario_name, filters, stats):
        """
        Generate Step 1 narrative for reporting
        """
        sections = []
        
        # Intro
        sections.append(f"This scenario evaluates {scenario_name.lower()}.")
        
        # Inclusions
        inclusions = []
        
        txn_filters = filters.get('transaction_filters', {})
        if txn_filters.get('transaction_category'):
            cats = ', '.join(txn_filters['transaction_category'])
            inclusions.append(f"transaction categories ({cats})")
        
        if txn_filters.get('transaction_direction'):
            dirs = ', '.join(txn_filters['transaction_direction']).lower()
            inclusions.append(f"{dirs} transactions")
        
        cust_filters = filters.get('customer_filters', {})
        if cust_filters.get('customer_risk_rating'):
            ratings = ', '.join(cust_filters['customer_risk_rating']).lower()
            inclusions.append(f"{ratings}-risk customers")
        
        acc_filters = filters.get('account_filters', {})
        if acc_filters.get('account_status'):
            status = ', '.join(acc_filters['account_status']).lower()
            inclusions.append(f"{status} accounts")
        
        if inclusions:
            sections.append(f"The population includes {', '.join(inclusions)}.")
        
        # Exclusions (inferred)
        exclusions = []
        
        if txn_filters.get('transaction_category'):
            all_cats = ['UPI', 'NEFT', 'IMPS', 'CHEQUE', 'RTGS']
            excluded = [c for c in all_cats if c not in txn_filters['transaction_category']]
            if excluded:
                exclusions.append(f"channels ({', '.join(excluded)})")
        
        if exclusions:
            sections.append(f"Excluded: {', '.join(exclusions)} as they fall outside the scope.")
        
        # Stats summary
        if stats:
            sections.append(
                f"This results in {stats.get('filtered_count', 0):,} transactions "
                f"across {stats.get('unique_accounts', 0):,} accounts."
            )
        
        return ' '.join(sections)
    
    @staticmethod
    def generate_filter_summary(filters):
        """Generate bullet-point filter summary"""
        summary = []
        
        txn = filters.get('transaction_filters', {})
        if txn.get('transaction_category'):
            summary.append(f"Transaction Category: {', '.join(txn['transaction_category'])}")
        if txn.get('transaction_direction'):
            summary.append(f"Direction: {', '.join(txn['transaction_direction'])}")
        if txn.get('min_amount'):
            summary.append(f"Min Amount: ₹{float(txn['min_amount']):,.0f}")
        if txn.get('max_amount'):
            summary.append(f"Max Amount: ₹{float(txn['max_amount']):,.0f}")
        
        cust = filters.get('customer_filters', {})
        if cust.get('customer_risk_rating'):
            summary.append(f"Risk Rating: {', '.join(cust['customer_risk_rating'])}")
        if cust.get('pep_flag'):
            summary.append(f"PEP Filter: {cust['pep_flag']}")
        
        acc = filters.get('account_filters', {})
        if acc.get('account_status'):
            summary.append(f"Account Status: {', '.join(acc['account_status'])}")
        
        return summary