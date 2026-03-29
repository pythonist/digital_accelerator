import json

from api.services import services


class LLMReportService:
    def _candidates(self):
        candidates = []
        for item in (
            getattr(services, "llm_provider", None),
            getattr(services, "ollama_wrapper", None),
            getattr(services, "_gpt4all_wrapper", None),
        ):
            if item:
                candidates.append(item)
        return candidates

    def _generate(self, prompt, *, system_prompt, model=None, temperature=0.1, max_tokens=700):
        for candidate in self._candidates():
            try:
                if hasattr(candidate, "check_connection") and not candidate.check_connection():
                    continue
                result = candidate.generate(
                    prompt=prompt,
                    model=model or getattr(candidate, "default_model", None),
                    system_prompt=system_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                if isinstance(result, dict) and result.get("success") and result.get("response"):
                    return str(result.get("response")).strip()
            except Exception:
                continue
        return ""

    def executive_summary(self, report_case, model=None):
        prompt = (
            "Write a concise executive summary for an AML case report.\n"
            "Use only the provided facts.\n"
            "Do not invent evidence.\n"
            "Explain the case, key suspicious indicators, overall risk, and recommended action in formal business language.\n\n"
            f"Case Data:\n{json.dumps(report_case.get('llm_payload') or {}, default=str)}"
        )
        text = self._generate(
            prompt,
            system_prompt="You write audit-ready AML investigation report summaries using only supplied facts.",
            model=model,
            max_tokens=450,
        )
        if text:
            return text
        resolution = report_case.get("resolution") or {}
        overview = report_case.get("case_overview") or {}
        return (
            f"Case {report_case.get('case_id')} was reviewed across alerts, transactions, investigation findings, and connected intelligence. "
            f"The case currently carries risk level {overview.get('risk_level') or 'Pending'} and is in status {overview.get('status') or 'Under Review'}. "
            f"Key indicators include {', '.join(report_case.get('evidence_summary', {}).get('indicator_list', [])[:3]) or 'the alert and transaction pattern under review'}. "
            f"The current recommended action is {resolution.get('final_action') or 'Analyst review required'}."
        )

    def evidence_explanation(self, report_case, model=None):
        prompt = (
            "Write a short evidence explanation for an AML investigation report.\n"
            "Use only the supplied indicators, evidence items, and supporting facts.\n"
            "Keep it factual and regulator-friendly.\n\n"
            f"Evidence Payload:\n{json.dumps(report_case.get('llm_payload') or {}, default=str)}"
        )
        text = self._generate(
            prompt,
            system_prompt="You explain investigation evidence without adding unsupported conclusions.",
            model=model,
            max_tokens=450,
        )
        if text:
            return text
        bullets = report_case.get("evidence_summary", {}).get("indicator_list", [])[:3]
        return (
            "The evidence reviewed for this case points to "
            + (", ".join(bullets) if bullets else "the suspicious indicators recorded in the case file")
            + ". These findings should be read together with the transaction ledger, lineage chain, and final analyst decision."
        )

    def review_questions(self, report_case, model=None):
        prompt = (
            "Generate three to five review questions for an AML investigator.\n"
            "Use only the supplied case gaps, evidence, and escalation context.\n"
            "Return plain text with one question per line.\n\n"
            f"Review Payload:\n{json.dumps(report_case.get('llm_payload') or {}, default=str)}"
        )
        text = self._generate(
            prompt,
            system_prompt="You write reviewer questions based only on supplied case facts and missing evidence.",
            model=model,
            max_tokens=300,
        )
        if text:
            return [line.strip("- ").strip() for line in text.splitlines() if line.strip()]
        return [
            "What additional branch or customer explanation is needed to confirm the activity pattern?",
            "Do the linked entities and transaction paths materially strengthen the suspicion hypothesis?",
            "Is the current evidence sufficient for the recorded resolution decision, or is escalation still required?",
        ]

    def comparison_explanation(self, report_case, model=None):
        similar_cases = report_case.get("similar_cases", {}).get("matches", [])
        if not similar_cases:
            return "No materially similar historical cases were available at the time this report was generated."
        prompt = (
            "Write a concise comparison explanation for an AML case report.\n"
            "Use only the similar-case matches and comparison payload provided.\n"
            "Explain why the historical cases are relevant and where they differ.\n\n"
            f"Comparison Payload:\n{json.dumps(report_case.get('similar_cases') or {}, default=str)}"
        )
        text = self._generate(
            prompt,
            system_prompt="You summarize case comparison findings using only supplied structured comparison data.",
            model=model,
            max_tokens=400,
        )
        if text:
            return text
        top = similar_cases[0]
        return (
            f"Historical case {top.get('case_id')} is the closest match with similarity score {top.get('similarity_score')}. "
            f"The match is driven by {', '.join(top.get('matched_because', [])[:3]) or 'the overlapping risk and transaction pattern'}."
        )
