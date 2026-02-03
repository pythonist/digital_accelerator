# backend/calibration/services/pdf_reporting/sections/governance.py
"""
Enhanced Governance & Recommendations Section
Covers approval, implementation, and future recommendations
"""
from reportlab.platypus import Paragraph, Spacer, PageBreak, KeepTogether
from reportlab.lib.units import inch
from reportlab.lib import colors
from ..styles import ReportTheme
from ..components import (
    create_professional_table,
    create_ai_explanation_box
)

def build_governance_section(data, ai_service=None):
    """
    Generate governance approval and recommendations section
    """
    elements = []
    styles = ReportTheme.get_styles()
    
    # Section divider
    elements.append(PageBreak())
    elements.append(Paragraph("GOVERNANCE & DEPLOYMENT", styles['SectionHeader']))
    
    gov = data.get('governance', {})
    status = gov.get('status', 'draft').lower()
    
    # --- APPROVAL STATUS ---
    elements.extend(_build_approval_status(gov, styles, ai_service))
    elements.append(Spacer(1, 0.4*inch))
    
    # --- IMPLEMENTATION RECOMMENDATIONS ---
    elements.extend(_build_recommendations(data, styles))
    elements.append(Spacer(1, 0.3*inch))
    
    # --- AUDIT TRAIL ---
    elements.extend(_build_audit_trail(data, styles))
    
    return elements


def _build_approval_status(gov, styles, ai_service):
    """Approval status and governance metadata"""
    elements = []
    
    status = gov.get('status', 'draft').lower()
    
    if status == 'approved':
        # APPROVED - Green Success Box
        elements.append(Paragraph("Approval Status", styles['SubsectionHeader']))
        
        approval_text = f"""
        <b><font size="14" color="{ReportTheme.SUCCESS_GREEN}">✓ APPROVED</font></b><br/><br/>
        
        <b>Approved By:</b> {gov.get('approved_by', 'Unknown')}<br/>
        <b>Approval Date:</b> {gov.get('approved_at', 'N/A')[:10] if gov.get('approved_at') else 'N/A'}<br/>
        <b>Approval Time:</b> {gov.get('approved_at', 'N/A')[11:19] if gov.get('approved_at') and len(gov.get('approved_at', '')) > 10 else 'N/A'}<br/><br/>
        
        <b>Approver Comments:</b><br/>
        <i>"{gov.get('approval_comment', 'No comments provided.')}"</i><br/><br/>
        
        <b>Status:</b> This calibration is <b>LOCKED and IMMUTABLE</b>. The configuration has been 
        formally approved for production deployment. Any modifications require a new calibration run 
        with separate approval workflow.
        """
        elements.append(Paragraph(approval_text, styles['SuccessBox']))
        
        # Lock explanation
        lock_explanation = """
        <b>Why Immutability Matters:</b> Once approved, the threshold configuration becomes a locked 
        record for regulatory audit. This prevents unauthorized changes and maintains a clear chain 
        of custody for model governance. The approval timestamp and approver identity are permanently 
        recorded in the audit log.
        """
        elements.append(Spacer(1, 0.15*inch))
        elements.append(Paragraph(lock_explanation, styles['Caption']))
        
    elif status == 'rejected':
        # REJECTED - Red Warning Box
        elements.append(Paragraph("Approval Status", styles['SubsectionHeader']))
        
        rejection_text = f"""
        <b><font size="14" color="{ReportTheme.ERROR_RED}">✗ REJECTED</font></b><br/><br/>
        
        <b>Rejected By:</b> {gov.get('approved_by', 'Unknown')}<br/>
        <b>Rejection Date:</b> {gov.get('approved_at', 'N/A')[:10] if gov.get('approved_at') else 'N/A'}<br/><br/>
        
        <b>Rejection Reason:</b><br/>
        <i>"{gov.get('approval_comment', 'No reason provided.')}"</i><br/><br/>
        
        <b>Next Steps:</b> Recalibration required. Address the rejection comments and submit a new 
        calibration run for approval.
        """
        elements.append(Paragraph(rejection_text, styles['WarningBox']))
        
    else:
        # DRAFT/PENDING
        elements.append(Paragraph("Approval Status", styles['SubsectionHeader']))
        
        draft_text = f"""
        <b><font size="12" color="{ReportTheme.WARNING_ORANGE}">⚠ PENDING APPROVAL</font></b><br/><br/>
        
        <b>Status:</b> This calibration is in <b>DRAFT</b> status and has not yet been formally approved.<br/><br/>
        
        <b>Required Action:</b> Submit for approval by authorized signatory (Compliance Head, Risk Manager, 
        or Model Governance Officer) before production deployment.
        """
        elements.append(Paragraph(draft_text, styles['WarningBox']))
    
    # AI Explanation for approved runs
    if status == 'approved' and ai_service:
        ai_text = ai_service.explain_governance_decision(gov)
        if ai_text:
            elements.append(Spacer(1, 0.15*inch))
            ai_box = create_ai_explanation_box(ai_text)
            if ai_box:
                elements.append(ai_box)
    
    return elements


def _build_recommendations(data, styles):
    """Implementation and monitoring recommendations"""
    elements = []
    
    elements.append(Paragraph("Implementation Roadmap", styles['SubsectionHeader']))
    elements.append(Paragraph(
        "The following recommendations provide a structured approach to deploying this calibration "
        "in production and establishing ongoing monitoring practices.",
        styles['BodyText']
    ))
    elements.append(Spacer(1, 0.15*inch))
    
    rec = data.get('recommendations', {})
    
    # Structured recommendations table
    rec_data = [['Phase', 'Activity', 'Timeline', 'Owner']]
    
    recommendations = [
        {
            'phase': '1. Deployment',
            'activity': rec.get('deployment', 'Deploy in staging for pilot testing'),
            'timeline': '30 days',
            'owner': 'Technology Team'
        },
        {
            'phase': '2. Monitoring',
            'activity': rec.get('monitoring', 'Track actual alert volume vs estimates'),
            'timeline': 'Daily (first 30 days)',
            'owner': 'Compliance Team'
        },
        {
            'phase': '3. Review',
            'activity': rec.get('review_cadence', 'Quarterly recalibration review'),
            'timeline': 'Every 90 days',
            'owner': 'Model Governance'
        },
        {
            'phase': '4. Documentation',
            'activity': rec.get('audit_retention', 'Maintain audit trail and evidence'),
            'timeline': 'Ongoing',
            'owner': 'Compliance Team'
        },
        {
            'phase': '5. Training',
            'activity': rec.get('team_training', 'Brief investigators on methodology'),
            'timeline': 'Before go-live',
            'owner': 'Training Team'
        }
    ]
    
    for item in recommendations:
        rec_data.append([
            item['phase'],
            item['activity'],
            item['timeline'],
            item['owner']
        ])
    
    table = create_professional_table(
        rec_data,
        col_widths=[1.25*inch, 2.75*inch, 1*inch, 1*inch]
    )
    elements.append(table)
    elements.append(Spacer(1, 0.2*inch))
    
    # Critical Success Factors
    csf_text = """
    <b>Critical Success Factors for Deployment:</b><br/><br/>
    • <b>Pilot Testing:</b> Always test in staging with representative data before production<br/>
    • <b>Alert Quality:</b> Monitor false positive rates and investigator feedback closely<br/>
    • <b>Behavioral Drift:</b> Watch for sudden changes in alert volume (may indicate data/behavioral shifts)<br/>
    • <b>Documentation:</b> Maintain this report and all supporting evidence for regulatory inspection<br/>
    • <b>Recalibration Triggers:</b> Recalibrate if alert volume deviates >30% from estimate for 3+ consecutive periods
    """
    elements.append(Paragraph(csf_text, styles['WarningBox']))
    
    return elements


def _build_audit_trail(data, styles):
    """Audit trail and compliance footer"""
    elements = []
    
    elements.append(Spacer(1, 0.3*inch))
    elements.append(Paragraph("Audit & Compliance Information", styles['SubsectionHeader']))
    
    meta = data.get('meta', {})
    
    audit_data = [
        ['Audit Field', 'Value'],
        ['Run ID', meta.get('run_id', 'N/A')],
        ['Environment', meta.get('env_id', 'N/A')],
        ['Created By', meta.get('created_by', 'System')],
        ['Creation Date', meta.get('created_at', 'N/A')[:10] if meta.get('created_at') else 'N/A'],
        ['Report Generated', meta.get('generated_at', 'N/A')[:19] if meta.get('generated_at') else 'N/A'],
        ['Report Version', '1.0'],
        ['Methodology', 'Percentile-based Statistical Calibration'],
        ['Retention Period', '7 years (regulatory requirement)']
    ]
    
    table = create_professional_table(
        audit_data,
        col_widths=[2*inch, 4*inch]
    )
    elements.append(table)
    elements.append(Spacer(1, 0.2*inch))
    
    # Regulatory compliance statement
    compliance_text = """
    <b>Regulatory Compliance Statement:</b> This calibration report has been generated in accordance 
    with model governance best practices and regulatory expectations for AML transaction monitoring 
    systems. The methodology, data lineage, and decision rationale are fully documented and 
    independently reproducible. This report serves as evidence of sound model risk management practices.
    """
    elements.append(Paragraph(compliance_text, styles['Caption']))
    
    return elements