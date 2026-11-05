class GuideContentService:
    def get_case_retrieval_guide(self):
        return {
            "title": "Case Retrieval & Comparison: Forensic Similarity Guide",
            "sections": [
                {
                    "section_id": "architecture",
                    "heading": "Section 1: Algorithmic Architecture & Vector Fingerprinting",
                    "tag": "MATHEMATICAL FOUNDATION",
                    "body": "Rather than relying on superficial text matching, the Case Retrieval Engine constructs a high-dimensional empirical mathematical fingerprint for every case across transactions, alerts, customer profiles, and counterparty graphs.",
                    "details": [
                        {
                            "title": "1. Multi-Table Feature Extraction",
                            "text": "The engine extracts 32 continuous, topological, and categorical features from raw transactions (velocity, amounts, flow symmetry), alerts (families, frequency, rules), customer CDD (KYC completeness, PEP, sanctions, days since review), accounts (age, type), and network graphs (HHI concentration, connectivity)."
                        },
                        {
                            "title": "2. Log-Transform & Z-Score Standardization",
                            "text": "Monetary and count features are normalized using log1p(x) = ln(1 + x) to compress skewed banking distributions. Each feature vector is then centered and scaled: z = (x - μ) / σ, preventing massive dollar amounts from distorting behavioral patterns."
                        },
                        {
                            "title": "3. L2 Hypersphere Projection & FAISS Cosine Index",
                            "text": "Feature vectors are L2-normalized (v / ||v||) onto a unit hypersphere. Similarity is computed via exact Inner Product / Cosine Distance in FAISS (IndexFlatIP), returning similarity scores bounded strictly between 0.0 (0% match) and 1.0 (100% match)."
                        }
                    ]
                },
                {
                    "section_id": "similarity_modes",
                    "heading": "Section 2: The 4 Forensic Similarity Lenses",
                    "tag": "4 SIMILARITY MODES",
                    "body": "Investigators can pivot across 4 distinct mathematical lenses depending on the specific investigative hypothesis:",
                    "modes": [
                        {
                            "name": "1. Behavioral Similarity",
                            "weight": "11 Dimensions (100% weight in Behavioral mode)",
                            "what_it_does": "Analyzes operational transaction dynamics, cash flow symmetry, velocity spikes, and temporal patterns.",
                            "features_used": [
                                "Transaction Count: ln(1 + count)",
                                "Total & Average Volume: ln(1 + sum), ln(1 + avg)",
                                "Peak Exposure & Volatility: ln(1 + max), ln(1 + std)",
                                "Burstiness Index: Peak single-day transaction clustering ratio",
                                "Off-Hours Ratio: Proportion of transfers between 21:00 and 06:00 UTC",
                                "Weekend Ratio: Proportion of transfers on Saturday/Sunday",
                                "Inflow/Outflow Imbalance: Net directional flow asymmetry |In - Out| / (In + Out)",
                                "Pass-Through Ratio: Rapid throughput velocity min(In, Out) / max(In, Out)",
                                "Repeated Beneficiary Ratio: Recurring counterparty recurrence proportion"
                            ],
                            "investigator_use_case": "Best for identifying accounts with identical operational cash rhythm, rapid velocity bursts, round-number structuring, or pass-through wash behavior, regardless of the customer industry."
                        },
                        {
                            "name": "2. Typology Similarity",
                            "weight": "6 Dimensions (100% weight in Typology mode)",
                            "what_it_does": "Matches specific financial crime laundering modus operandi against established FATF and regulatory typologies.",
                            "features_used": [
                                "Structuring / Smurfing Score (0-1): Multiple sub-threshold cash/wire splits designed to evade reporting thresholds",
                                "Layering Score (0-1): Complex multi-hop wire hops and circular transfer loops",
                                "Mule Account Score (0-1): Rapid inbound credits immediately followed by fast outbound dispersals",
                                "Funnel Account Score (0-1): Multi-source geographic deposits consolidating into a single account",
                                "Pass-Through Movement Score (0-1): Near-zero balance retention with immediate outgoing liquidity sweeps",
                                "High-Risk Corridor Ratio: Exposure to FATF high-risk/non-cooperative jurisdictions (e.g. KY, VG, NG, IR, PK, RU, SY, AF)"
                            ],
                            "investigator_use_case": "Best for finding historical cases exhibiting the exact same financial crime mechanics (e.g. money mule rings or structuring), even if the absolute monetary volumes differ."
                        },
                        {
                            "name": "3. Network Similarity",
                            "weight": "5 Dimensions (100% weight in Network mode)",
                            "what_it_does": "Evaluates graph topology, counterparty concentration, and structural relationship clustering.",
                            "features_used": [
                                "Unique Counterparties: ln(1 + unique_parties)",
                                "Counterparty Concentration (HHI): Herfindahl-Hirschman Index measuring counterparty monopoly",
                                "Linked Accounts Count: ln(1 + linked_accounts)",
                                "Shared Beneficiaries Count: Direct counterparty collisions with known entities",
                                "Graph Connectivity Score: Node degree centrality and multi-tier relationship density"
                            ],
                            "investigator_use_case": "Best for uncovering organized crime syndicates, collusive merchant clusters, shared mule networks, and nested entity relationships."
                        },
                        {
                            "name": "4. Hybrid Similarity",
                            "weight": "Weighted Multi-Vector Composite Ensemble (Default: 45% / 25% / 20% / 10%)",
                            "what_it_does": "Synthesizes all 4 vectors into a single unified composite similarity index.",
                            "features_used": [
                                "45% Behavioral Dynamics: Transaction velocity, flow symmetry, temporal clustering",
                                "25% Typology Indicators: Financial crime typology keyword and rule matches",
                                "20% Network Topology: Graph concentration, linked accounts, counterparty overlap",
                                "10% Alert & Customer Risk: Alert counts, dominant alert families, customer risk rating, KYC completeness"
                            ],
                            "investigator_use_case": "The recommended general-purpose lens. Delivers the most balanced and defensible peer comparison across all case dimensions."
                        }
                    ]
                },
                {
                    "section_id": "workflow",
                    "heading": "Section 3: Investigator Workflow & Precedent Review",
                    "tag": "COMPLIANCE PLAYBOOK",
                    "body": "How compliance officers and AML investigators should utilize similarity scores and side-by-side comparison in live case resolution:",
                    "details": [
                        {
                            "title": "1. Interpreting Match Scores",
                            "text": "• 90%+ Match: Near-identical operational or typology footprint. Strongly check previous SAR filing narratives or dismissal rationale.\n• 75% - 89% Match: Strong behavioral or structural correlation. Examine shared indicators and counterparty overlaps.\n• 50% - 74% Match: Moderate resemblance. Useful for broad sector or typology benchmarking."
                        },
                        {
                            "title": "2. Precedent & Regulatory Defensibility",
                            "text": "Historical resolution outcomes (SAR Filed vs Closed without Action) provide audit-defensible precedent. When examiners challenge a case disposition, citing historical peer cases with matching typology fingerprints demonstrates consistent, objective decision-making."
                        },
                        {
                            "title": "3. Why Similar Cases Can Have Different Outcomes",
                            "text": "Two cases may have a 95% behavioral match but different outcomes because: (a) Enhanced Customer Due Diligence (EDD) provided verified commercial justification in one case, (b) Source of funds documentation differed, or (c) Jurisdiction/regulatory thresholds diverged."
                        }
                    ]
                }
            ]
        }
