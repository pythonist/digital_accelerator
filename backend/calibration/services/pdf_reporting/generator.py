# backend/calibration/services/pdf_reporting/generator.py
"""
PWC Professional PDF Generator
With logo header on every page
"""
import tempfile
import os
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, PageBreak, Spacer, Paragraph, Image
from reportlab.lib.units import inch
from reportlab.lib import colors

# Import AI service
from calibration.services.ai_explanation_service import AIExplanationService

# Import modular sections
from .sections.cover import build_cover_page
from .sections.executive_summary import build_executive_summary
from .sections.methodology import build_methodology_section
from .sections.thresholds import build_threshold_section
from .sections.governance import build_governance_section
from .styles import ReportTheme

class PDFGeneratorService:
    """PWC Professional PDF Report Generator"""
    
    def __init__(self, ollama_wrapper=None):
        self.ai_service = AIExplanationService(ollama_wrapper) if ollama_wrapper else None
        self.logo_path = self._get_logo_path()
    
    def _get_logo_path(self):
        """Get PWC logo path - update this to your actual logo location"""
        # Option 1: If you have a logo file
        # return '/path/to/pwc_logo.png'
        
        # Option 2: Return None and we'll use text header
        return None
    
    def _create_header_footer(self, canvas, doc):
        """Add PWC header/footer to each page"""
        canvas.saveState()
        
        # Header
        if self.logo_path and os.path.exists(self.logo_path):
            # Draw logo if available
            canvas.drawImage(self.logo_path, 0.75*inch, A4[1] - 0.6*inch, 
                           width=1*inch, height=0.4*inch, preserveAspectRatio=True)
        else:
            # Text header
            canvas.setFont('Helvetica-Bold', 10)
            canvas.setFillColor(ReportTheme.PWC_ORANGE)
            canvas.drawString(0.75*inch, A4[1] - 0.6*inch, "PwC")
        
        # Thin orange line below header
        canvas.setStrokeColor(ReportTheme.PWC_ORANGE)
        canvas.setLineWidth(1.5)
        canvas.line(0.75*inch, A4[1] - 0.7*inch, A4[0] - 0.75*inch, A4[1] - 0.7*inch)
        
        # Footer - page number
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(ReportTheme.TEXT_SECONDARY)
        page_num = canvas.getPageNumber()
        canvas.drawRightString(A4[0] - 0.75*inch, 0.5*inch, f"Page {page_num}")
        
        # Thin grey line above footer
        canvas.setStrokeColor(ReportTheme.BORDER_GREY)
        canvas.setLineWidth(0.5)
        canvas.line(0.75*inch, 0.65*inch, A4[0] - 0.75*inch, 0.65*inch)
        
        canvas.restoreState()
    
    def generate_pdf(self, report_data, output_path=None):
        """Main PDF generation entry point"""
        print("📄 Starting PWC PDF report generation...")
        start_time = datetime.now()
        
        # Setup output file
        if not output_path:
            fd, output_path = tempfile.mkstemp(suffix='.pdf', prefix='pwc_calibration_')
            os.close(fd)
        
        # Setup document with PWC margins
        doc = SimpleDocTemplate(
            output_path,
            pagesize=A4,
            rightMargin=0.75*inch,
            leftMargin=0.75*inch,
            topMargin=0.9*inch,  # Space for header
            bottomMargin=0.85*inch,  # Space for footer
            title=f"Calibration Report - {report_data.get('meta', {}).get('run_id', 'Unknown')}",
            author=report_data.get('meta', {}).get('created_by', 'System')
        )
        
        # Build story
        story = []
        
        print("  → Building cover page...")
        story.extend(build_cover_page(report_data))
        story.append(PageBreak())
        
        print("  → Building executive summary...")
        story.extend(build_executive_summary(report_data, self.ai_service))
        
        print("  → Building methodology section...")
        story.extend(build_methodology_section(report_data, self.ai_service))
        
        print("  → Building threshold section...")
        story.extend(build_threshold_section(report_data, self.ai_service))
        
        print("  → Building governance section...")
        story.extend(build_governance_section(report_data, self.ai_service))
        
        # Generate PDF with header/footer
        print("  → Rendering PDF with PWC branding...")
        doc.build(story, onFirstPage=self._create_header_footer, 
                  onLaterPages=self._create_header_footer)
        
        elapsed = (datetime.now() - start_time).total_seconds()
        file_size_mb = os.path.getsize(output_path) / (1024 * 1024)
        
        print(f"✅ PWC PDF generated successfully!")
        print(f"   Path: {output_path}")
        print(f"   Size: {file_size_mb:.2f} MB")
        print(f"   Time: {elapsed:.1f} seconds")
        
        return output_path
    
    def generate_with_progress(self, report_data, output_path=None, progress_callback=None):
        """Generate with progress tracking"""
        def update_progress(stage, pct, msg):
            if progress_callback:
                progress_callback(stage, pct, msg)
            print(f"  [{pct}%] {msg}")
        
        update_progress('init', 0, 'Initializing PWC PDF generation...')
        
        if not output_path:
            fd, output_path = tempfile.mkstemp(suffix='.pdf', prefix='pwc_calibration_')
            os.close(fd)
        
        doc = SimpleDocTemplate(
            output_path,
            pagesize=A4,
            rightMargin=0.75*inch,
            leftMargin=0.75*inch,
            topMargin=0.9*inch,
            bottomMargin=0.85*inch
        )
        
        story = []
        
        update_progress('cover', 5, 'Building cover page...')
        story.extend(build_cover_page(report_data))
        story.append(PageBreak())
        
        update_progress('summary', 15, 'Generating executive summary...')
        story.extend(build_executive_summary(report_data, self.ai_service))
        
        update_progress('methodology', 40, 'Building methodology...')
        story.extend(build_methodology_section(report_data, self.ai_service))
        
        update_progress('thresholds', 70, 'Building threshold analysis...')
        story.extend(build_threshold_section(report_data, self.ai_service))
        
        update_progress('governance', 90, 'Building governance section...')
        story.extend(build_governance_section(report_data, self.ai_service))
        
        update_progress('render', 95, 'Rendering final PDF...')
        doc.build(story, onFirstPage=self._create_header_footer, 
                  onLaterPages=self._create_header_footer)
        
        update_progress('complete', 100, 'PWC PDF generation complete!')
        
        return output_path