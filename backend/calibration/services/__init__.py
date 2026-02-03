# backend/calibration/services/__init__.py
"""
Calibration Services Layer
Orchestrates engines and manages business logic
"""

# --- Core DB & Ingestion ---
from .calibration_db_schema import CalibrationDatabaseManager
from .calibration_data_ingestion import CalibrationDataIngestionService
# from .golden_dataset_builder import GoldenDatasetBuilder
from .run_manager import CalibrationRunManager
from .step0_step1_bridge_service import Step0Step1BridgeService
# --- Orchestration Services ---
from .data_preview_service import DataPreviewService
from .population_explorer_service import PopulationExplorerService
from .aggregation_service import AggregationService
from .threshold_service import ThresholdService
from .comparison_service import ComparisonService

#calibration screen services
from .calibration_outcome_service import CalibrationOutcomeService
from .calibration_distribution_service import CalibrationDistributionService
from .calibration_impact_service import CalibrationImpactService
from .calibration_comparison_service import CalibrationComparisonService
from .calibration_str_evaluation_service import CalibrationSTREvaluationService
#calibration KS services
from .calibration_ks_service import CalibrationKSService
from .calibration_ks_narrative_service import CalibrationKSNarrativeService
from .calibration_ks_visualization_service import CalibrationKSVisualizationService
from .calibration_atl_btl_service import CalibrationATLBTLService
from .population_materialization_service import PopulationMaterializationService
from .population_narrative_service import PopulationNarrativeService
from .scenario_catalog_service import ScenarioCatalogService

# --- Step 2: Aggregation Services (NEW) ---
from .aggregation_config_service import AggregationConfigService
from .aggregation_stats_service import AggregationStatsService
from .aggregation_visual_service import AggregationVisualService
from .aggregation_narrative_service import AggregationNarrativeService
from .aggregation_health_service import AggregationHealthService
from .aggregation_validator_service import AggregationValidatorService
from .aggregation_insight_service import AggregationInsightService

#report service
from .approval_service import ApprovalService
from .report_data_service import ReportDataService
# backend/calibration/services/pdf_reporting/__init__.py
from .pdf_reporting import PDFGeneratorService


__all__ = [
    # Core
    'CalibrationDatabaseManager',
    'CalibrationDataIngestionService',
    # 'GoldenDatasetBuilder',
    'CalibrationRunManager',
    'Step0Step1BridgeService',

    # Services
    'DataPreviewService',
    'AggregationService',
    'ThresholdService',
    'ComparisonService',

    # Step 1: Population Exploration
    'PopulationExplorerService',
    'PopulationMaterializationService',
    'PopulationNarrativeService',
    'ScenarioCatalogService',
    
    # Step 2: Aggregation (Enhanced)
    'AggregationConfigService',
    'AggregationStatsService',
    'AggregationVisualService',
    'AggregationNarrativeService',
    'AggregationHealthService',
    'AggregationValidatorService',
    'AggregationInsightService',

    # Step 3: Calibration Screen
    'CalibrationComparisonService',
    'CalibrationImpactService',
    'CalibrationDistributionService',
    'CalibrationOutcomeService',
    'CalibrationSTREvaluationService',
    #ks services
    'CalibrationKSService',
    'CalibrationKSNarrativeService',
    'CalibrationKSVisualizationService',
    #atl btl service
    'CalibrationATLBTLService',

    #approval and report
    'ApprovalService',
    'ReportDataService',
    'PDFGeneratorService'
]