class GuideContentService:
    def get_case_retrieval_guide(self):
        return {
            "title": "Case Retrieval and Compare",
            "sections": [
                {
                    "heading": "What this module does",
                    "body": "This module helps investigators find historically similar cases, review shared suspicious patterns, compare cases side by side, identify precedents and outcomes, and understand whether a case resembles previously escalated or SAR-recommended cases.",
                },
                {
                    "heading": "How similarity works",
                    "body": "Similarity is based on structured case fingerprints built from case-level signals, not only free text. Each case is converted into a numeric case profile using features such as suspicious transaction count, total and average suspicious amount, off-hours and weekend activity, high-risk geography exposure, counterparty concentration, pass-through behavior, alert count and alert family pattern, customer and account risk indicators, KYC and CDD risk signals, network linkage features, and typology scores such as structuring, layering, mule, funnel, and pass-through.",
                },
                {
                    "heading": "Similarity modes",
                    "body": "Behavioral Similarity focuses on transaction rhythm, amount patterns, concentration, flow behavior, time behavior, and suspicious activity footprint. Typology Similarity focuses on typology-aligned case features such as structuring, mule activity, layering, funnel movement, pass-through patterns, and corridor risk. Network Similarity focuses on linked counterparties, shared beneficiaries, linked accounts, overlap in entities, and relationship structure. Hybrid Similarity uses a combined score across behavioral, typology, network, and alert-based signals.",
                },
                {
                    "heading": "Important limitations",
                    "body": "Similarity does not mean the cases are identical. A high score suggests comparable behavior, not the same root cause. Case comparison supports analyst judgment but does not replace decision-making. Outcome history provides precedent, not an automatic recommendation.",
                },
                {
                    "heading": "How to use the flow",
                    "body": "Select a base case, review similar cases and the match explanation, choose the most relevant cases, open comparison, review shared indicators, differences, and historical outcomes, and use these insights to support investigation and escalation decisions.",
                },
                {
                    "heading": "Why some cases may look similar but differ in outcome",
                    "body": "Branch context may differ, customer profile may differ, missing evidence or additional evidence may change final disposition, some cases may share behavior but not severity, and historical reviewer decisions also affect outcomes.",
                },
            ],
        }
