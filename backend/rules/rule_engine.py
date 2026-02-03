import json
import pandas as pd
import numpy as np
import operator
import os
from typing import List, Dict, Any
from datetime import datetime

class UniversalRuleEngine:
    
    # Column mappings for data normalization
    MAPPINGS = {
        'amount': ['txn_amount', 'amount', 'amt', 'val', 'value', 'credit', 'debit', 'total_amount', 'transaction_amount'],
        'date': ['txn_date', 'date', 'timestamp', 'created_at', 'val_date', 'date_time', 'time'],
        'type': ['dr_cr', 'type', 'txn_type', 'direction', 'indicator', 'cr_dr'],
        'channel': ['channel', 'mode', 'instrument', 'method', 'payment_mode'],
        'party': ['counterparty', 'beneficiary', 'remitter', 'party_name', 'merchant', 'entity', 'customer_name'],
        'country': ['country', 'geo', 'jurisdiction', 'origin_country'],
        'status': ['status', 'account_status', 'state']
    }

    OPERATORS = {
        '>': operator.gt, '<': operator.lt, 
        '>=': operator.ge, '<=': operator.le,
        '==': lambda a, b: str(a).lower() == str(b).lower(),
        '!=': operator.ne,
        'contains': lambda a, b: str(b).lower() in str(a).lower(),
        'in': lambda a, b: str(a).upper() in [x.upper() for x in b],
    }

    def __init__(self, db_manager, rules_file="data/aml_rules.json"):
        self.db_manager = db_manager
        self.rules_file = rules_file
        self.rules = self._load_rules()
        self.rule_stats = {}

    def _load_rules(self) -> Dict:
        """Load rules from JSON file ONLY - no defaults in code"""
        if not os.path.exists(self.rules_file):
            print(f"Warning: Rules file not found at {self.rules_file}")
            return {}
        try:
            with open(self.rules_file, 'r', encoding='utf-8') as f:
                rules = json.load(f)
                print(f"Loaded {len(rules)} rules from {self.rules_file}")
                return rules
        except Exception as e:
            print(f"Error loading rules: {e}")
            return {}

    def save_rules(self, new_rules):
        try:
            os.makedirs(os.path.dirname(self.rules_file), exist_ok=True)
            with open(self.rules_file, 'w', encoding='utf-8') as f:
                json.dump(new_rules, f, indent=2, ensure_ascii=False)
            self.rules = new_rules
            return True
        except Exception as e:
            print(f"Error saving rules: {e}")
            return False

    def reload_rules(self):
        self.rules = self._load_rules()

    # --- SMART DATA FETCHING ---
    def _fetch_case_data(self, case_id: str) -> pd.DataFrame:
        """Fetch transaction data for a specific case"""
        conn = self.db_manager.connect()
        try:
            cursor = conn.cursor()
            
            # Try multiple table and column combinations
            queries = [
                # Try transactions table with various case_id columns
                f'SELECT * FROM transactions WHERE case_id = ?',
                f'SELECT * FROM transactions WHERE Case_ID = ?',
                f'SELECT * FROM transactions WHERE caseid = ?',
                f'SELECT * FROM transactions WHERE "Case ID" = ?',
                
                # Try alerts table
                f'SELECT * FROM alerts WHERE case_id = ?',
                f'SELECT * FROM alerts WHERE Case_ID = ?',
            ]
            
            for query in queries:
                try:
                    df = pd.read_sql(query, conn, params=[str(case_id)])
                    if not df.empty:
                        print(f"Found {len(df)} transactions for case {case_id}")
                        return df
                except Exception as e:
                    continue
            
            print(f"No transactions found for case {case_id}")
            return pd.DataFrame()
            
        except Exception as e:
            print(f"Error fetching case data: {e}")
            return pd.DataFrame()
        finally:
            self.db_manager.close_connection(conn)

    def get_case_metadata(self, case_id: str) -> Dict:
        """Fetch metadata about a case"""
        conn = self.db_manager.connect()
        try:
            cursor = conn.cursor()
            
            # Try to get case from cases table
            case_queries = [
                "SELECT * FROM cases WHERE case_id = ?",
                "SELECT * FROM cases WHERE Case_ID = ?",
                "SELECT * FROM cases WHERE id = ?",
            ]
            
            case_data = None
            for query in case_queries:
                try:
                    cursor.execute(query, (case_id,))
                    row = cursor.fetchone()
                    if row:
                        cols = [desc[0] for desc in cursor.description]
                        case_data = dict(zip(cols, row))
                        break
                except:
                    continue
            
            if not case_data:
                return {
                    'case_id': case_id,
                    'severity': 'Unknown',
                    'alert_count': 0,
                    'status': 'Unknown'
                }
            
            # Count alerts for this case
            alert_count = 0
            alert_queries = [
                "SELECT COUNT(*) FROM alerts WHERE case_id = ?",
                "SELECT COUNT(*) FROM alerts WHERE Case_ID = ?",
            ]
            
            for query in alert_queries:
                try:
                    cursor.execute(query, (case_id,))
                    alert_count = cursor.fetchone()[0]
                    break
                except:
                    continue
            
            return {
                'case_id': case_id,
                'severity': case_data.get('severity') or case_data.get('Severity') or 'Unknown',
                'alert_count': alert_count,
                'status': case_data.get('status') or case_data.get('Status') or 'Unknown',
                'customer': case_data.get('customer_name') or case_data.get('Customer_Name') or ''
            }
            
        except Exception as e:
            print(f"Error fetching case metadata: {e}")
            return {'case_id': case_id, 'severity': 'Unknown', 'alert_count': 0}
        finally:
            self.db_manager.close_connection(conn)

    def normalize_dataframe(self, df: pd.DataFrame) -> tuple:
        """Map raw DB columns to standardized columns"""
        if df.empty:
            return df, []

        clean_data = {}
        found_mappings = []

        for field, keywords in self.MAPPINGS.items():
            match = None
            # Exact match first (case insensitive)
            for col in df.columns:
                if any(k.lower() == col.lower() for k in keywords):
                    match = col
                    break
            
            # Partial match if no exact match
            if not match:
                for col in df.columns:
                    if any(k.lower() in col.lower() for k in keywords):
                        match = col
                        break
            
            if match:
                clean_data[field] = df[match]
                found_mappings.append(field)
            else:
                clean_data[field] = np.nan

        ndf = pd.DataFrame(clean_data)
        ndf['original_data'] = df.apply(lambda x: x.to_dict(), axis=1)

        # Type conversion
        if 'amount' in ndf.columns:
            ndf['amount'] = pd.to_numeric(
                ndf['amount'].astype(str).str.replace(r'[^\d.-]', '', regex=True),
                errors='coerce'
            ).fillna(0)
        
        missing = [k for k in self.MAPPINGS.keys() if k not in found_mappings]
        return ndf, missing

    # --- MAIN ANALYSIS ENGINE ---
    def run_risk_analysis(self, case_id: str) -> Dict:
        """Main analysis - runs rules AND typologies"""
        print(f"\n=== Starting Risk Analysis for Case {case_id} ===")
        
        self.reload_rules()
        raw_df = self._fetch_case_data(case_id)
        
        if raw_df.empty:
            return {
                "status": "no_data",
                "message": f"No transaction data found for Case {case_id}. Please verify the case exists in the database."
            }

        df, missing_cols = self.normalize_dataframe(raw_df)
        print(f"Normalized {len(df)} transactions. Missing fields: {missing_cols}")
        
        violations = []
        rules_tested = 0
        rules_triggered = 0
        
        # A. RUN STANDARD RULES
        print(f"\n--- Testing {len(self.rules)} configured rules ---")
        for rule_id, rule in self.rules.items():
            if not rule.get('enabled', True):
                print(f"Skipping disabled rule: {rule_id}")
                continue
            
            rules_tested += 1
            matches = []
            
            for idx, row in df.iterrows():
                if self._evaluate_row(row, rule['conditions'], rule.get('logic', 'AND')):
                    matches.append(row)
            
            if matches:
                rules_triggered += 1
                print(f"✗ Rule {rule_id} TRIGGERED - {len(matches)} matches")
                
                violations.append({
                    "id": rule_id,
                    "name": rule['name'],
                    "severity": rule['severity'],
                    "category": rule['category'],
                    "description": rule['description'],
                    "match_count": len(matches),
                    "total_value": float(sum(m['amount'] for m in matches if not pd.isna(m['amount']))),
                    "examples": [self._format_evidence(m['original_data']) for m in matches[:3]],
                    "explanation": self._generate_rule_explanation_inline(rule, matches)
                })
            else:
                print(f"✓ Rule {rule_id} passed")

        # B. RUN TYPOLOGY DETECTORS
        print(f"\n--- Running Typology Detection ---")
        typologies = self._run_typologies(df)
        if typologies:
            print(f"Found {len(typologies)} typology matches")
            violations.extend(typologies)
        else:
            print("No typologies detected")

        # C. SORT BY SEVERITY
        severity_weights = {'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1}
        violations.sort(key=lambda x: severity_weights.get(x['severity'], 0), reverse=True)

        risk_score = self._calculate_risk_score(violations)
        
        print(f"\n=== Analysis Complete ===")
        print(f"Rules Tested: {rules_tested}")
        print(f"Rules Triggered: {rules_triggered}")
        print(f"Typologies Detected: {len(typologies)}")
        print(f"Total Violations: {len(violations)}")
        print(f"Risk Score: {risk_score}/100")

        return {
            "status": "success",
            "case_id": case_id,
            "row_count": len(df),
            "missing_columns": missing_cols,
            "violations": violations,
            "risk_score": risk_score,
            "analysis_summary": {
                "rules_tested": rules_tested,
                "rules_triggered": rules_triggered,
                "typologies_detected": len(typologies),
                "total_violations": len(violations),
                "data_quality": {
                    "fields_available": len(self.MAPPINGS) - len(missing_cols),
                    "fields_missing": len(missing_cols),
                    "completeness_pct": round(((len(self.MAPPINGS) - len(missing_cols)) / len(self.MAPPINGS)) * 100, 1)
                },
                "severity_breakdown": {
                    "critical": sum(1 for v in violations if v['severity'] == 'Critical'),
                    "high": sum(1 for v in violations if v['severity'] == 'High'),
                    "medium": sum(1 for v in violations if v['severity'] == 'Medium'),
                    "low": sum(1 for v in violations if v['severity'] == 'Low')
                }
            }
        }

    def _generate_rule_explanation_inline(self, rule: Dict, matches: List) -> Dict:
        """Generate explanation of why rule triggered"""
        conditions = rule.get('conditions', [])
        condition_explanations = []
        
        for cond in conditions:
            field = cond['field']
            op = cond['operator']
            value = cond['value']
            
            if op == '>':
                condition_explanations.append(f"{field} exceeds {value}")
            elif op == '<':
                condition_explanations.append(f"{field} is below {value}")
            elif op == '>=':
                condition_explanations.append(f"{field} is at least {value}")
            elif op == '<=':
                condition_explanations.append(f"{field} is at most {value}")
            elif op == '==':
                condition_explanations.append(f"{field} equals '{value}'")
            elif op == 'in':
                condition_explanations.append(f"{field} is one of {', '.join(str(v) for v in value)}")
            elif op == 'contains':
                condition_explanations.append(f"{field} contains '{value}'")
        
        logic = rule.get('logic', 'AND')
        trigger_desc = f" {logic} ".join(condition_explanations)
        
        return {
            "trigger_logic": trigger_desc,
            "matched_count": len(matches),
            "why_flagged": rule.get('description', 'No description available'),
            "severity_rationale": f"Classified as {rule['severity']} based on regulatory risk assessment"
        }

    def _format_evidence(self, row_dict):
        """Clean evidence for UI display"""
        return {k: v for k, v in row_dict.items() 
                if v is not None and not pd.isna(v) and k not in ['created_at', 'updated_at']}

    def _evaluate_row(self, row, conditions, logic):
        """Evaluate if row matches conditions"""
        results = []
        for cond in conditions:
            val = row.get(cond['field'])
            target = cond['value']
            
            if pd.isna(val) or val == 'nan':
                results.append(False)
                continue

            op = self.OPERATORS.get(cond['operator'])
            try:
                res = op(val, target)
                results.append(res)
            except:
                results.append(False)

        return all(results) if logic == 'AND' else any(results)

    # --- TYPOLOGY DETECTION ---
    def _run_typologies(self, df):
        """Run all typology detectors"""
        alerts = []
        
        structuring = self._detect_structuring(df)
        if structuring:
            alerts.append(structuring)
        
        mule = self._detect_money_mule(df)
        if mule:
            alerts.append(mule)
        
        round_numbers = self._detect_round_numbers(df)
        if round_numbers:
            alerts.append(round_numbers)
        
        return alerts

    def _detect_structuring(self, df) -> Dict:
        """Detect structuring (smurfing) patterns"""
        if 'amount' not in df.columns:
            return None
        
        # PAN threshold avoidance (₹45k-₹50k)
        structuring_pan = df[(df['amount'] >= 45000) & (df['amount'] < 50000)]
        
        if len(structuring_pan) >= 3:
            return {
                "id": "TYPO_STRUCT_PAN",
                "name": "Structuring (PAN Avoidance)",
                "severity": "Critical",
                "category": "Placement / Evasion",
                "description": f"Detected {len(structuring_pan)} transactions in ₹45k-₹50k range",
                "match_count": len(structuring_pan),
                "total_value": float(structuring_pan['amount'].sum()),
                "examples": [self._format_evidence(structuring_pan.iloc[i]['original_data']) 
                            for i in range(min(3, len(structuring_pan)))],
                "explanation": {
                    "trigger_logic": f"{len(structuring_pan)} transactions between ₹45,000-₹49,999",
                    "matched_count": len(structuring_pan),
                    "why_flagged": "Transactions deliberately structured below ₹50,000 PAN requirement to avoid regulatory oversight",
                    "severity_rationale": "Critical - Indicates deliberate regulatory evasion"
                }
            }
        return None

    def _detect_money_mule(self, df) -> Dict:
        """Detect pass-through / mule account patterns"""
        if 'amount' not in df.columns or 'type' not in df.columns:
            return None
        
        credits = df[df['type'].astype(str).str.contains('CREDIT|DEP|IN', case=False, na=False)]['amount'].sum()
        debits = df[df['type'].astype(str).str.contains('DEBIT|WIT|OUT', case=False, na=False)]['amount'].sum()
        
        if credits > 100000 and debits > 0:
            retention = abs(credits - debits) / credits if credits > 0 else 0
            
            if retention < 0.10:
                return {
                    "id": "TYPO_MULE_01",
                    "name": "Pass-Through Account (Money Mule)",
                    "severity": "Critical",
                    "category": "Layering",
                    "description": f"High velocity: ₹{credits:,.0f} in, ₹{debits:,.0f} out. Only {retention:.1%} retained",
                    "match_count": len(df),
                    "total_value": float(credits),
                    "examples": [],
                    "explanation": {
                        "trigger_logic": f"Credits (₹{credits:,.0f}) ≈ Debits (₹{debits:,.0f}) with <10% retention",
                        "matched_count": len(df),
                        "why_flagged": "Account used as conduit for rapid money movement rather than legitimate commerce",
                        "severity_rationale": "Critical - Classic layering behavior to obscure money trail"
                    }
                }
        return None

    def _detect_round_numbers(self, df) -> Dict:
        """Detect excessive round number transactions"""
        if 'amount' not in df.columns:
            return None
        
        large_txns = df[df['amount'] > 1000]
        if len(large_txns) < 5:
            return None
        
        round_txns = large_txns[large_txns['amount'] % 1000 == 0]
        round_ratio = len(round_txns) / len(large_txns)
        
        if round_ratio > 0.4:
            return {
                "id": "TYPO_ROUND_01",
                "name": "Excessive Round Amount Transactions",
                "severity": "Medium",
                "category": "Pattern Detection",
                "description": f"{round_ratio:.0%} of large transactions are exact multiples of ₹1,000",
                "match_count": len(round_txns),
                "total_value": float(round_txns['amount'].sum()),
                "examples": [self._format_evidence(round_txns.iloc[i]['original_data']) 
                            for i in range(min(3, len(round_txns)))],
                "explanation": {
                    "trigger_logic": f"{len(round_txns)}/{len(large_txns)} transactions are exact multiples of ₹1,000",
                    "matched_count": len(round_txns),
                    "why_flagged": "Natural commercial transactions rarely occur in exact round numbers. High frequency suggests artificial structuring",
                    "severity_rationale": "Medium - May indicate pre-arranged or coordinated payments"
                }
            }
        return None

    def _calculate_risk_score(self, violations):
        """Calculate risk score (0-100)"""
        score = 0
        weights = {'Critical': 25, 'High': 10, 'Medium': 5, 'Low': 1}
        for v in violations:
            score += weights.get(v['severity'], 0)
        return min(score, 100)

    # --- API HELPER METHODS ---
    
    def get_typology_metadata(self) -> List[Dict]:
        """Return metadata about typology detectors"""
        return [
            {
                "id": "TYPO_STRUCT_PAN",
                "name": "Structuring (PAN Avoidance)",
                "description": "Detects transactions structured below ₹50k to avoid PAN requirements",
                "category": "Placement",
                "severity": "Critical"
            },
            {
                "id": "TYPO_MULE_01",
                "name": "Money Mule / Pass-Through",
                "description": "Identifies accounts with high in/out velocity and low retention",
                "category": "Layering",
                "severity": "Critical"
            },
            {
                "id": "TYPO_ROUND_01",
                "name": "Round Number Pattern",
                "description": "Flags excessive use of round-number transactions",
                "category": "Pattern Detection",
                "severity": "Medium"
            }
        ]

    def explain_typology(self, typology_id: str) -> Dict:
        """Detailed typology explanation"""
        explanations = {
            "TYPO_STRUCT_PAN": {
                "name": "Structuring (PAN Avoidance)",
                "detection_method": "Scans for ≥3 transactions between ₹45,000-₹49,999",
                "why_suspicious": "Legitimate businesses rarely have consistent amounts just below regulatory thresholds",
                "regulatory_context": "Indian regulations require PAN for cash transactions ≥₹50,000",
                "recommended_action": "Request source of funds documentation, consider STR filing"
            },
            "TYPO_MULE_01": {
                "name": "Money Mule",
                "detection_method": "Compares total credits vs debits, flags if retention <10%",
                "why_suspicious": "Normal accounts retain funds. Pass-through suggests account used as conduit",
                "regulatory_context": "Common in layering stage to obscure audit trail",
                "recommended_action": "Verify business model, check if account holder aware of all activity"
            },
            "TYPO_ROUND_01": {
                "name": "Round Number Pattern",
                "detection_method": "Flags if >40% of large transactions are exact multiples of ₹1,000",
                "why_suspicious": "Real-world commerce typically includes non-round amounts",
                "regulatory_context": "Often seen in hawala or bulk cash businesses",
                "recommended_action": "Review transaction purposes and counterparties"
            }
        }
        return explanations.get(typology_id)

    def generate_rule_explanation(self, rule_id: str) -> Dict:
        """Generate explanation for specific rule"""
        if rule_id not in self.rules:
            return None
        
        rule = self.rules[rule_id]
        return {
            "rule_id": rule_id,
            "description": rule.get('description', 'No description'),
            "conditions": rule.get('conditions', []),
            "logic": rule.get('logic', 'AND'),
            "severity": rule['severity']
        }

    def get_rule_statistics(self) -> Dict:
        """Rule performance statistics"""
        return {
            "total_rules": len(self.rules),
            "enabled_rules": sum(1 for r in self.rules.values() if r.get('enabled', True)),
            "trigger_counts": self.rule_stats
        }

    def validate_case_data(self, case_id: str) -> Dict:
        """Validate case data quality"""
        raw_df = self._fetch_case_data(case_id)
        
        if raw_df.empty:
            return {
                "valid": False,
                "message": "No transaction data found",
                "missing_fields": list(self.MAPPINGS.keys())
            }
        
        df, missing = self.normalize_dataframe(raw_df)
        
        required_critical = ['amount', 'date']
        critical_missing = [f for f in required_critical if f in missing]
        
        quality_score = ((len(self.MAPPINGS) - len(missing)) / len(self.MAPPINGS)) * 100
        
        return {
            "valid": len(critical_missing) == 0,
            "data_quality_score": round(quality_score, 1),
            "transaction_count": len(df),
            "missing_fields": missing,
            "critical_missing": critical_missing,
            "available_fields": [k for k in self.MAPPINGS.keys() if k not in missing]
        }