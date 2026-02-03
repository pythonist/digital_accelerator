# backend/calibration/services/pdf_reporting/sections/__init__.py

from .cover import build_cover_page
from .executive_summary import build_executive_summary
from .methodology import build_methodology_section
from .thresholds import build_threshold_section  # Added this
from .governance import build_governance_section

__all__ = [
    'build_cover_page',
    'build_executive_summary',
    'build_methodology_section',
    'build_threshold_section',
    'build_governance_section'
]