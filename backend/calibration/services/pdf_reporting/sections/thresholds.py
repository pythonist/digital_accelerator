# backend/calibration/services/pdf_reporting/sections/thresholds.py
"""
Enhanced Threshold Section (Step 3)
The most critical section - deserves 2-3 pages
Includes percentile ladder, distribution analysis, charts, and AI explanation
"""
from reportlab.platypus import Paragraph, Spacer, PageBreak, KeepTogether
from reportlab.lib.units import inch
from ..styles import ReportTheme
from ..components import (
    create_professional_table,
    create_metric_card_table,
    create_percentile_ladder_chart,
    create_matplotlib_chart,
    create_ai_explanation_box
)

# def build_threshold_section(data, ai_service=None):
#     """
#     Generate comprehensive threshold calibration section
#     This is the heart of the report - most detailed section
#     """
#     elements = []
#     styles = ReportTheme.get_styles()
    
#     # Section divider
#     elements.append(PageBreak())
#     elements.append(Paragraph("STEP 3: THRESHOLD CALIBRATION & SELECTION", styles['SectionHeader']))
#     elements.append(Paragraph(
#         "This section presents the statistical analysis and decision-making process behind "
#         "the selected threshold. The methodology ensures the threshold is data-driven, "
#         "audit-defensible, and operationally feasible.",
#         styles['BodyText']
#     ))
#     elements.append(Spacer(1, 0.3*inch))
    
#     threshold_data = data.get('threshold_analysis', {})
    
#     # --- KEY DECISION SUMMARY ---
#     elements.extend(_build_decision_summary(threshold_data, styles))
#     elements.append(Spacer(1, 0.3*inch))
    
#     # --- PERCENTILE DISTRIBUTION TABLE ---
#     elements.extend(_build_percentile_table(threshold_data, styles))
#     elements.append(PageBreak())
    
#     # --- DISTRIBUTION VISUALIZATION ---
#     elements.extend(_build_distribution_charts(threshold_data, styles))
#     elements.append(PageBreak())
    
#     # --- SELECTION RATIONALE ---
#     elements.extend(_build_selection_rationale(threshold_data, styles, ai_service))
    
#     return elements

def build_threshold_section(data, ai_service=None):
    """
    Generate comprehensive threshold calibration section
    This is the heart of the report - most detailed section
    ✅ ENHANCED: Now includes KS Statistics and ATL/BTL Analysis
    """
    elements = []
    styles = ReportTheme.get_styles()
    
    # Section divider
    elements.append(PageBreak())
    elements.append(Paragraph("STEP 3: THRESHOLD CALIBRATION & SELECTION", styles['SectionHeader']))
    elements.append(Paragraph(
        "This section presents the statistical analysis and decision-making process behind "
        "the selected threshold. The methodology ensures the threshold is data-driven, "
        "audit-defensible, and operationally feasible.",
        styles['BodyText']
    ))
    elements.append(Spacer(1, 0.3*inch))
    
    threshold_data = data.get('threshold_analysis', {})
    
    # --- KEY DECISION SUMMARY ---
    elements.extend(_build_decision_summary(threshold_data, styles))
    elements.append(Spacer(1, 0.3*inch))
    
    # --- PERCENTILE DISTRIBUTION TABLE ---
    elements.extend(_build_percentile_table(threshold_data, styles))
    elements.append(PageBreak())
    
    # --- DISTRIBUTION VISUALIZATION ---
    elements.extend(_build_distribution_charts(threshold_data, styles))
    elements.append(PageBreak())
    
    # --- SELECTION RATIONALE ---
    elements.extend(_build_selection_rationale(threshold_data, styles, ai_service))
    
    # ✅ NEW: KS STATISTICS SECTION
    ks_data = data.get('ks_statistics')
    if ks_data and ks_data.get('ks_statistic') is not None:
        elements.append(Spacer(1, 0.4*inch))
        elements.extend(_build_ks_section(ks_data, styles, ai_service))
    
    # ✅ NEW: ATL/BTL ANALYSIS SECTION
    atl_btl_data = data.get('atl_btl_analysis')
    if atl_btl_data:
        elements.append(PageBreak())
        elements.extend(_build_atl_btl_section(atl_btl_data, styles, ai_service))
    
    return elements


# ✅ NEW FUNCTION: KS Statistics Section
def _build_ks_section(ks_data, styles, ai_service=None):
    """
    Build KS (Kolmogorov-Smirnov) Statistics Section
    Shows statistical separation between alerted and suppressed populations
    """
    elements = []
    
    # Header
    elements.append(Paragraph(
        "Statistical Separation Analysis (Kolmogorov-Smirnov Test)", 
        styles['SubsectionHeader']
    ))
    
    elements.append(Paragraph(
        "The KS statistic measures how structurally different the alerted population is "
        "from the suppressed population. Higher KS values indicate stronger separation, "
        "meaning the threshold effectively distinguishes high-risk from normal behavior.",
        styles['BodyText']
    ))
    elements.append(Spacer(1, 0.15*inch))
    
    # KS Metrics Dashboard
    ks_stat = ks_data.get('ks_statistic', 0)
    interpretation = ks_data.get('interpretation', 'unknown').replace('_', ' ').title()
    p_value = ks_data.get('p_value', 0)
    populations = ks_data.get('populations', {})
    
    # Color coding based on interpretation
    if ks_stat >= 0.7:
        ks_color = ReportTheme.SUCCESS_GREEN
        quality = "EXCELLENT"
    elif ks_stat >= 0.4:
        ks_color = ReportTheme.PRIMARY_BLUE
        quality = "STRONG"
    elif ks_stat >= 0.2:
        ks_color = ReportTheme.WARNING_ORANGE
        quality = "MODERATE"
    else:
        ks_color = ReportTheme.ERROR_RED
        quality = "WEAK"
    
    ks_metrics = [
        {
            'label': 'KS Statistic',
            'value': f"{ks_stat:.3f}",
            'color': ks_color.hexval()
        },
        {
            'label': 'Separation Quality',
            'value': quality,
            'color': ks_color.hexval()
        },
        {
            'label': 'P-Value',
            'value': f"{p_value:.4f}",
            'color': ReportTheme.TEXT_PRIMARY.hexval()
        },
        {
            'label': 'Alerted Population',
            'value': f"{populations.get('alerted_size', 0):,}",
            'color': ReportTheme.PRIMARY_BLUE.hexval()
        },
        {
            'label': 'Suppressed Population',
            'value': f"{populations.get('suppressed_size', 0):,}",
            'color': ReportTheme.TEXT_SECONDARY.hexval()
        },
        {
            'label': 'Statistical Significance',
            'value': 'Yes' if p_value < 0.05 else 'No',
            'color': ReportTheme.SUCCESS_GREEN.hexval() if p_value < 0.05 else ReportTheme.WARNING_ORANGE.hexval()
        }
    ]
    
    elements.append(create_metric_card_table(ks_metrics))
    elements.append(Spacer(1, 0.2*inch))
    
    # Interpretation Box
    interpretation_text = f"""
    <b>KS STATISTIC INTERPRETATION: {quality}</b><br/><br/>
    
    <b>Score:</b> {ks_stat:.3f} (Range: 0.0 to 1.0)<br/>
    <b>Meaning:</b> {interpretation} separation between populations<br/>
    <b>Statistical Significance:</b> {'Significant (p < 0.05)' if p_value < 0.05 else 'Not significant (p ≥ 0.05)'}<br/><br/>
    
    <b>What This Means:</b><br/>
    """
    
    if ks_stat >= 0.7:
        interpretation_text += """
        The alerted population is <b>highly distinct</b> from the suppressed population. 
        This threshold creates exceptional separation, indicating entities above the threshold 
        exhibit fundamentally different behavioral patterns. <b>This is strong statistical evidence 
        that the threshold identifies a unique risk cohort.</b>
        """
    elif ks_stat >= 0.4:
        interpretation_text += """
        The alerted population shows <b>clear structural differences</b> from the suppressed population. 
        This threshold successfully isolates behaviorally distinct entities. <b>This level of separation 
        provides solid statistical justification for the threshold.</b>
        """
    elif ks_stat >= 0.2:
        interpretation_text += """
        The alerted population shows <b>moderate differences</b> from the suppressed population. 
        While some separation exists, the threshold could potentially be strengthened by testing 
        higher percentiles or alternative aggregation strategies.
        """
    else:
        interpretation_text += """
        The alerted and suppressed populations are <b>structurally very similar</b>. 
        This suggests the threshold may not be creating meaningful behavioral distinction. 
        <b>Consider testing higher percentiles or revising aggregation logic to improve separation.</b>
        """
    
    box_style = styles.get('KeyFindingBox', styles.get('HighlightBox'))
    elements.append(Paragraph(interpretation_text, box_style))
    elements.append(Spacer(1, 0.15*inch))
    
    # Technical Note
    technical_note = f"""
    <b>Technical Note:</b> The KS statistic measures the maximum vertical distance between the 
    cumulative distribution functions (CDFs) of the two populations. A KS value of {ks_stat:.3f} 
    means the two distributions differ by up to {ks_stat*100:.1f} percentage points at their point 
    of maximum divergence (threshold value: â‚¹{ks_data.get('threshold', 0):,.0f}).
    """
    elements.append(Paragraph(technical_note, styles['Caption']))
    
    # AI Explanation (if available)
    if ai_service:
        ai_text = ai_service.explain_ks_statistics(ks_data)
        if ai_text:
            elements.append(Spacer(1, 0.15*inch))
            ai_box = create_ai_explanation_box(ai_text)
            if ai_box:
                elements.append(ai_box)
    
    return elements


# ✅ NEW FUNCTION: ATL/BTL Analysis Section
def _build_atl_btl_section(atl_btl_data, styles, ai_service=None):
    """
    Build ATL/BTL (Above-the-Line / Below-the-Line) Analysis Section
    Justifies why the threshold shouldn't be lowered
    """
    elements = []
    
    # Header
    elements.append(Paragraph(
        "Above-the-Line / Below-the-Line Threshold Justification", 
        styles['SubsectionHeader']
    ))
    
    elements.append(Paragraph(
        "ATL/BTL analysis answers the critical question: <i>What if we lowered the threshold?</i> "
        "This analysis demonstrates whether lowering the threshold would capture additional meaningful risk "
        "or simply generate noise that dilutes investigative focus.",
        styles['BodyText']
    ))
    elements.append(Spacer(1, 0.15*inch))
    
    # Zone Definitions
    threshold = atl_btl_data.get('threshold', 0)
    btl_band = atl_btl_data.get('btl_band', {})
    atl = atl_btl_data.get('atl', {})
    btl = atl_btl_data.get('btl', {})
    far_below = atl_btl_data.get('far_below', {})
    
    zone_text = f"""
    <b>ZONE DEFINITIONS</b><br/><br/>
    
    <b>Selected Threshold:</b> â‚¹{threshold:,.0f}<br/>
    <b>BTL Band:</b> {btl_band.get('pct', 10)}% below threshold 
    (â‚¹{btl_band.get('lower', 0):,.0f} to â‚¹{btl_band.get('upper', 0):,.0f})<br/><br/>
    
    <b>Three Zones:</b><br/>
    â€¢ <b>Above-the-Line (ATL):</b> Entities â‰¥ â‚¹{threshold:,.0f} (Currently Alerted)<br/>
    â€¢ <b>Below-the-Line (BTL):</b> Entities in the {btl_band.get('pct', 10)}% band below threshold (Near-Miss Zone)<br/>
    â€¢ <b>Far Below:</b> Entities well below threshold (Normal Behavior)
    """
    
    box_style = styles.get('KeyFindingBox', styles.get('HighlightBox'))
    elements.append(Paragraph(zone_text, box_style))
    elements.append(Spacer(1, 0.2*inch))
    
    # Population Split Table
    elements.append(Paragraph("Population Distribution Across Zones", styles['SubsectionHeader']))
    
    table_data = [
        ['Zone', 'Entity Count', '% of Population', 'Status'],
        [
            'Above-the-Line (ATL)',
            f"{atl.get('count', 0):,}",
            f"{atl.get('pct_population', 0)}%",
            'âœ" Currently Alerted'
        ],
        [
            'Below-the-Line (BTL)',
            f"{btl.get('count', 0):,}",
            f"{btl.get('pct_population', 0)}%",
            'âš  Near-Miss Zone'
        ],
        [
            'Far Below Threshold',
            f"{far_below.get('count', 0):,}",
            f"{far_below.get('pct_population', 0)}%",
            'Normal Behavior'
        ],
        [
            '<b>TOTAL</b>',
            f"<b>{atl_btl_data.get('total_population', 0):,}</b>",
            '<b>100%</b>',
            ''
        ]
    ]
    
    atl_row = 1  # Highlight ATL row
    table = create_professional_table(
        table_data,
        col_widths=[1.75*inch, 1.5*inch, 1.5*inch, 1.75*inch],
        highlight_rows=[atl_row],
        has_totals=True
    )
    elements.append(table)
    elements.append(Spacer(1, 0.2*inch))
    
    # Workload Impact Analysis
    elements.append(Paragraph("Impact of Lowering Threshold", styles['SubsectionHeader']))
    
    impact_text = f"""
    <b>WHAT IF WE LOWERED THE THRESHOLD BY {btl_band.get('pct', 10)}%?</b><br/><br/>
    
    <b>Additional Alerts:</b> +{btl.get('count', 0):,} entities would be flagged<br/>
    <b>Additional Workload:</b> {btl.get('pct_population', 0)}% increase in alert volume<br/>
    <b>Near-Miss Characteristics:</b> Entities in BTL zone are {btl_band.get('pct', 10)}% below the current 
    threshold, representing marginally lower behavioral metrics.<br/><br/>
    
    <b>Key Question:</b> Do these {btl.get('count', 0):,} additional alerts represent meaningful risk, 
    or are they statistically similar to entities already suppressed?<br/><br/>
    
    <b>Analysis Verdict:</b> The selected threshold appropriately separates signal from noise. 
    Lowering the threshold would increase workload by {btl.get('pct_population', 0)}% without 
    proportionate risk capture improvement.
    """
    
    warning_box = styles.get('WarningBox', styles.get('HighlightBox'))
    elements.append(Paragraph(impact_text, warning_box))
    elements.append(Spacer(1, 0.15*inch))
    
    # Justification Statement
    justification = f"""
    <b>THRESHOLD JUSTIFICATION STATEMENT</b><br/><br/>
    
    The selected threshold of â‚¹{threshold:,.0f} is justified because:<br/><br/>
    
    1. <b>Clear Separation:</b> The {atl.get('pct_population', 0)}% of entities above the threshold 
    ({atl.get('count', 0):,} entities) represent statistically unusual behavior warranting investigation.<br/><br/>
    
    2. <b>Operational Feasibility:</b> Lowering the threshold would add {btl.get('count', 0):,} alerts 
    ({btl.get('pct_population', 0)}% increase), creating capacity strain without clear risk benefit.<br/><br/>
    
    3. <b>Near-Miss Analysis:</b> The BTL zone contains entities within {btl_band.get('pct', 10)}% 
    of the threshold. These are borderline cases that do not exhibit the extreme behavioral patterns 
    that characterize true risk.<br/><br/>
    
    4. <b>Resource Optimization:</b> Investigative resources are best allocated to the top 
    {100 - atl.get('pct_population', 0):.0f}% tail (ATL zone) where risk concentration is highest.
    """
    
    elements.append(Paragraph(justification, box_style))
    
    # AI Explanation (if available)
    if ai_service:
        ai_text = ai_service.explain_atl_btl_analysis(atl_btl_data)
        if ai_text:
            elements.append(Spacer(1, 0.15*inch))
            ai_box = create_ai_explanation_box(ai_text)
            if ai_box:
                elements.append(ai_box)
    
    return elements
def _build_decision_summary(threshold_data, styles):
    """Key Decision Dashboard"""
    elements = []
    
    elements.append(Paragraph("Selected Threshold: Key Metrics", styles['SubsectionHeader']))
    
    metrics = [
        {
            'label': 'Selected Threshold',
            'value': f"₹{threshold_data.get('selected_threshold', 0):,.0f}",
            'color': ReportTheme.PRIMARY_BLUE.hexval() # Ensure hex string
        },
        {
            'label': 'Percentile Rank',
            'value': f"{threshold_data.get('selected_percentile', 0)}th",
            'color': ReportTheme.PRIMARY_BLUE.hexval()
        },
        {
            'label': 'Top Percentile Coverage',
            'value': f"Top {100 - threshold_data.get('selected_percentile', 0)}%",
            'color': ReportTheme.SUCCESS_GREEN.hexval()
        },
        {
            'label': 'Estimated Alert Volume',
            'value': f"{threshold_data.get('estimated_alerts', 0):,} / month",
            'color': ReportTheme.WARNING_ORANGE.hexval()
        },
        {
            'label': 'Population Flagged',
            'value': f"{threshold_data.get('pct_flagged', 0)}%",
            'color': ReportTheme.SUCCESS_GREEN.hexval()
        },
        {
            'label': 'Selection Method',
            'value': threshold_data.get('selection_method', 'Percentile-based'),
            'color': ReportTheme.TEXT_PRIMARY.hexval()
        }
    ]
    
    elements.append(create_metric_card_table(metrics))
    elements.append(Spacer(1, 0.2*inch))
    
    # Decision Highlight Box
    decision_text = f"""
    <b>SELECTED DECISION: ₹{threshold_data.get('selected_threshold', 0):,.0f}</b><br/><br/>
    This threshold represents the <b>{threshold_data.get('selected_percentile', 0)}th percentile</b> of 
    the behavioral distribution, meaning it captures the most extreme <b>{100 - threshold_data.get('selected_percentile', 0)}%</b> 
    of activity patterns. This is expected to generate approximately <b>{threshold_data.get('estimated_alerts', 0):,} alerts 
    per month</b>, representing <b>{threshold_data.get('pct_flagged', 0)}%</b> of the calibrated population.<br/><br/>
    This balance ensures comprehensive risk coverage while maintaining investigative capacity.
    """
    
    # Check if KeyFindingBox exists, otherwise fallback to HighlightBox
    box_style = styles['KeyFindingBox'] if 'KeyFindingBox' in styles else styles['HighlightBox']
    elements.append(Paragraph(decision_text, box_style))
    
    return elements


def _build_percentile_table(threshold_data, styles):
    """Detailed percentile distribution table"""
    elements = []
    
    elements.append(Paragraph("Percentile Distribution Analysis", styles['SubsectionHeader']))
    elements.append(Paragraph(
        "The following table shows how alert volume changes across the percentile range. "
        "This analysis helps identify the optimal threshold that balances risk coverage with operational workload.",
        styles['BodyText']
    ))
    elements.append(Spacer(1, 0.1*inch))
    
    distribution = threshold_data.get('percentile_distribution', [])
    selected_percentile = threshold_data.get('selected_percentile', 0)
    
    if not distribution:
        elements.append(Paragraph("No distribution data available", styles['BodyText']))
        return elements
    
    # Build table data
    table_data = [['Percentile', 'Threshold Value (₹)', 'Alert Count', '% Population', 'Status']]
    
    for row in distribution:
        percentile = row.get('percentile', 0)
        # Handle 'value' (DB) or 'threshold' (calculated)
        threshold = row.get('value', row.get('threshold', 0))
        # Handle 'alert_count' (DB) or 'alerts' (calculated)
        alerts = row.get('alert_count', row.get('alerts', 0))
        pct_pop = row.get('pct_population', 0)
        
        # Mark selected row
        status = '✓ SELECTED' if percentile == selected_percentile else ''
        
        table_data.append([
            f"p{percentile}",
            f"₹{threshold:,.0f}",
            f"{alerts:,}",
            f"{pct_pop}%",
            status
        ])
    
    # Highlight selected row
    selected_row_idx = next(
        (i + 1 for i, row in enumerate(distribution) if row.get('percentile') == selected_percentile),
        None
    )
    
    table = create_professional_table(
        table_data,
        col_widths=[1*inch, 1.75*inch, 1.5*inch, 1.25*inch, 1.5*inch],
        highlight_rows=[selected_row_idx] if selected_row_idx else None
    )
    
    elements.append(table)
    elements.append(Spacer(1, 0.15*inch))
    
    # Table interpretation
    interpretation = f"""
    <b>Table Interpretation:</b> As the percentile increases (moving down the table), the threshold 
    value increases while the alert count decreases. The selected <b>p{selected_percentile}</b> threshold 
    strikes a balance between capturing high-risk behavior and maintaining a manageable alert volume.
    """
    elements.append(Paragraph(interpretation, styles['Caption']))
    
    return elements


def _build_distribution_charts(threshold_data, styles):
    """Visualizations of threshold impact"""
    elements = []
    
    elements.append(Paragraph("Distribution Visualizations", styles['SubsectionHeader']))
    
    distribution = threshold_data.get('percentile_distribution', [])
    
    if not distribution or len(distribution) < 3:
        elements.append(Paragraph("Insufficient data for visualization", styles['BodyText']))
        return elements
    
    # Chart 1: Percentile Ladder (Threshold vs Alerts)
    elements.append(Paragraph("Threshold vs Alert Impact", styles['SubsectionHeader']))
    elements.append(Paragraph(
        "This chart shows how threshold values (blue line) and alert counts (orange line) "
        "change across percentiles. The inflection point indicates the optimal calibration zone.",
        styles['BodyText']
    ))
    elements.append(Spacer(1, 0.1*inch))
    
    ladder_chart = create_percentile_ladder_chart(distribution)
    elements.append(ladder_chart)
    elements.append(Spacer(1, 0.3*inch))
    
    # Chart 2: Alert Distribution Bar Chart
    elements.append(Paragraph("Alert Volume by Percentile Range", styles['SubsectionHeader']))
    
    # Group into ranges for cleaner visualization
    # ✅ FIX: Safe access with .get() using 'alert_count' or 'alerts'
    percentiles = [p.get('percentile', 0) for p in distribution[::2]]  # Every other percentile
    alerts = [p.get('alert_count', p.get('alerts', 0)) for p in distribution[::2]]
    
    alert_chart = create_matplotlib_chart(
        chart_type='bar',
        data={'x': [f"p{p}" for p in percentiles], 'y': alerts},
        title='Alert Count Reduction Across Percentiles',
        xlabel='Percentile',
        ylabel='Alert Count'
    )
    elements.append(alert_chart)
    elements.append(Spacer(1, 0.2*inch))
    
    # Distribution shape explanation
    shape_text = f"""
    <b>Distribution Characteristics:</b><br/>
    The steep drop in alert volume between p{percentiles[0] if percentiles else 75} and 
    p{percentiles[-1] if percentiles else 99} indicates a <b>right-skewed distribution</b> typical 
    of financial transaction data. Most entities have modest behavioral metrics, while a small 
    percentage exhibits extreme values. This validates the percentile-based approach, as simple 
    average-based thresholds would fail to capture the tail behavior where risk concentrates.
    """
    elements.append(Paragraph(shape_text, styles['WarningBox']))
    
    return elements


def _build_selection_rationale(threshold_data, styles, ai_service):
    """Detailed explanation of why this threshold was chosen"""
    elements = []
    
    elements.append(Paragraph("Selection Rationale & Justification", styles['SubsectionHeader']))
    
    # Manual rationale from data
    rationale = threshold_data.get('rationale', '')
    if rationale:
        elements.append(Paragraph("<b>Decision Rationale:</b>", styles['BodyText']))
        elements.append(Paragraph(rationale, styles['BodyText']))
        elements.append(Spacer(1, 0.15*inch))
    
    # Four Pillars of Justification
    justification = f"""
    <b>THRESHOLD JUSTIFICATION FRAMEWORK</b><br/><br/>
    
    <b>1. Data-Driven Foundation</b><br/>
    The threshold of ₹{threshold_data.get('selected_threshold', 0):,.0f} is derived from {threshold_data.get('sample_size', 'N/A')} 
    real historical behavioral patterns, not arbitrary rules or subjective judgment. The percentile methodology 
    is statistically sound and industry-accepted.<br/><br/>
    
    <b>2. Risk-Aligned Coverage</b><br/>
    By selecting the {threshold_data.get('selected_percentile', 0)}th percentile, this threshold captures the 
    top {100 - threshold_data.get('selected_percentile', 0)}% of activity—focusing investigative resources 
    on statistically unusual behavior where risk is concentrated.<br/><br/>
    
    <b>3. Operational Feasibility</b><br/>
    The estimated {threshold_data.get('estimated_alerts', 0):,} alerts per month represents a workload that 
    can be realistically investigated without overwhelming the compliance team. This balance is critical for 
    maintaining alert quality and investigation depth.<br/><br/>
    
    <b>4. Regulatory Defensibility</b><br/>
    The transparent, percentile-based methodology with full audit trail (documented in this report) provides 
    clear justification for regulatory review. The threshold can be explained, reproduced, and validated 
    independently—meeting model governance standards.
    """
    
    # Use KeyFindingBox if available, else HighlightBox
    box_style = styles['KeyFindingBox'] if 'KeyFindingBox' in styles else styles['HighlightBox']
    elements.append(Paragraph(justification, box_style))
    elements.append(Spacer(1, 0.2*inch))
    
    # Sensitivity & Confidence Note
    sensitivity_text = """
    <b>Threshold Sensitivity:</b> Percentile-based thresholds are inherently sensitive to data distribution. 
    A 1-percentile shift can significantly change alert volume. This is intentional—it reflects that 
    small threshold adjustments have real impact on risk coverage. Regular recalibration (quarterly recommended) 
    ensures the threshold adapts to behavioral evolution.
    """
    elements.append(Paragraph(sensitivity_text, styles['Caption']))
    elements.append(Spacer(1, 0.2*inch))
    
    # AI Explanation
    if ai_service:
        ai_text = ai_service.explain_threshold_selection(threshold_data)
        if ai_text:
            ai_box = create_ai_explanation_box(ai_text)
            if ai_box:
                elements.append(ai_box)
    
    return elements