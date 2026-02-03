# backend/api/services.py
"""
Service Container: Tenant-Aware Service Management
✅ Combines stateless factories + full legacy activation
✅ Includes Step 0 Data Foundation services
"""

import traceback
import os
import sys
import threading

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from config import CALIBRATION_DB_PATH

# --- CORE ---
from services.metadata_manager import MetadataManager
from services.db_schema import DatabaseManager
from services.data_ingestion import DataIngestionService
from services.smart_merge import SmartMergeService
from services.data_cleaning import DataCleaningService
from rules.rule_engine import UniversalRuleEngine
from typology.typology_detector import TypologyService
from services.ai_master_builder import AIMasterBuilder
from llm.ollama_wrapper import OllamaWrapper
from case_pack.case_pack_generator import CasePackGenerator
from llm.doc_rag import DocRAGSystem
from llm.vector_rag import VectorRAGSystem
from graph_engine.graph_builder import TransactionGraphBuilder
from baseline.baseline_engine import BaselineEngine
from services.focus_engine import FocusEngine

# Calibration services
from calibration.services.calibration_db_schema import CalibrationDatabaseManager
from calibration.services.calibration_data_ingestion import CalibrationDataIngestionService
from calibration.services.calibration_outcome_service import CalibrationOutcomeService
from calibration.services.calibration_str_evaluation_service import CalibrationSTREvaluationService

from calibration.services.calibration_ks_service import CalibrationKSService
from calibration.services.calibration_ks_visualization_service import CalibrationKSVisualizationService
from calibration.services.calibration_ks_narrative_service import CalibrationKSNarrativeService

from calibration.services.calibration_atl_btl_service import CalibrationATLBTLService

# Step 1: Population exploration services
from calibration.services.population_explorer_service import PopulationExplorerService
from calibration.services.scenario_catalog_service import ScenarioCatalogService
from calibration.services.population_stats_service import PopulationStatsService
from calibration.services.population_narrative_service import PopulationNarrativeService
from calibration.services.population_materialization_service import PopulationMaterializationService

# Step 2: Aggregation services
from calibration.services.aggregation_service import AggregationService
from calibration.builder.percentile_engine import PercentileEngine
from calibration.builder.threshold_simulator import ThresholdSimulator

from calibration.services.join_validation_service import JoinValidationService
from calibration.services.data_readiness_service import DataReadinessService
from calibration.services.calibration_distribution_service import CalibrationDistributionService
from calibration.services.calibration_impact_service import CalibrationImpactService
from calibration.services.calibration_comparison_service import CalibrationComparisonService

from calibration.services.aggregation_config_service import AggregationConfigService
from calibration.services.aggregation_stats_service import AggregationStatsService
from calibration.services.aggregation_visual_service import AggregationVisualService
from calibration.services.aggregation_narrative_service import AggregationNarrativeService
from calibration.services.aggregation_health_service import AggregationHealthService
from calibration.services.aggregation_validator_service import AggregationValidatorService
from calibration.services.aggregation_insight_service import AggregationInsightService

from calibration.services.report_data_service import ReportDataService
from calibration.services.approval_service import ApprovalService
from calibration.services.pdf_reporting import PDFGeneratorService
from calibration.db_migrations import run_migrations

# ✅ NEW: Step 0 Data Foundation Services
from calibration.services.data_step_zero_services import (
    DatasetManager,
    SchemaService,
    LogicalMergeService,
    SQLExecutionService,
    DataReadinessService as Step0ReadinessService
)


class ServiceContainer:
    def __init__(self):
        self.metadata_manager = None

        # Global / legacy state
        self.investigation_db = None
        self.calibration_db = None

        # Investigation Tool Services
        self.data_ingestion = None
        self.rule_engine = None
        self.smart_merge_service = None
        self.ai_builder = None
        self.data_cleaning = None
        self.typology_detector = None
        self.ollama_wrapper = None
        self.case_pack_generator = None
        self.doc_rag_system = None
        self.rag_system = None
        self.graph_builder = None
        self.baseline_engine = None
        self.focus_engine = None

        # Old Calibration (backwards compatibility)
        self.calibration_engine = None
        self.approval_workflow = None
        self.investigator_context = None

        # Calibration Tool Services
        self.calibration_db_manager = None
        self.calibration_ingestion = None
        self.golden_builder = None
        self.scenario_engine = None
        self.aggregation_engine = None
        self.percentile_engine = None
        self.threshold_simulator = None

        # ✅ NEW: Step 0 Services (cached instances)
        self._dataset_manager = None
        self._schema_service = None
        self._logical_merge_service = None
        self._sql_execution_service = None
        self._step0_readiness_service = None

    # ---------------------------------------------------
    # SYSTEM INIT
    # ---------------------------------------------------
    def init_services(self):
        try:
            print("🔧 System Startup...")
            self.metadata_manager = MetadataManager()

            if OllamaWrapper:
                self.ollama_wrapper = OllamaWrapper()

            if DocRAGSystem and self.ollama_wrapper:
                self.doc_rag_system = DocRAGSystem(self.ollama_wrapper)
                if not self.doc_rag_system.index:
                    threading.Thread(
                        target=self.doc_rag_system.build_documentation_index,
                        daemon=True
                    ).start()

            # Initialize Calibration Tool Services
            if CalibrationDatabaseManager:
                self.calibration_db_manager = CalibrationDatabaseManager()
                print("✅ Calibration DB initialized")
                try:
                    conn = self.calibration_db_manager.connect()
                    run_migrations(conn)
                    conn.close()
                    print("✅ Calibration DB migrations applied")
                except Exception:
                    print("❌ Calibration DB migration failed")
                    traceback.print_exc()
                    raise
                
                if CalibrationDataIngestionService:
                    self.calibration_ingestion = CalibrationDataIngestionService(self.calibration_db_manager)
                
                if PercentileEngine:
                    self.percentile_engine = PercentileEngine(self.calibration_db_manager)
                
                if ThresholdSimulator:
                    self.threshold_simulator = ThresholdSimulator(self.calibration_db_manager)

            print("✅ Core System Ready.")
            return True
        except Exception:
            traceback.print_exc()
            return False

    # ---------------------------------------------------
    # STATELESS DB FACTORY (CRITICAL)
    # ---------------------------------------------------
    def get_investigation_db(self, env_id: str, tenant_id: str) -> DatabaseManager:
        if not env_id:
            raise ValueError("Environment ID required")

        paths = [
            f"data/environments/{env_id}/database.db",
            f"data/environments/{env_id}/investigation.db",
            f"data/{tenant_id}/{env_id}/database.db",
            f"backend/data/environments/{env_id}/database.db",
        ]

        for p in paths:
            if os.path.exists(p):
                return DatabaseManager(p)

        # Fallback (legacy global)
        if (
            self.metadata_manager
            and self.metadata_manager.active_env == env_id
            and self.investigation_db
        ):
            return self.investigation_db

        raise FileNotFoundError(f"Database not found for env: {env_id}")

    # ---------------------------------------------------
    # STATELESS INGESTION FACTORY (FIXES UPLOAD BUG)
    # ---------------------------------------------------
    def get_data_ingestion_service(self, env_id: str, tenant_id: str):
        if not DataIngestionService:
            raise ImportError("DataIngestionService unavailable")

        db = self.get_investigation_db(env_id, tenant_id)
        return DataIngestionService(db)

    # # ---------------------------------------------------
    # # ✅ NEW: STEP 0 SERVICE FACTORIES
    # # ---------------------------------------------------
    
    # def get_dataset_manager(self):
    #     """Get dataset manager instance (singleton pattern)"""
    #     if not self._dataset_manager:
    #         db = self.get_calibration_db()
    #         self._dataset_manager = DatasetManager(db)
    #     return self._dataset_manager
    
    # def get_schema_service(self):
    #     """Get schema service instance (singleton pattern)"""
    #     if not self._schema_service:
    #         db = self.get_calibration_db()
    #         self._schema_service = SchemaService(db)
    #     return self._schema_service
    
    # def get_logical_merge_service(self):
    #     """Get logical merge service instance"""
    #     if not self._logical_merge_service:
    #         db = self.get_calibration_db()
            
    #         # ✅ FIX: Get the Schema Service first
    #         schema_service = self.get_schema_service()
            
    #         # (Optional) Pass Ollama as a 3rd arg if you add AI later, 
    #         # but strictly match the __init__ signature for now.
            
    #         self._logical_merge_service = LogicalMergeService(db, schema_service)
            
    #     return self._logical_merge_service
    
    # def get_sql_execution_service(self):
    #     """Get SQL execution service instance"""
    #     if not self._sql_execution_service:
    #         db = self.get_calibration_db()
    #         self._sql_execution_service = SQLExecutionService(db)
    #     return self._sql_execution_service
    
    # def get_step0_readiness_service(self):
    #     """Get Step 0 readiness service instance"""
    #     if not self._step0_readiness_service:
    #         db = self.get_calibration_db()
    #         self._step0_readiness_service = Step0ReadinessService(db)
    #     return self._step0_readiness_service

    # ---------------------------------------------------
    # LEGACY / ADMIN CASE ACTIVATION
    # ---------------------------------------------------
    def activate_case(self, case_name: str, tenant_id: str):
        if not tenant_id:
            raise ValueError("Tenant ID required")

        try:
            print(f"🚀 Activating Environment: {case_name} | Tenant: {tenant_id}")
            env_info = self.metadata_manager.activate_environment(case_name, tenant_id)
            paths = env_info.get("paths", {})

            if not paths:
                root = env_info.get("db_path", "").replace("aml_database.db", "")
                paths = {
                    "investigation_db": env_info.get("db_path"),
                    "vector_store": os.path.join(root, "investigation", "vector_store"),
                }

            if env_info.get("tenant_id") != tenant_id:
                raise Exception("Tenant mismatch")

            # DBs
            self.investigation_db = DatabaseManager(paths["investigation_db"])
            self.investigation_db.init_schema()

            self.calibration_db = DatabaseManager(CALIBRATION_DB_PATH)

            # Bind Investigation Tool services
            if DataIngestionService:
                self.data_ingestion = DataIngestionService(self.investigation_db)
            if UniversalRuleEngine:
                self.rule_engine = UniversalRuleEngine(self.investigation_db)
            if TypologyService:
                self.typology_detector = TypologyService(self.investigation_db)
            if DataCleaningService:
                self.data_cleaning = DataCleaningService(self.investigation_db)
            if AIMasterBuilder:
                self.ai_builder = AIMasterBuilder(self.investigation_db)
            if SmartMergeService:
                self.smart_merge_service = SmartMergeService(
                    self.investigation_db, self.ollama_wrapper
                )
            if CasePackGenerator:
                self.case_pack_generator = CasePackGenerator(self.investigation_db)
            if TransactionGraphBuilder:
                self.graph_builder = TransactionGraphBuilder(self.investigation_db)
            if BaselineEngine:
                self.baseline_engine = BaselineEngine(self.investigation_db)
            if FocusEngine:
                self.focus_engine = FocusEngine(self.investigation_db)

            # Vector RAG
            if VectorRAGSystem:
                self.rag_system = VectorRAGSystem(
                    self.investigation_db,
                    vector_store_path=paths.get("vector_store")
                )
                self.rag_system.load_index()

            print("✅ Environment Activated Successfully")
            return env_info

        except Exception as e:
            traceback.print_exc()
            raise Exception(f"Failed to activate case: {e}")

#####             NEW ################
        # Replace these methods in backend/api/services.py

    def get_dataset_manager(self):
        if not hasattr(self, '_dataset_manager') or self._dataset_manager is None:
            from calibration.services.data_step_zero_services import DatasetManager
            db = self.get_calibration_db()
            self._dataset_manager = DatasetManager(db)  # ONLY ONE ARGUMENT!
        return self._dataset_manager

    def get_schema_service(self):
        if not hasattr(self, '_schema_service') or self._schema_service is None:
            from calibration.services.data_step_zero_services import SchemaService
            db = self.get_calibration_db()
            self._schema_service = SchemaService(db)
        return self._schema_service

    def get_logical_merge_service(self):
        if not hasattr(self, '_logical_merge_service') or self._logical_merge_service is None:
            from calibration.services.data_step_zero_services import LogicalMergeService
            db = self.get_calibration_db()
            schema_service = self.get_schema_service()
            self._logical_merge_service = LogicalMergeService(db, schema_service)
        return self._logical_merge_service

    def get_sql_execution_service(self):
        if not hasattr(self, '_sql_execution_service') or self._sql_execution_service is None:
            from calibration.services.data_step_zero_services import SQLExecutionService
            db = self.get_calibration_db()
            self._sql_execution_service = SQLExecutionService(db)
        return self._sql_execution_service

    def get_step0_readiness_service(self):
        if not hasattr(self, '_step0_readiness_service') or self._step0_readiness_service is None:
            from calibration.services.data_step_zero_services import DataReadinessService
            db = self.get_calibration_db()
            self._step0_readiness_service = DataReadinessService(db)
        return self._step0_readiness_service

    def get_bridge_service(self):
        if not hasattr(self, '_bridge_service') or self._bridge_service is None:
            from calibration.services.step0_step1_bridge_service import Step0Step1BridgeService
            db = self.get_calibration_db()
            self._bridge_service = Step0Step1BridgeService(db)
        return self._bridge_service

    # ---------------------------------------------------
    # CALIBRATION TOOL SERVICE FACTORIES
    # ---------------------------------------------------
    def get_calibration_db(self):
        """Get calibration database manager"""
        if not self.calibration_db_manager:
            if CalibrationDatabaseManager:
                self.calibration_db_manager = CalibrationDatabaseManager()
        return self.calibration_db_manager
    
    # def get_calibration_ingestion(self, env_id: str):
    #     db = self.get_calibration_db()
    #     ingestion = CalibrationDataIngestionService(db)
    #     ingestion.set_environment_data_dir(env_id)
    #     return ingestion

    # def get_join_validation_service(self):
    #     """Get join validation service instance"""
    #     if not hasattr(self, '_join_validation_service'):
    #         db = self.get_calibration_db()
    #         self._join_validation_service = JoinValidationService(db)
    #     return self._join_validation_service

    # def get_data_readiness_service(self):
    #     """Get data readiness service instance"""
    #     if not hasattr(self, '_data_readiness_service'):
    #         db = self.get_calibration_db()
    #         self._data_readiness_service = DataReadinessService(db)
    #     return self._data_readiness_service
    
    def get_scenario_catalog_service(self):
        """Get scenario catalog service"""
        if not hasattr(self, '_scenario_catalog_service'):
            db = self.get_calibration_db()
            self._scenario_catalog_service = ScenarioCatalogService(db)
        return self._scenario_catalog_service

    def get_population_stats_service(self):
        """Get population stats service"""
        if not hasattr(self, '_population_stats_service'):
            db = self.get_calibration_db()
            self._population_stats_service = PopulationStatsService(db)
        return self._population_stats_service

    def get_population_narrative_service(self):
        """Get population narrative service"""
        if not hasattr(self, '_population_narrative_service'):
            self._population_narrative_service = PopulationNarrativeService()
        return self._population_narrative_service

    def get_population_materialization_service(self):
        """Get population materialization service"""
        if not hasattr(self, '_population_materialization_service'):
            db = self.get_calibration_db()
            self._population_materialization_service = PopulationMaterializationService(db)
        return self._population_materialization_service
    
    def get_population_explorer(self):
        """Get population explorer service instance"""
        if not hasattr(self, '_population_explorer'):
            db = self.get_calibration_db()
            self._population_explorer = PopulationExplorerService(db)
        return self._population_explorer

    # Step 2: Aggregation services
    def get_aggregation_service(self):
        """Get aggregation service instance"""
        if not hasattr(self, '_aggregation_service'):
            db = self.get_calibration_db()
            self._aggregation_service = AggregationService(db)
        return self._aggregation_service
    
    def get_aggregation_config_service(self):
        """Get aggregation config service"""
        if not hasattr(self, '_aggregation_config_service'):
            self._aggregation_config_service = AggregationConfigService()
        return self._aggregation_config_service
    
    def get_aggregation_stats_service(self):
        """Get aggregation stats service"""
        if not hasattr(self, '_aggregation_stats_service'):
            self._aggregation_stats_service = AggregationStatsService()
        return self._aggregation_stats_service
    
    def get_aggregation_visual_service(self):
        """Get aggregation visual service"""
        if not hasattr(self, '_aggregation_visual_service'):
            self._aggregation_visual_service = AggregationVisualService()
        return self._aggregation_visual_service
    
    def get_aggregation_narrative_service(self):
        """Get aggregation narrative service"""
        if not hasattr(self, '_aggregation_narrative_service'):
            self._aggregation_narrative_service = AggregationNarrativeService()
        return self._aggregation_narrative_service
    
    def get_aggregation_health_service(self):
        """Get aggregation health service"""
        if not hasattr(self, '_aggregation_health_service'):
            self._aggregation_health_service = AggregationHealthService()
        return self._aggregation_health_service
    
    def get_aggregation_insight_service(self):
        """Get aggregation insight service"""
        if not hasattr(self, '_aggregation_insight_service'):
            self._aggregation_insight_service = AggregationInsightService()
        return self._aggregation_insight_service
    
    def get_aggregation_validator_service(self):
        """Get aggregation validator service"""
        if not hasattr(self, '_aggregation_validator_service'):
            self._aggregation_validator_service = AggregationValidatorService()
        return self._aggregation_validator_service
    
    # Step 3: Calibration builder services
    def get_percentile_engine(self):
        """Get percentile engine instance"""
        if not hasattr(self, '_percentile_engine_instance'):
            db = self.get_calibration_db()
            self._percentile_engine_instance = PercentileEngine(db)
        return self._percentile_engine_instance
    
    def get_threshold_simulator(self):
        """Get threshold simulator instance"""
        if not hasattr(self, '_threshold_simulator_instance'):
            db = self.get_calibration_db()
            self._threshold_simulator_instance = ThresholdSimulator(db)
        return self._threshold_simulator_instance
    
    def get_approval_service(self):
        """Get approval service instance"""
        if not hasattr(self, '_approval_service') or self._approval_service is None:
            db = self.get_calibration_db()
            self._approval_service = ApprovalService(db)
        return self._approval_service

    def get_report_service(self):
        """Get report service instance"""
        if not hasattr(self, '_report_service') or self._report_service is None:
            db = self.get_calibration_db()
            self._report_service = ReportDataService(db)
        return self._report_service
    
    # Step 3: Calibration Screen Services
    def get_distribution_service(self):
        """Get distribution intelligence service"""
        if not hasattr(self, '_distribution_service'):
            db = self.get_calibration_db()
            self._distribution_service = CalibrationDistributionService(db)
        return self._distribution_service

    def get_impact_service(self):
        """Get impact analysis service"""
        if not hasattr(self, '_impact_service'):
            db = self.get_calibration_db()
            self._impact_service = CalibrationImpactService(db)
        return self._impact_service

    def get_comparison_service(self):
        """Get comparison service"""
        if not hasattr(self, '_comparison_service'):
            db = self.get_calibration_db()
            self._comparison_service = CalibrationComparisonService(db)
        return self._comparison_service
    
    def get_str_evaluation_service(self):
        """Get STR evaluation service instance"""
        if not hasattr(self, '_str_evaluation_service'):
            db = self.get_calibration_db()
            self._str_evaluation_service = CalibrationSTREvaluationService(db)
        return self._str_evaluation_service

    def get_outcome_service(self):
        """Get calibration outcome service instance"""
        if not hasattr(self, '_outcome_service'):
            db = self.get_calibration_db()
            self._outcome_service = CalibrationOutcomeService(db)
        return self._outcome_service
    
    def get_ks_service(self):
        """Get KS statistics service instance"""
        if not hasattr(self, '_ks_service'):
            db = self.get_calibration_db()
            self._ks_service = CalibrationKSService(db)
        return self._ks_service

    def get_ks_visualization_service(self):
        """Get KS visualization service instance"""
        if not hasattr(self, '_ks_visualization_service'):
            db = self.get_calibration_db()
            self._ks_visualization_service = CalibrationKSVisualizationService(db)
        return self._ks_visualization_service

    def get_ks_narrative_service(self):
        """Get KS narrative service instance"""
        if not hasattr(self, '_ks_narrative_service'):
            self._ks_narrative_service = CalibrationKSNarrativeService()
        return self._ks_narrative_service
    
    def get_atl_btl_service(self):
        """Get ATL/BTL analysis service instance"""
        if not hasattr(self, '_atl_btl_service'):
            db = self.get_calibration_db()
            self._atl_btl_service = CalibrationATLBTLService(db)
        return self._atl_btl_service

    def get_pdf_generator_service(self):
        """Get PDF generator service with AI support"""
        if not hasattr(self, '_pdf_generator_service'):
            ollama = self.ollama_wrapper if hasattr(self, 'ollama_wrapper') and self.ollama_wrapper else None
            self._pdf_generator_service = PDFGeneratorService(ollama)
            
            if ollama:
                print("✅ PDF Generator initialized WITH AI explanations")
            else:
                print("⚠️  PDF Generator initialized WITHOUT AI (Ollama not available)")
        
        return self._pdf_generator_service
    

services = ServiceContainer()