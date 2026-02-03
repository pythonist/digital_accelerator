import pandas as pd
import numpy as np
import traceback

class TypologyService:
    def __init__(self, db_manager):
        self.db_manager = db_manager

    def _get_col(self, cursor, table, search_terms):
        """Helper to find actual column name (Case-Insensitive)"""
        try:
            cursor.execute(f"PRAGMA table_info(\"{table}\")")
            cols = [r[1] for r in cursor.fetchall()]
            # 1. Exact match
            for c in cols:
                if c.lower() in [s.lower() for s in search_terms]: return c
            # 2. Partial match
            for c in cols:
                if any(s.lower() in c.lower() for s in search_terms): return c
            return None
        except: return None

    def run_analysis(self, case_id):
        print(f"🔍 Typology Analysis for Case: {case_id}")
        conn = self.db_manager.connect()
        cursor = conn.cursor()
        
        try:
            df = pd.DataFrame()

            # --- 1. STRATEGY A: DIRECT LINK (Case ID in Transactions) ---
            # Some systems stamp the Case ID directly on the txn
            txn_case_col = self._get_col(cursor, 'transactions', ['case_id', 'caseid', 'case_no'])
            if txn_case_col:
                try:
                    df = pd.read_sql(f'SELECT * FROM transactions WHERE "{txn_case_col}" = ?', conn, params=[case_id])
                except: pass

            # --- 2. STRATEGY C (NEW): ALERT LINK (Case -> Alerts -> Transactions) ---
            # THIS IS THE FIX: Most likely schema path
            if df.empty:
                print("  -> Trying Strategy C: Linking Case -> Alerts -> Transactions")
                try:
                    # Find columns in ALERTS table
                    alert_case_col = self._get_col(cursor, 'alerts', ['case_id', 'caseid', 'case_no'])
                    alert_txn_col = self._get_col(cursor, 'alerts', ['transaction_id', 'trans_id', 'txn_id'])
                    
                    # Find columns in TRANSACTIONS table
                    txn_id_col = self._get_col(cursor, 'transactions', ['transaction_id', 'trans_id', 'txn_id', 'id'])

                    if alert_case_col and alert_txn_col and txn_id_col:
                        # 1. Get Transaction IDs from Alerts
                        cursor.execute(f'SELECT "{alert_txn_col}" FROM alerts WHERE "{alert_case_col}" = ?', [case_id])
                        txn_ids = [str(row[0]) for row in cursor.fetchall() if row[0]]
                        
                        if txn_ids:
                            print(f"     Found {len(txn_ids)} linked transaction IDs in alerts.")
                            placeholders = ','.join(['?'] * len(txn_ids))
                            
                            # 2. Fetch Transactions
                            query = f'SELECT * FROM transactions WHERE "{txn_id_col}" IN ({placeholders})'
                            df = pd.read_sql(query, conn, params=txn_ids)
                        else:
                            print("     No transaction IDs found in alerts for this case.")
                    else:
                        print(f"     Missing columns for join. AlertCase: {alert_case_col}, AlertTxn: {alert_txn_col}, TxnID: {txn_id_col}")

                except Exception as e:
                    print(f"  ⚠️ Alert-Transaction join failed: {e}")

            # --- 3. STRATEGY B: ACCOUNT LINK (Fallback) ---
            if df.empty:
                print("  -> Trying Strategy B: Linking Case -> Account -> Transactions")
                try:
                    case_case_col = self._get_col(cursor, 'cases', ['case_id', 'caseid', 'id'])
                    case_acct_col = self._get_col(cursor, 'cases', ['accountid', 'account_id', 'acct_id'])
                    txn_acct_col = self._get_col(cursor, 'transactions', ['accountid', 'account_id', 'acct_id'])

                    if case_acct_col and txn_acct_col:
                        cursor.execute(f'SELECT "{case_acct_col}" FROM cases WHERE "{case_case_col}" = ?', [case_id])
                        linked_accounts = [str(row[0]) for row in cursor.fetchall() if row[0]]
                        
                        if linked_accounts:
                            placeholders = ','.join(['?'] * len(linked_accounts))
                            df = pd.read_sql(f'SELECT * FROM transactions WHERE "{txn_acct_col}" IN ({placeholders})', conn, params=linked_accounts)
                except Exception as e:
                    print(f"  ⚠️ Account join failed: {e}")

            # --- FAIL STATE ---
            if df.empty:
                return {
                    "success": True,
                    "violated_rules": [],
                    "summary": f"No transactions found linked to Case {case_id}. Checked Direct, Alert-Link, and Account-Link.",
                    "missing_fields": ["transactions"]
                }

            print(f"  -> Successfully loaded {len(df)} transactions.")

            # --- 4. NORMALIZE & ANALYZE ---
            df.columns = [c.lower() for c in df.columns]
            
            col_map = {
                'amt': next((c for c in df.columns if 'amount' in c or 'amt' in c or 'value' in c), None),
                'type': next((c for c in df.columns if 'type' in c or 'cr_dr' in c or 'direction' in c), None)
            }
            
            if not col_map['amt']:
                return {"success": True, "violated_rules": [], "summary": "Missing Amount column.", "missing_fields": ["amount"]}

            # Safe Numeric Conversion
            df['val'] = pd.to_numeric(df[col_map['amt']], errors='coerce').fillna(0)
            
            # Safe String Conversion for Direction
            df['dir'] = 'unknown'
            if col_map['type']:
                df['dir'] = df[col_map['type']].astype(str).str.lower()

            violations = []

            # [Typology 1] Structuring (9k - 10k)
            structuring = df[(df['val'] >= 9000) & (df['val'] < 10000)]
            if len(structuring) >= 2:
                violations.append({
                    "name": "Potential Structuring",
                    "category": "Evasion",
                    "severity": "High",
                    "evidence": [f"{len(structuring)} txns between 9,000-10,000. Total: {structuring['val'].sum():.2f}"]
                })

            # [Typology 2] Mule/Velocity
            try:
                credits = df[df['dir'].str.contains('cr|dep|in', na=False)]['val'].sum()
                debits = df[df['dir'].str.contains('dr|wit|out', na=False)]['val'].sum()
                
                # Fallback logic if 'type' column is vague or missing (assume negative values are debits)
                if credits == 0 and debits == 0 and df['val'].min() < 0:
                     credits = df[df['val'] > 0]['val'].sum()
                     debits = abs(df[df['val'] < 0]['val'].sum())

                if credits > 20000 and debits > 0:
                    ratio = abs(credits - debits) / (credits + 0.01)
                    if ratio < 0.15:
                        violations.append({
                            "name": "Pass-Through Account (Mule)",
                            "category": "Layering",
                            "severity": "Critical",
                            "evidence": [f"In: {credits:.0f} ≈ Out: {debits:.0f} (<15% retained)"]
                        })
            except: pass

            # [Typology 3] Round Numbers
            large_txns = df[df['val'] > 500]
            if not large_txns.empty:
                round_txns = large_txns[large_txns['val'] % 100 == 0]
                pct = len(round_txns) / len(large_txns)
                if pct > 0.40:
                    violations.append({
                        "name": "Round Amount Anomaly",
                        "category": "Pattern",
                        "severity": "Medium",
                        "evidence": [f"{pct:.1%} of large transactions are round numbers."]
                    })

            summary = f"Analyzed {len(df)} transactions."
            if not violations: summary += " No typologies detected."

            return {
                "success": True,
                "violated_rules": violations,
                "summary": summary,
                "missing_fields": []
            }

        except Exception as e:
            traceback.print_exc()
            return {"success": False, "error": str(e)}
        finally:
            self.db_manager.close_connection(conn)