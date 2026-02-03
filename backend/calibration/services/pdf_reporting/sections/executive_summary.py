# backend/calibration/services/pdf_reporting/sections/executive_summary.py
"""
Executive Summary - Clean PwC Style
NO "AI Explanation" labels - just clean insights
"""
from reportlab.platypus import Spacer, Paragraph
from reportlab.lib.units import inch
from ..styles import ReportTheme
from ..components import create_metric_card_table, create_ai_explanation_box

def build_executive_summary(data, ai_service=None):
    """Generate executive summary"""
    elements = []
    styles = ReportTheme.get_styles()
    
    # Header
    elements.append(Paragraph("EXECUTIVE SUMMARY", styles['SectionHeader']))
    elements.append(Paragraph(
        "This report documents a data-driven threshold calibration for the specified AML scenario. "
        "The methodology ensures regulatory compliance, operational feasibility, and audit defensibility.",
        styles['BodyText']
    ))
    elements.append(Spacer(1, 0.25*inch))
    
    # Clean insights (no "AI" label)
    if ai_service:
        ai_summary = ai_service.generate_executive_summary(data)
        if ai_summary:
            elements.append(Paragraph("<b>Key Findings:</b>", styles['SubsectionHeader']))
            ai_box = create_ai_explanation_box(ai_summary)
            if ai_box:
                elements.append(ai_box)
            elements.append(Spacer(1, 0.2*inch))
    
    # Key Metrics Dashboard
    threshold_data = data.get('threshold_analysis', {})
    agg_data = data.get('aggregation_analysis', {})
    foundation_data = data.get('data_foundation', {})
    
    metrics = [
        {
            'label': 'Recommended Threshold',
            'value': f"₹{threshold_data.get('selected_threshold', 0):,.0f}",
            'color': ReportTheme.PWC_ORANGE.hexval()
        },
        {
            'label': 'Percentile Rank',
            'value': f"{threshold_data.get('selected_percentile', 0)}th",
            'color': ReportTheme.PWC_DARK_GREY.hexval()
        },
        {
            'label': 'Coverage',
            'value': f"Top {100 - threshold_data.get('selected_percentile', 0)}%",
            'color': ReportTheme.PWC_DARK_GREY.hexval()
        },
        {
            'label': 'Est. Alert Volume',
            'value': f"{threshold_data.get('estimated_alerts', 0):,} / month",
            'color': ReportTheme.PWC_DARK_GREY.hexval()
        },
        {
            'label': 'Population Flagged',
            'value': f"{threshold_data.get('pct_flagged', 0)}%",
            'color': ReportTheme.PWC_DARK_GREY.hexval()
        },
        {
            'label': 'Data Foundation',
            'value': f"{foundation_data.get('total_transactions', 0):,} txns",
            'color': ReportTheme.TEXT_SECONDARY.hexval()
        }
    ]
    
    elements.append(Paragraph("Calibration Outcomes", styles['SubsectionHeader']))
    elements.append(create_metric_card_table(metrics))
    elements.append(Spacer(1, 0.25*inch))
    
    # Key Decision Box - Clean styling
    decision_text = f"""
    <b>CALIBRATION DECISION</b><br/><br/>
    Based on analysis of <b>{agg_data.get('output_rows', 0):,} behavioral patterns</b> derived from 
    <b>{foundation_data.get('total_transactions', 0):,} transactions</b>, the recommended threshold 
    is <b>₹{threshold_data.get('selected_threshold', 0):,.0f}</b> (p{threshold_data.get('selected_percentile', 0)}).<br/><br/>
    
    This threshold captures the most extreme <b>{100 - threshold_data.get('selected_percentile', 0)}%</b> 
    of behavioral activity, generating an estimated <b>{threshold_data.get('estimated_alerts', 0):,} alerts 
    per month</b>. The calibration balances comprehensive risk coverage with operational capacity.<br/><br/>
    
    <b>Methodology:</b> Percentile-based statistical calibration<br/>
    <b>Data Quality:</b> {foundation_data.get('account_match_rate', 0)}% account match rate<br/>
    <b>Confidence Level:</b> High (data-driven with full audit trail)
    """
    elements.append(Paragraph(decision_text, styles['KeyFindingBox']))
    elements.append(Spacer(1, 0.2*inch))
    
    # Process Summary
    process_text = """
    <b>Calibration Process Summary:</b> This calibration followed a rigorous 4-step methodology:
    (1) Data foundation establishment and quality validation, 
    (2) Scenario-specific filtering to define target population, 
    (3) Behavioral aggregation to detect patterns over time, and 
    (4) Statistical threshold selection using percentile analysis. 
    Each step is fully documented in subsequent sections with supporting data and visualizations.
    """
    elements.append(Paragraph(process_text, styles['BodyText']))
    
    return elements