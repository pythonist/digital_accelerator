# backend/calibration/services/pdf_reporting/styles.py
"""
PwC Professional Report Styling - FIXED
Based on PwC brand guidelines
"""
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY

class ReportTheme:
    """PwC Professional color scheme"""
    
    # PwC Brand Colors
    PWC_ORANGE = colors.HexColor('#D04A02')
    PWC_BLACK = colors.HexColor('#000000')
    PWC_DARK_GREY = colors.HexColor('#2C2C2C')
    PWC_MID_GREY = colors.HexColor('#53565A')
    PWC_LIGHT_GREY = colors.HexColor('#BFBFBF')
    
    # Status Colors (minimal use)
    SUCCESS_GREEN = colors.HexColor('#107C41')
    WARNING_AMBER = colors.HexColor('#F7941E')
    ERROR_RED = colors.HexColor('#C5281C')
    
    # Neutral Colors
    TEXT_PRIMARY = colors.HexColor('#2C2C2C')
    TEXT_SECONDARY = colors.HexColor('#53565A')
    BORDER_GREY = colors.HexColor('#E6E6E6')
    BG_LIGHT = colors.HexColor('#FAFAFA')
    BG_WHITE = colors.white
    
    # Aliases for backward compatibility
    PRIMARY_BLUE = PWC_ORANGE  # Use orange as primary
    WARNING_ORANGE = WARNING_AMBER  # Fixed alias
    
    @classmethod
    def get_styles(cls):
        """Get all paragraph styles"""
        styles = getSampleStyleSheet()
        
        # Cover Title
        if 'CoverTitle' not in styles:
            styles.add(ParagraphStyle(
                name='CoverTitle',
                parent=styles['Title'],
                fontSize=24,
                leading=30,
                textColor=cls.PWC_DARK_GREY,
                alignment=TA_CENTER,
                spaceAfter=12,
                fontName='Helvetica-Bold'
            ))
        
        # Cover Subtitle
        if 'CoverSubtitle' not in styles:
            styles.add(ParagraphStyle(
                name='CoverSubtitle',
                parent=styles['Normal'],
                fontSize=12,
                leading=16,
                textColor=cls.PWC_MID_GREY,
                alignment=TA_CENTER,
                spaceAfter=20,
                fontName='Helvetica'
            ))
        
        # Section Headers
        if 'SectionHeader' not in styles:
            styles.add(ParagraphStyle(
                name='SectionHeader',
                parent=styles['Heading1'],
                fontSize=14,
                leading=18,
                textColor=cls.PWC_ORANGE,
                spaceBefore=16,
                spaceAfter=10,
                fontName='Helvetica-Bold',
                borderWidth=0,
                borderPadding=0
            ))
        
        # Subsection Headers
        if 'SubsectionHeader' not in styles:
            styles.add(ParagraphStyle(
                name='SubsectionHeader',
                parent=styles['Heading2'],
                fontSize=11,
                leading=14,
                textColor=cls.PWC_DARK_GREY,
                spaceBefore=10,
                spaceAfter=6,
                fontName='Helvetica-Bold'
            ))
        
        # Body Text
        if 'BodyText' not in styles:
            styles.add(ParagraphStyle(
                name='BodyText',
                parent=styles['Normal'],
                fontSize=9,
                leading=13,
                textColor=cls.TEXT_PRIMARY,
                alignment=TA_JUSTIFY,
                fontName='Helvetica',
                spaceAfter=6
            ))
        
        # Content Text (alias)
        if 'ContentText' not in styles:
            styles.add(ParagraphStyle(
                name='ContentText',
                parent=styles['BodyText']
            ))
        
        # Insight Box (clean, no labels)
        if 'InsightBox' not in styles:
            styles.add(ParagraphStyle(
                name='InsightBox',
                parent=styles['Normal'],
                fontSize=9,
                leading=13,
                textColor=cls.TEXT_PRIMARY,
                alignment=TA_JUSTIFY,
                backColor=cls.BG_LIGHT,
                borderWidth=0,
                borderPadding=12,
                spaceBefore=8,
                spaceAfter=12,
                fontName='Helvetica',
                leftIndent=8,
                rightIndent=8
            ))
        
        # Key Finding Box
        if 'KeyFindingBox' not in styles:
            styles.add(ParagraphStyle(
                name='KeyFindingBox',
                parent=styles['Normal'],
                fontSize=9,
                leading=13,
                textColor=cls.TEXT_PRIMARY,
                alignment=TA_LEFT,
                backColor=cls.BG_LIGHT,
                borderWidth=0.5,
                borderColor=cls.BORDER_GREY,
                borderPadding=12,
                spaceBefore=8,
                spaceAfter=12,
                fontName='Helvetica'
            ))
        
        # Highlight Box
        if 'HighlightBox' not in styles:
            styles.add(ParagraphStyle(
                name='HighlightBox',
                parent=styles['Normal'],
                fontSize=9,
                leading=13,
                textColor=cls.TEXT_PRIMARY,
                alignment=TA_LEFT,
                backColor=cls.BG_LIGHT,
                borderWidth=0,
                borderPadding=12,
                spaceBefore=8,
                spaceAfter=12,
                fontName='Helvetica'
            ))
        
        # Warning Box
        if 'WarningBox' not in styles:
            styles.add(ParagraphStyle(
                name='WarningBox',
                parent=styles['Normal'],
                fontSize=9,
                leading=13,
                textColor=cls.TEXT_PRIMARY,
                backColor=colors.HexColor('#FFF9F0'),
                borderWidth=0.5,
                borderColor=cls.WARNING_AMBER,
                borderPadding=10,
                spaceBefore=8,
                spaceAfter=10,
                fontName='Helvetica'
            ))
        
        # Success Box
        if 'SuccessBox' not in styles:
            styles.add(ParagraphStyle(
                name='SuccessBox',
                parent=styles['Normal'],
                fontSize=9,
                leading=13,
                textColor=cls.TEXT_PRIMARY,
                backColor=colors.HexColor('#F0F8F4'),
                borderWidth=0.5,
                borderColor=cls.SUCCESS_GREEN,
                borderPadding=10,
                spaceBefore=8,
                spaceAfter=10,
                fontName='Helvetica'
            ))
        
        # Table Header
        if 'TableHeader' not in styles:
            styles.add(ParagraphStyle(
                name='TableHeader',
                parent=styles['Normal'],
                fontSize=8,
                textColor=colors.white,
                alignment=TA_CENTER,
                fontName='Helvetica-Bold'
            ))
        
        # Table Cell
        if 'TableCell' not in styles:
            styles.add(ParagraphStyle(
                name='TableCell',
                parent=styles['Normal'],
                fontSize=8,
                textColor=cls.TEXT_PRIMARY,
                alignment=TA_LEFT,
                fontName='Helvetica'
            ))
        
        # Caption
        if 'Caption' not in styles:
            styles.add(ParagraphStyle(
                name='Caption',
                parent=styles['Normal'],
                fontSize=7,
                leading=9,
                textColor=cls.TEXT_SECONDARY,
                alignment=TA_LEFT,
                fontName='Helvetica',
                spaceAfter=4
            ))
        
        # AI Explanation (same as InsightBox)
        if 'AIExplanation' not in styles:
            styles.add(ParagraphStyle(
                name='AIExplanation',
                parent=styles['InsightBox']
            ))
        
        return styles