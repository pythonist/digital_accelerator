# backend/calibration/services/pdf_reporting/sections/cover.py
"""
Professional Cover Page - PwC Style
"""
from reportlab.platypus import Spacer, Paragraph, Table, TableStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from datetime import datetime
from ..styles import ReportTheme

def build_cover_page(data):
    """Generate professional cover page"""
    styles = ReportTheme.get_styles()
    elements = []
    
    # Top spacing
    elements.append(Spacer(1, 1.5*inch))
    
    # Main title
    elements.append(Paragraph(
        "AML THRESHOLD CALIBRATION REPORT",
        styles['CoverTitle']
    ))
    
    # Subtitle
    scenario_name = data.get('meta', {}).get('scenario', 'Unknown Scenario')
    elements.append(Paragraph(
        f"Scenario: {scenario_name}",
        styles['CoverSubtitle']
    ))
    
    elements.append(Spacer(1, 0.8*inch))
    
    # Status badge
    status = data.get('governance', {}).get('status', 'draft').upper()
    status_color_map = {
        'APPROVED': ReportTheme.SUCCESS_GREEN,
        'REJECTED': ReportTheme.ERROR_RED,
        'DRAFT': ReportTheme.WARNING_AMBER  # Fixed: Use WARNING_AMBER instead of WARNING_ORANGE
    }
    status_color = status_color_map.get(status, ReportTheme.TEXT_SECONDARY)
    
    # Format status color for inline use
    status_hex = status_color.hexval() if hasattr(status_color, 'hexval') else '#53565A'
    status_text = f'<font size="14" color="{status_hex}"><b>STATUS: {status}</b></font>'
    elements.append(Paragraph(status_text, styles['BodyText']))
    elements.append(Spacer(1, 0.6*inch))
    
    # Metadata table
    meta = data.get('meta', {})
    gov = data.get('governance', {})
    
    metadata = [
        ['Field', 'Value'],
        ['Run ID', meta.get('run_id', 'N/A')],
        ['Created By', meta.get('created_by', 'System')],
        ['Creation Date', meta.get('created_at', 'N/A')[:10] if meta.get('created_at') else 'N/A'],
        ['Report Generated', datetime.now().strftime('%Y-%m-%d %H:%M')],
        ['Status', status]
    ]
    
    if status == 'APPROVED':
        metadata.append(['Approved By', gov.get('approved_by', 'N/A')])
        metadata.append(['Approval Date', gov.get('approved_at', 'N/A')[:10] if gov.get('approved_at') else 'N/A'])
    
    table = Table(metadata, colWidths=[2*inch, 3.5*inch])
    table.setStyle(TableStyle([
        # Orange header
        ('BACKGROUND', (0, 0), (-1, 0), ReportTheme.PWC_ORANGE),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, ReportTheme.BORDER_GREY),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, ReportTheme.BG_LIGHT])
    ]))
    
    elements.append(table)
    elements.append(Spacer(1, 0.8*inch))
    
    # Confidentiality notice
    confidentiality = """
    <b>CONFIDENTIAL</b><br/>
    This report contains proprietary calibration methodology and operational data. 
    Distribution is restricted to authorized personnel and regulatory authorities only.
    """
    elements.append(Paragraph(confidentiality, styles['Caption']))
    
    return elements