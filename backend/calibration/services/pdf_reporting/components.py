# backend/calibration/services/pdf_reporting/components.py
"""
PwC Professional Components - Clean & Minimal
NO "AI Explanation" labels - just clean content
"""
from reportlab.platypus import Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib import colors
from reportlab.lib.units import inch
from .styles import ReportTheme
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import io
import re
import tempfile
import os

def get_mpl_color(rl_color):
    """Convert ReportLab color to Matplotlib hex"""
    try:
        hex_val = str(rl_color.hexval())
        if hex_val.startswith('0x'):
            return '#' + hex_val[2:]
        return hex_val
    except:
        return '#000000'

def create_professional_table(data, col_widths=None, highlight_rows=None, has_totals=False):
    """PwC-style table with orange header"""
    if not data or len(data) == 0:
        return Paragraph("No data available", ReportTheme.get_styles()['ContentText'])
    
    styles = ReportTheme.get_styles()
    formatted_data = []
    
    # Header
    header = [Paragraph(f"<b>{str(cell)}</b>", styles['TableHeader']) for cell in data[0]]
    formatted_data.append(header)
    
    # Body
    for i, row in enumerate(data[1:], start=1):
        formatted_row = []
        for cell in row:
            if isinstance(cell, str):
                formatted_row.append(Paragraph(str(cell), styles['TableCell']))
            else:
                formatted_row.append(str(cell))
        formatted_data.append(formatted_row)
    
    table = Table(formatted_data, colWidths=col_widths, repeatRows=1)
    
    # PwC orange header style
    table_style = [
        ('BACKGROUND', (0, 0), (-1, 0), ReportTheme.PWC_ORANGE),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, 0), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('ALIGN', (0, 1), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('TOPPADDING', (0, 1), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEBELOW', (0, 0), (-1, 0), 1, ReportTheme.PWC_ORANGE),
        ('LINEBELOW', (0, 1), (-1, -1), 0.5, ReportTheme.BORDER_GREY),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, ReportTheme.BG_LIGHT])
    ]
    
    if highlight_rows:
        for row_idx in highlight_rows:
            table_style.append(('BACKGROUND', (0, row_idx), (-1, row_idx), colors.HexColor('#FFF5F0')))
    
    if has_totals and len(data) > 1:
        table_style.extend([
            ('BACKGROUND', (0, -1), (-1, -1), ReportTheme.BG_LIGHT),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('LINEABOVE', (0, -1), (-1, -1), 1, ReportTheme.PWC_DARK_GREY)
        ])
    
    table.setStyle(TableStyle(table_style))
    return table


def create_metric_card_table(metrics):
    """Clean metric cards"""
    styles = ReportTheme.get_styles()
    rows = []
    current_row = []
    
    for i, metric in enumerate(metrics):
        label = metric.get('label', '')
        value = metric.get('value', '')
        color = metric.get('color', get_mpl_color(ReportTheme.PWC_DARK_GREY))
        
        cell_content = [
            Paragraph(f'<font size="7" color="{get_mpl_color(ReportTheme.TEXT_SECONDARY)}">{label}</font>', styles['ContentText']),
            Spacer(1, 3),
            Paragraph(f'<font size="11" color="{color}"><b>{value}</b></font>', styles['ContentText'])
        ]
        
        current_row.append(cell_content)
        
        if (i + 1) % 3 == 0 or i == len(metrics) - 1:
            while len(current_row) < 3:
                current_row.append('')
            rows.append(current_row)
            current_row = []
    
    table = Table(rows, colWidths=[2*inch, 2*inch, 2*inch])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.white),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('BOX', (0, 0), (-1, -1), 0.5, ReportTheme.BORDER_GREY),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, ReportTheme.BORDER_GREY)
    ]))
    
    return table


def create_filter_summary_table(filters_dict):
    """Clean filter summary"""
    if not filters_dict:
        return Paragraph("No filters applied", ReportTheme.get_styles()['ContentText'])
    
    table_data = [['Filter Category', 'Condition', 'Applied Values']]
    
    for category, conditions in filters_dict.items():
        if isinstance(conditions, dict):
            for field, value in conditions.items():
                if value and value != '' and value != []:
                    field_name = field.replace('_', ' ').title()
                    if isinstance(value, list):
                        value_str = ', '.join(str(v) for v in value)
                    else:
                        value_str = str(value)
                    cat_name = category.replace('_filters', '').replace('_', ' ').title()
                    table_data.append([cat_name, field_name, value_str])
        elif isinstance(conditions, str) and conditions:
            cat_name = category.replace('_', ' ').title()
            table_data.append([cat_name, 'Value', conditions])
    
    if len(table_data) == 1:
        return Paragraph("No filters applied", ReportTheme.get_styles()['ContentText'])
    
    return create_professional_table(table_data, col_widths=[1.5*inch, 2*inch, 2.5*inch])


def create_matplotlib_chart(chart_type, data, title='', xlabel='', ylabel='', filename=None):
    """PwC-style charts"""
    fig, ax = plt.subplots(figsize=(6, 3.5))
    
    orange = get_mpl_color(ReportTheme.PWC_ORANGE)
    dark_grey = get_mpl_color(ReportTheme.PWC_DARK_GREY)
    
    if chart_type == 'bar':
        x_vals = data.get('x', [])
        y_vals = data.get('y', [])
        ax.bar(x_vals, y_vals, color=orange, alpha=0.9)
        ax.set_xlabel(xlabel, fontsize=8, color=dark_grey)
        ax.set_ylabel(ylabel, fontsize=8, color=dark_grey)
        plt.xticks(rotation=45, ha='right', fontsize=7)
    
    elif chart_type == 'line':
        x_vals = data.get('x', [])
        y_vals = data.get('y', [])
        ax.plot(x_vals, y_vals, color=orange, linewidth=2, marker='o', markersize=4)
        ax.set_xlabel(xlabel, fontsize=8, color=dark_grey)
        ax.set_ylabel(ylabel, fontsize=8, color=dark_grey)
        ax.grid(True, alpha=0.2, linestyle='--')
    
    elif chart_type == 'histogram':
        values = data.get('values', [])
        ax.hist(values, bins=data.get('bins', 30), color=orange, alpha=0.8, edgecolor=dark_grey)
        ax.set_xlabel(xlabel, fontsize=8, color=dark_grey)
        ax.set_ylabel(ylabel, fontsize=8, color=dark_grey)
    
    ax.set_title(title, fontsize=9, fontweight='bold', color=dark_grey, pad=8)
    ax.tick_params(labelsize=7, colors=dark_grey)
    plt.tight_layout()
    
    if not filename:
        fd, filename = tempfile.mkstemp(suffix='.png')
        os.close(fd)
    
    plt.savefig(filename, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close()
    
    return Image(filename, width=5.5*inch, height=3.2*inch)


def create_percentile_ladder_chart(percentile_data):
    """PwC-style percentile visualization"""
    if not percentile_data:
        return Paragraph("No percentile data available", ReportTheme.get_styles()['ContentText'])
    
    sorted_data = sorted(percentile_data, key=lambda x: x.get('percentile', 0))
    percentiles = [p.get('percentile', 0) for p in sorted_data]
    thresholds = [p.get('value', p.get('threshold', 0)) for p in sorted_data]
    alerts = [p.get('alert_count', p.get('alerts', 0)) for p in sorted_data]
    
    fig, ax1 = plt.subplots(figsize=(6, 3.5))
    
    orange = get_mpl_color(ReportTheme.PWC_ORANGE)
    dark_grey = get_mpl_color(ReportTheme.PWC_DARK_GREY)
    
    ax1.set_xlabel('Percentile', fontsize=8, color=dark_grey)
    ax1.set_ylabel('Threshold Value (₹)', color=orange, fontsize=8)
    ax1.plot(percentiles, thresholds, color=orange, linewidth=2, marker='o', markersize=4)
    ax1.tick_params(axis='y', labelcolor=orange, labelsize=7)
    ax1.tick_params(axis='x', labelsize=7, colors=dark_grey)
    ax1.grid(True, alpha=0.2, linestyle='--')
    
    ax2 = ax1.twinx()
    ax2.set_ylabel('Alert Count', color=dark_grey, fontsize=8)
    ax2.plot(percentiles, alerts, color=dark_grey, linewidth=2, marker='s', markersize=4, linestyle='--')
    ax2.tick_params(axis='y', labelcolor=dark_grey, labelsize=7)
    
    fig.tight_layout()
    plt.title('Percentile Ladder Analysis', fontsize=9, fontweight='bold', color=dark_grey, pad=8)
    
    fd, filename = tempfile.mkstemp(suffix='.png')
    os.close(fd)
    
    plt.savefig(filename, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close()
    
    return Image(filename, width=5.5*inch, height=3.2*inch)


def clean_ai_markdown(text):
    """Clean text formatting"""
    if not text:
        return ""
    text = re.sub(r'\*\*([^\*]+)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'\*([^\*]+)\*', r'<i>\1</i>', text)
    text = re.sub(r'\n\n+', '<br/><br/>', text)
    text = re.sub(r'\n', ' ', text)
    return text


def create_ai_explanation_box(ai_text):
    """
    Clean insight box - NO "AI Explanation" label
    Just clean formatted content in gray box
    """
    if not ai_text:
        return None
    
    clean_text = clean_ai_markdown(ai_text)
    styles = ReportTheme.get_styles()
    
    # Just the text - no label
    return Paragraph(clean_text, styles['InsightBox'])