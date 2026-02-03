# backend/calibration/services/pdf_generator_service.py
"""
PDF Generator Service
Creates regulator-grade PDF reports using ReportLab
"""
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Image, KeepTogether
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from datetime import datetime
import tempfile
import os

class PDFGeneratorService:
    """Generates professional PDF reports"""
    
    def __init__(self):
        self.styles = getSampleStyleSheet()
        self._setup_custom_styles()
    
    def _setup_custom_styles(self):
        """Define custom paragraph styles"""
        # Title style
        self.styles.add(ParagraphStyle(
            name='CustomTitle',
            parent=self.styles['Heading1'],
            fontSize=24,
            textColor=colors.HexColor('#1976d2'),
            spaceAfter=30,
            alignment=TA_CENTER
        ))
        
        # Section header
        self.styles.add(ParagraphStyle(
            name='SectionHeader',
            parent=self.styles['Heading2'],
            fontSize=16,
            textColor=colors.HexColor('#424242'),
            spaceAfter=12,
            spaceBefore=20,
            borderWidth=1,
            borderColor=colors.HexColor('#e0e0e0'),
            borderPadding=5
        ))
        
        # Subsection
        self.styles.add(ParagraphStyle(
            name='SubSection',
            parent=self.styles['Heading3'],
            fontSize=12,
            textColor=colors.HexColor('#616161'),
            spaceAfter=8
        ))
        
        # Highlight box
        self.styles.add(ParagraphStyle(
            name='HighlightBox',
            parent=self.styles['BodyText'],
            fontSize=11,
            backColor=colors.HexColor('#e3f2fd'),
            borderWidth=1,
            borderColor=colors.HexColor('#1976d2'),
            borderPadding=10,
            spaceAfter=15
        ))
    
    def generate_pdf(self, report_data, output_path=None):
        """
        Generate PDF report from report data
        
        Args:
            report_data: Dict from ReportDataService
            output_path: Optional path, or create temp file
        
        Returns:
            Path to generated PDF
        """
        # Create output file
        if not output_path:
            fd, output_path = tempfile.mkstemp(suffix='.pdf')
            os.close(fd)
        
        # Create document
        doc = SimpleDocTemplate(
            output_path,
            pagesize=letter,
            rightMargin=0.75*inch,
            leftMargin=0.75*inch,
            topMargin=1*inch,
            bottomMargin=0.75*inch
        )
        
        # Build content
        story = []
        
        # Cover page
        story.extend(self._build_cover_page(report_data))
        story.append(PageBreak())
        
        # Executive summary
        story.extend(self._build_executive_summary(report_data))
        story.append(PageBreak())
        
        # Step 0: Data Foundation
        story.extend(self._build_data_foundation(report_data))
        
        # Step 1: Scenario Definition
        story.extend(self._build_scenario_section(report_data))
        
        # Step 2: Aggregation
        story.extend(self._build_aggregation_section(report_data))
        
        # Step 3: Threshold Calibration
        story.extend(self._build_threshold_section(report_data))
        story.append(PageBreak())
        
        # Governance
        story.extend(self._build_governance_section(report_data))
        
        # Recommendations
        story.extend(self._build_recommendations(report_data))
        
        # Build PDF
        doc.build(story)
        
        print(f"✅ PDF generated: {output_path}")
        return output_path
    
    def _build_cover_page(self, data):
        """Create cover page"""
        elements = []
        
        # Title
        elements.append(Spacer(1, 2*inch))
        elements.append(Paragraph(
            "AML THRESHOLD CALIBRATION REPORT",
            self.styles['CustomTitle']
        ))
        
        elements.append(Spacer(1, 0.5*inch))
        
        # Scenario name
        elements.append(Paragraph(
            f"<b>Scenario:</b> {data['meta']['scenario']}",
            self.styles['Heading2']
        ))
        
        elements.append(Spacer(1, 1*inch))
        
        # Metadata table
        meta_data = [
            ['Run ID', data['meta']['run_id']],
            ['Created By', data['meta']['created_by']],
            ['Date', data['meta']['created_at'][:10]],
            ['Status', data['meta']['status'].upper()],
            ['Report Generated', datetime.now().strftime('%Y-%m-%d %H:%M')]
        ]
        
        meta_table = Table(meta_data, colWidths=[2*inch, 4*inch])
        meta_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f5f5f5')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey)
        ]))
        
        elements.append(meta_table)
        
        return elements
    
    def _build_executive_summary(self, data):
        """Executive summary section"""
        elements = []
        
        elements.append(Paragraph("EXECUTIVE SUMMARY", self.styles['SectionHeader']))
        
        threshold = data['threshold_analysis']['selected_threshold']
        percentile = data['threshold_analysis']['selected_percentile']
        alerts = data['threshold_analysis']['estimated_alerts']
        
        summary_text = f"""
        <b>Recommended Threshold:</b> ₹{threshold:,.0f}<br/>
        <b>Percentile Rank:</b> {percentile}th (Top {100-percentile}%)<br/>
        <b>Estimated Alert Volume:</b> {alerts:,} per month<br/>
        <b>Population Flagged:</b> {data['threshold_analysis']['pct_flagged']}%<br/><br/>
        
        This threshold was derived through systematic analysis of {data['aggregation_analysis']['output_rows']:,} 
        historical behavior patterns. The calibration methodology ensures regulatory defensibility 
        while maintaining operational feasibility.
        """
        
        elements.append(Paragraph(summary_text, self.styles['HighlightBox']))
        
        return elements
    
    def _build_data_foundation(self, data):
        """Step 0: Data Foundation"""
        elements = []
        
        elements.append(Paragraph("STEP 0: DATA FOUNDATION", self.styles['SectionHeader']))
        
        foundation = data['data_foundation']
        
        data_table = [
            ['Metric', 'Value'],
            ['Total Transactions Loaded', f"{foundation['total_transactions']:,}"],
            ['Account Match Rate', f"{foundation['account_match_rate']}%"],
            ['Customer Match Rate', f"{foundation['customer_match_rate']}%"],
            ['Join Strategy', foundation['join_strategy']]
        ]
        
        table = Table(data_table, colWidths=[3*inch, 3*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1976d2')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f5f5')])
        ]))
        
        elements.append(table)
        elements.append(Spacer(1, 0.2*inch))
        
        return elements
    
    def _build_scenario_section(self, data):
        """Step 1: Scenario Definition"""
        elements = []
        
        elements.append(Paragraph("STEP 1: SCENARIO DEFINITION", self.styles['SectionHeader']))
        
        scenario = data['scenario_analysis']
        
        # Filter summary
        elements.append(Paragraph(
            f"<b>Filters Applied:</b> {scenario['logic_summary']}",
            self.styles['BodyText']
        ))
        elements.append(Spacer(1, 0.1*inch))
        
        # Impact table
        impact_data = [
            ['Stage', 'Count'],
            ['Original Population', f"{scenario['original_count']:,}"],
            ['After Filters', f"{scenario['final_count']:,}"],
            ['Reduction', f"{scenario['reduction_pct']}%"]
        ]
        
        table = Table(impact_data, colWidths=[3*inch, 3*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1976d2')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f5f5')])
        ]))
        
        elements.append(table)
        elements.append(Spacer(1, 0.2*inch))
        
        return elements
    
    def _build_aggregation_section(self, data):
        """Step 2: Aggregation"""
        elements = []
        
        elements.append(Paragraph("STEP 2: AGGREGATION LOGIC", self.styles['SectionHeader']))
        
        agg = data['aggregation_analysis']
        
        config_text = f"""
        <b>Aggregation Level:</b> {agg['aggregation_level'].upper()}<br/>
        <b>Lookback Period:</b> {agg['lookback_days']} days<br/>
        <b>Run Frequency:</b> {agg['frequency'].upper()}<br/><br/>
        
        <b>Transformation Impact:</b><br/>
        Input: {agg['input_rows']:,} transactions → Output: {agg['output_rows']:,} aggregates<br/>
        Compression Ratio: {agg['compression_ratio']}:1
        """
        
        elements.append(Paragraph(config_text, self.styles['BodyText']))
        elements.append(Spacer(1, 0.2*inch))
        
        return elements
    
    def _build_threshold_section(self, data):
        """Step 3: Threshold Calibration"""
        elements = []
        
        elements.append(Paragraph("STEP 3: THRESHOLD CALIBRATION", self.styles['SectionHeader']))
        
        threshold = data['threshold_analysis']
        
        # Percentile distribution table
        percentile_data = [['Percentile', 'Threshold Value', 'Alert Count', '% Population']]
        
        for p in threshold['percentile_distribution'][:10]:  # Top 10 percentiles
            percentile_data.append([
                f"p{p['percentile']}",
                f"₹{p['value']:,.0f}",
                f"{p['alert_count']:,}",
                f"{p['pct_population']}%"
            ])
        
        table = Table(percentile_data, colWidths=[1.5*inch, 1.5*inch, 1.5*inch, 1.5*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1976d2')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f5f5')])
        ]))
        
        elements.append(table)
        elements.append(Spacer(1, 0.2*inch))
        
        # Selected threshold highlight
        selected_text = f"""
        <b>SELECTED THRESHOLD: ₹{threshold['selected_threshold']:,.0f}</b><br/>
        Percentile: {threshold['selected_percentile']}th<br/>
        Estimated Alerts: {threshold['estimated_alerts']:,} per month<br/>
        Rationale: {threshold['rationale']}
        """
        
        elements.append(Paragraph(selected_text, self.styles['HighlightBox']))
        
        return elements
    
    def _build_governance_section(self, data):
        """Step 4: Governance"""
        elements = []
        
        elements.append(Paragraph("GOVERNANCE & APPROVAL", self.styles['SectionHeader']))
        
        gov = data['governance']
        
        if gov['status'] == 'approved':
            approval_text = f"""
            <b>STATUS:</b> APPROVED<br/>
            <b>Approved By:</b> {gov['approved_by']}<br/>
            <b>Approval Date:</b> {gov['approved_at'][:10]}<br/>
            <b>Comments:</b> {gov.get('approval_comment', 'No comments')}<br/><br/>
            
            This calibration is locked and immutable. Any changes require a new calibration run.
            """
            elements.append(Paragraph(approval_text, self.styles['HighlightBox']))
        else:
            elements.append(Paragraph(
                f"Status: {gov['status'].upper()}",
                self.styles['BodyText']
            ))
        
        return elements
    
    def _build_recommendations(self, data):
        """Recommendations section"""
        elements = []
        
        elements.append(Paragraph("IMPLEMENTATION RECOMMENDATIONS", self.styles['SectionHeader']))
        
        rec = data['recommendations']
        
        rec_list = [
            f"<b>1. Deployment:</b> {rec['deployment']}",
            f"<b>2. Monitoring:</b> {rec['monitoring']}",
            f"<b>3. Review Cadence:</b> {rec['review_cadence']}",
            f"<b>4. Audit Retention:</b> {rec['audit_retention']}",
            f"<b>5. Team Training:</b> {rec['team_training']}"
        ]
        
        for item in rec_list:
            elements.append(Paragraph(item, self.styles['BodyText']))
            elements.append(Spacer(1, 0.1*inch))
        
        return elements