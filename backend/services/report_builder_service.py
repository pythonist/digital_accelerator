from services.case_data_aggregator import CaseDataAggregator
from services.case_report_pdf_service import CaseReportPDFService
from services.llm_report_service import LLMReportService
from services.report_storage_service import ReportStorageService


class ReportBuilderService:
    def __init__(self, db_manager, username="system"):
        self.db_manager = db_manager
        self.username = username
        self.aggregator = CaseDataAggregator(db_manager)
        self.llm = LLMReportService()
        self.pdf = CaseReportPDFService()
        self.storage = ReportStorageService(db_manager)

    def generate_single(self, case_id, model=None):
        conn = self.db_manager.connect()
        try:
            cursor = conn.cursor()
            version = self.storage.next_version(cursor, case_id)
            report_case = self.aggregator.aggregate_case(case_id, analyst_name=self.username)
            report_case["executive_summary"] = self.llm.executive_summary(report_case, model=model)
            report_case["evidence_explanation"] = self.llm.evidence_explanation(report_case, model=model)
            report_case["review_questions"] = self.llm.review_questions(report_case, model=model)
            report_case["comparison_explanation"] = self.llm.comparison_explanation(report_case, model=model)

            report_name = f"Case Dossier - {case_id}"
            file_name = f"case_dossier_{case_id}_v{version}.pdf"
            output_path = self.storage.build_output_path(file_name)
            payload = {
                "report_name": report_name,
                "report_scope": "single",
                "generated_by": self.username,
                "generated_at": report_case["cover"]["generated_date"],
                "cases": [report_case],
            }
            pdf_path = self.pdf.generate_pdf(payload, output_path=output_path)
            summary = {
                "case_id": case_id,
                "risk_level": report_case["cover"]["risk_level"],
                "status": report_case["cover"]["status"],
                "recommended_action": report_case["resolution"].get("final_action"),
                "customer_id": report_case["cover"]["customer_id"],
                "account_id": report_case["cover"]["account_id"],
                "generated_sections": [
                    "executive_summary",
                    "evidence_explanation",
                    "review_questions",
                    "comparison_explanation",
                ],
            }
            row = self.storage.register_report(
                cursor,
                case_id=case_id,
                report_name=report_name,
                report_scope="single",
                created_by=self.username,
                version_no=version,
                file_path=pdf_path,
                file_name=file_name,
                summary=summary,
            )
            conn.commit()
            return {"report": row, "preview": report_case}
        finally:
            conn.close()
