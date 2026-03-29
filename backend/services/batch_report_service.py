import uuid

from services.case_data_aggregator import CaseDataAggregator
from services.case_report_pdf_service import CaseReportPDFService
from services.llm_report_service import LLMReportService
from services.report_builder_service import ReportBuilderService
from services.report_storage_service import ReportStorageService


class BatchReportService:
    def __init__(self, db_manager, username="system"):
        self.db_manager = db_manager
        self.username = username
        self.aggregator = CaseDataAggregator(db_manager)
        self.llm = LLMReportService()
        self.pdf = CaseReportPDFService()
        self.storage = ReportStorageService(db_manager)
        self.single_builder = ReportBuilderService(db_manager, username=username)

    def generate(self, case_ids, output_mode="separate", model=None):
        normalized_ids = []
        for case_id in case_ids or []:
            text = str(case_id or "").strip()
            if text and text not in normalized_ids:
                normalized_ids.append(text)
        if not normalized_ids:
            raise ValueError("At least one case is required for batch reporting.")

        if str(output_mode or "separate").lower() == "separate":
            return {
                "mode": "separate",
                "reports": [self.single_builder.generate_single(case_id, model=model)["report"] for case_id in normalized_ids],
            }

        conn = self.db_manager.connect()
        try:
            cursor = conn.cursor()
            batch_ref = f"BATCH-{uuid.uuid4().hex[:10].upper()}"
            cases = []
            for case_id in normalized_ids:
                case_report = self.aggregator.aggregate_case(case_id, analyst_name=self.username)
                case_report["executive_summary"] = self.llm.executive_summary(case_report, model=model)
                case_report["evidence_explanation"] = self.llm.evidence_explanation(case_report, model=model)
                case_report["review_questions"] = self.llm.review_questions(case_report, model=model)
                case_report["comparison_explanation"] = self.llm.comparison_explanation(case_report, model=model)
                cases.append(case_report)

            report_name = f"Batch Case Dossier - {len(normalized_ids)} cases"
            file_name = f"batch_case_dossier_{batch_ref.lower()}.pdf"
            output_path = self.storage.build_output_path(file_name)
            payload = {
                "report_name": report_name,
                "report_scope": "combined",
                "generated_by": self.username,
                "generated_at": cases[0]["cover"]["generated_date"] if cases else "",
                "batch_ref": batch_ref,
                "cases": cases,
            }
            pdf_path = self.pdf.generate_pdf(payload, output_path=output_path)
            row = self.storage.register_report(
                cursor,
                case_id=None,
                batch_ref=batch_ref,
                report_name=report_name,
                report_scope="combined",
                created_by=self.username,
                version_no=1,
                file_path=pdf_path,
                file_name=file_name,
                summary={
                    "case_ids": normalized_ids,
                    "case_count": len(normalized_ids),
                    "mode": "combined",
                },
            )
            conn.commit()
            return {"mode": "combined", "report": row, "preview": {"case_ids": normalized_ids, "cases": cases}}
        finally:
            conn.close()
