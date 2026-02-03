# backend/calibration/services/pdf_reporting/sections/methodology.py
"""
Enhanced Methodology Section
Covers Steps 0, 1, 2 with charts, tables, and AI explanations
Each step gets dedicated space with professional layout
"""
from reportlab.platypus import Paragraph, Spacer, PageBreak, KeepTogether
from reportlab.lib.units import inch
from ..styles import ReportTheme
from ..components import (
    create_professional_table,
    create_metric_card_table,
    create_filter_summary_table,
    create_matplotlib_chart,
    create_ai_explanation_box
)

def build_methodology_section(data, ai_service=None):
    """
    Generate comprehensive methodology section
    Includes all three data preparation steps
    """
    elements = []
    styles = ReportTheme.get_styles()
    
    # Section divider
    elements.append(PageBreak())
    elements.append(Paragraph("CALIBRATION METHODOLOGY", styles['SectionHeader']))
    elements.append(Paragraph(
        "This section documents the complete data preparation and transformation process, "
        "ensuring full auditability and regulatory compliance.",
        styles['BodyText']
    ))
    elements.append(Spacer(1, 0.3*inch))
    
    # --- STEP 0: DATA FOUNDATION ---
    elements.extend(_build_step0_data_foundation(data, styles, ai_service))
    elements.append(PageBreak())
    
    # --- STEP 1: SCENARIO DEFINITION ---
    elements.extend(_build_step1_scenario_definition(data, styles, ai_service))
    elements.append(PageBreak())
    
    # --- STEP 2: AGGREGATION ---
    elements.extend(_build_step2_aggregation(data, styles, ai_service))
    
    return elements


def _build_step0_data_foundation(data, styles, ai_service):
    """Step 0: Data Foundation - Full page with metrics and quality analysis"""
    elements = []
    
    # Header
    elements.append(Paragraph("STEP 0: DATA FOUNDATION", styles['SubsectionHeader']))
    elements.append(Paragraph(
        "The calibration is built on a comprehensive dataset that has been validated "
        "and enriched through multiple join operations.",
        styles['BodyText']
    ))
    elements.append(Spacer(1, 0.2*inch))
    
    foundation = data.get('data_foundation', {})
    def _safe_pct(val):
        try:
            return float(val)
        except (TypeError, ValueError):
            return 0.0

    account_match_rate = _safe_pct(foundation.get('account_match_rate'))
    customer_match_rate = _safe_pct(foundation.get('customer_match_rate'))
    # Key Metrics Dashboard
    metrics = [
        {
            'label': 'Transactions Loaded',
            'value': f"{foundation.get('total_transactions', 0):,}",
            'color': ReportTheme.PRIMARY_BLUE
        },
        {
            'label': 'Account Match Rate',
            'value': f"{account_match_rate:.1f}%",
            'color': ReportTheme.SUCCESS_GREEN
                if account_match_rate >= 95
                else ReportTheme.WARNING_ORANGE
        },
        {
            'label': 'Customer Match Rate',
            'value': f"{customer_match_rate:.1f}%",
            'color': ReportTheme.SUCCESS_GREEN
                if customer_match_rate >= 95
                else ReportTheme.WARNING_ORANGE
        }
    ]

    
    elements.append(create_metric_card_table(metrics))
    elements.append(Spacer(1, 0.2*inch))
    
    # Join Strategy Table
    elements.append(Paragraph("Data Join Strategy", styles['SubsectionHeader']))
    join_data = [
        ['Join Type', 'Source Tables', 'Result'],
        ['LEFT JOIN', 'Transactions ← Accounts', f"{foundation.get('account_match_rate', 0)}% matched"],
        ['LEFT JOIN', 'Transactions ← Customers', f"{foundation.get('customer_match_rate', 0)}% matched"],
        ['Strategy', 'Preserve all transactions', 'No data loss']
    ]
    elements.append(create_professional_table(join_data, col_widths=[1.5*inch, 2.5*inch, 2*inch]))
    elements.append(Spacer(1, 0.2*inch))
    
    # Data Quality Assessment
    elements.append(Paragraph("Data Quality Assessment", styles['SubsectionHeader']))
    
    quality_score = "HIGH" if account_match_rate >= 95 else "MEDIUM"

    quality_color = ReportTheme.SUCCESS_GREEN if quality_score == "HIGH" else ReportTheme.WARNING_ORANGE
    
    quality_text = f"""
            <b>Overall Data Quality: <font color="{quality_color}">{quality_score}</font></b><br/><br/>
            The dataset demonstrates {quality_score.lower()} quality with {foundation.get('total_transactions', 0):,} 
            transactions successfully loaded. The join strategy using LEFT JOIN ensures no transaction data is lost 
            during enrichment, which is critical for comprehensive risk coverage.<br/><br/>
            <b>Join Strategy Rationale:</b> LEFT JOIN preserves all {foundation.get('total_transactions', 0):,} 
            transactions even when account or customer metadata is missing. Unmatched records 
            ({100 - account_match_rate:.1f}% accounts, {100 - customer_match_rate:.1f}% customers) 
            are flagged for data quality review but remain in the calibration population.
            """

    elements.append(Paragraph(quality_text, styles['BodyText']))
    elements.append(Spacer(1, 0.2*inch))
    
    # AI Explanation
    if ai_service:
        ai_text = ai_service.explain_data_foundation(foundation)
        if ai_text:
            ai_box = create_ai_explanation_box(ai_text)
            if ai_box:
                elements.append(ai_box)
    
    return elements


def _build_step1_scenario_definition(data, styles, ai_service):
    """Step 1: Scenario Definition - Filter analysis with reduction visualization"""
    elements = []
    
    # Header
    elements.append(Paragraph("STEP 1: SCENARIO DEFINITION (V1 POPULATION)", styles['SubsectionHeader']))
    elements.append(Paragraph(
        "Scenario-specific filters define the target population for calibration, focusing on "
        "transactions that match the detection rule's scope.",
        styles['BodyText']
    ))
    elements.append(Spacer(1, 0.2*inch))
    
    scenario = data.get('scenario_analysis', {})
    
    # Population Reduction Metrics
    metrics = [
        {
            'label': 'Original Population',
            'value': f"{scenario.get('original_count', 0):,}",
            'color': ReportTheme.TEXT_PRIMARY
        },
        {
            'label': 'Final V1 Population',
            'value': f"{scenario.get('final_count', 0):,}",
            'color': ReportTheme.PRIMARY_BLUE
        },
        {
            'label': 'Reduction Applied',
            'value': f"{scenario.get('reduction_pct', 0)}%",
            'color': ReportTheme.SUCCESS_GREEN
        }
    ]
    
    elements.append(create_metric_card_table(metrics))
    elements.append(Spacer(1, 0.3*inch))
    
    # Filter Summary Table
    elements.append(Paragraph("Applied Filters", styles['SubsectionHeader']))
    
    filter_details = scenario.get('filter_details', {})
    if filter_details:
        filter_table = create_filter_summary_table(filter_details)
        elements.append(filter_table)
    else:
        elements.append(Paragraph("No filters applied", styles['BodyText']))
    
    elements.append(Spacer(1, 0.2*inch))
    
    # Population Reduction Chart
    if scenario.get('original_count', 0) > 0 and scenario.get('final_count', 0) > 0:
        elements.append(Paragraph("Population Reduction Visualization", styles['SubsectionHeader']))
        
        chart = create_matplotlib_chart(
            chart_type='bar',
            data={
                'x': ['Original\nPopulation', 'After\nFilters'],
                'y': [scenario.get('original_count', 0), scenario.get('final_count', 0)]
            },
            title='Transaction Population Reduction',
            ylabel='Transaction Count'
        )
        elements.append(chart)
        elements.append(Spacer(1, 0.2*inch))
    
    # Rationale Box
    rationale_text = f"""
    <b>Filter Strategy Rationale:</b><br/><br/>
    Filters ensure the calibration focuses on transactions that match the scenario's risk profile. 
    By reducing the population from {scenario.get('original_count', 0):,} to {scenario.get('final_count', 0):,} 
    transactions ({scenario.get('reduction_pct', 0)}% reduction), the threshold becomes more precise and 
    relevant to the specific detection pattern.<br/><br/>
    <b>Key Principle:</b> Calibration should reflect the worst-case population that the rule will encounter 
    in production. Overly broad calibration dilutes threshold effectiveness, while proper filtering ensures 
    the threshold is tuned to the actual risk pattern.
    """
    elements.append(Paragraph(rationale_text, styles['KeyFindingBox']))
    elements.append(Spacer(1, 0.2*inch))
    
    # AI Explanation
    if ai_service:
        ai_text = ai_service.explain_filter_strategy(scenario)
        if ai_text:
            ai_box = create_ai_explanation_box(ai_text)
            if ai_box:
                elements.append(ai_box)
    
    return elements


def _build_step2_aggregation(data, styles, ai_service):
    """Step 2: Aggregation - Behavioral transformation analysis"""
    elements = []
    
    # Header
    elements.append(Paragraph("STEP 2: BEHAVIORAL AGGREGATION (V2 POPULATION)", styles['SubsectionHeader']))
    elements.append(Paragraph(
        "Transaction-level data is transformed into behavioral patterns through aggregation, "
        "enabling detection of unusual activity over time rather than isolated transactions.",
        styles['BodyText']
    ))
    elements.append(Spacer(1, 0.2*inch))
    
    agg = data.get('aggregation_analysis', {})
    
    # Configuration Dashboard
    config_metrics = [
        {
            'label': 'Aggregation Level',
            'value': agg.get('aggregation_level', 'account').upper(),
            'color': ReportTheme.PRIMARY_BLUE
        },
        {
            'label': 'Lookback Window',
            'value': f"{agg.get('lookback_days', 90)} days",
            'color': ReportTheme.PRIMARY_BLUE
        },
        {
            'label': 'Run Frequency',
            'value': agg.get('frequency', 'daily').upper(),
            'color': ReportTheme.PRIMARY_BLUE
        }
    ]
    
    elements.append(Paragraph("Aggregation Configuration", styles['SubsectionHeader']))
    elements.append(create_metric_card_table(config_metrics))
    elements.append(Spacer(1, 0.3*inch))
    
    # Transformation Impact
    elements.append(Paragraph("Transformation Impact", styles['SubsectionHeader']))
    
    impact_data = [
        ['Metric', 'Before Aggregation', 'After Aggregation', 'Change'],
        ['Data Granularity', 'Individual Transactions', 'Behavioral Aggregates', 'Pattern-based'],
        ['Row Count', f"{agg.get('input_rows', 0):,}", f"{agg.get('output_rows', 0):,}", f"{agg.get('compression_ratio', 0)}:1"],
        ['Unique Entities', 'N/A', f"{agg.get('unique_entities', 0):,}", 'Identified'],
        ['Detection Focus', 'Transaction-level', 'Behavior-level', 'Time-based patterns']
    ]
    
    elements.append(create_professional_table(
        impact_data,
        col_widths=[1.5*inch, 1.5*inch, 1.5*inch, 1.5*inch]
    ))
    elements.append(Spacer(1, 0.2*inch))
    
    # Compression Visualization
    if agg.get('input_rows', 0) > 0 and agg.get('output_rows', 0) > 0:
        elements.append(Paragraph("Data Compression Analysis", styles['SubsectionHeader']))
        
        chart = create_matplotlib_chart(
            chart_type='bar',
            data={
                'x': ['Transaction\nRecords', 'Behavioral\nAggregates'],
                'y': [agg.get('input_rows', 0), agg.get('output_rows', 0)]
            },
            title=f"Aggregation Compression ({agg.get('compression_ratio', 0)}:1 ratio)",
            ylabel='Record Count'
        )
        elements.append(chart)
        elements.append(Spacer(1, 0.2*inch))
    
    # Why Aggregation Matters
    aggregation_explanation = f"""
    <b>Why Aggregation is Critical for AML Detection:</b><br/><br/>
    Individual transactions often appear normal in isolation. Money laundering patterns emerge through 
    <i>accumulated behavior over time</i>. By aggregating {agg.get('input_rows', 0):,} transactions into 
    {agg.get('output_rows', 0):,} behavioral snapshots, we can:<br/><br/>
    • Detect velocity patterns (e.g., sudden increase in activity)<br/>
    • Identify cumulative risk (e.g., total value over {agg.get('lookback_days', 90)} days)<br/>
    • Compare behavior across time periods<br/>
    • Set thresholds on <i>patterns</i> rather than isolated events<br/><br/>
    <b>Alert Grain:</b> One alert = one {agg.get('aggregation_level', 'account')} flagged per 
    {agg.get('frequency', 'daily')} period when behavioral metrics exceed the threshold.
    """
    elements.append(Paragraph(aggregation_explanation, styles['KeyFindingBox']))
    elements.append(Spacer(1, 0.2*inch))
    
    # AI Explanation
    if ai_service:
        ai_text = ai_service.explain_aggregation_logic(agg)
        if ai_text:
            ai_box = create_ai_explanation_box(ai_text)
            if ai_box:
                elements.append(ai_box)
    
    return elements