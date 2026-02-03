import pandas as pd
import numpy as np
import json
from datetime import datetime
import sqlite3

class CasePackGenerator:
    def __init__(self, db_manager):
        self.db_manager = db_manager

    def _get_col_name(self, df, keywords):
        """Smartly finds a column matching keywords."""
        for col in df.columns:
            if col.lower() in keywords: return col
        for col in df.columns:
            if any(k in col.lower() for k in keywords): return col
        return None

    def generate_case_pack(self, case_id):
        print(f"📦 Generating Deep Dive Pack for: {case_id}")
        conn = self.db_manager.connect()
        
        try:
            # 1. FETCH CORE CASE METADATA
            # Try to get details from the Master Cleaned data first
            master_table = 'master_cleaned_data'
            try: pd.read_sql(f"SELECT 1 FROM {master_table} LIMIT 1", conn)
            except: master_table = 'master_case_summary'

            # Fetch the specific row for this case
            df_case = pd.DataFrame()
            try:
                # Find the case_id column dynamically
                temp = pd.read_sql(f"SELECT * FROM {master_table} LIMIT 1", conn)
                case_col = self._get_col_name(temp, ['case_id', 'caseid', 'caseno'])
                
                if case_col:
                    query = f'SELECT * FROM "{master_table}" WHERE "{case_col}" = ?'
                    df_case = pd.read_sql(query, conn, params=(case_id,))
            except Exception as e:
                print(f"⚠️ Metadata fetch error: {e}")

            metadata = df_case.iloc[0].to_dict() if not df_case.empty else {"Case ID": case_id}

            # 2. FETCH RAW ALERTS (Live Query)
            alerts = []
            try:
                # Look for an 'alerts' table
                alerts_df = pd.read_sql(f"SELECT * FROM alerts", conn)
                a_case_col = self._get_col_name(alerts_df, ['case_id', 'caseid'])
                if a_case_col:
                    alerts = pd.read_sql(f'SELECT * FROM alerts WHERE "{a_case_col}" = ?', conn, params=(case_id,)).to_dict(orient='records')
            except: pass

            # 3. FETCH RAW ACCOUNTS (Linked to Case)
            accounts = []
            account_ids = []
            try:
                # Try linking via Case ID in accounts table
                acc_df = pd.read_sql("SELECT * FROM accounts LIMIT 1", conn)
                ac_case_col = self._get_col_name(acc_df, ['case_id', 'caseid'])
                
                if ac_case_col:
                    accounts_df = pd.read_sql(f'SELECT * FROM accounts WHERE "{ac_case_col}" = ?', conn, params=(case_id,))
                    accounts = accounts_df.to_dict(orient='records')
                    
                    # Collect Account IDs to find transactions
                    ac_id_col = self._get_col_name(accounts_df, ['account_id', 'acct_id', 'accountid', 'account_no'])
                    if ac_id_col:
                        account_ids = accounts_df[ac_id_col].astype(str).tolist()
            except: pass

            # 4. FETCH RAW TRANSACTIONS (The Missing Grid Fix)
            transactions = []
            try:
                txn_limit_df = pd.read_sql("SELECT * FROM transactions LIMIT 1", conn)
                t_case_col = self._get_col_name(txn_limit_df, ['case_id', 'caseid'])
                t_acct_col = self._get_col_name(txn_limit_df, ['account_id', 'acct_id', 'accountid'])

                txn_query = ""
                params = []

                # Strategy A: Transactions have Case ID (Direct Link)
                if t_case_col:
                    txn_query = f'SELECT * FROM transactions WHERE "{t_case_col}" = ?'
                    params = [case_id]
                
                # Strategy B: Transactions link to Accounts (Indirect Link)
                elif t_acct_col and account_ids:
                    placeholders = ','.join(['?'] * len(account_ids))
                    txn_query = f'SELECT * FROM transactions WHERE "{t_acct_col}" IN ({placeholders})'
                    params = account_ids

                if txn_query:
                    # Limit to 500 to prevent crash on massive datasets
                    txn_df = pd.read_sql(txn_query + " LIMIT 500", conn, params=params)
                    transactions = txn_df.fillna("").to_dict(orient='records')
                else:
                    # Fallback: If we can't link, return empty or check if master has extracted txns (rare)
                    pass

            except Exception as e:
                print(f"⚠️ Transaction fetch error: {e}")

            # 5. INTELLIGENCE GENERATION
            financial_profile = self._analyze_financials(transactions) # Pass raw txns now!
            network_profile = self._analyze_network(transactions)
            typologies = self._detect_typologies(financial_profile, transactions)

            return {
                "case_id": case_id,
                "generated_at": datetime.now().isoformat(),
                "metadata": metadata,
                "alerts": alerts,
                "transactions": transactions, # Now contains REAL data
                "accounts": accounts,
                "customers": [], # Can extend similar to accounts
                "financial_profile": financial_profile,
                "network_profile": network_profile,
                "typology_flags": typologies,
                "risk_score": self._calculate_dynamic_risk(alerts, financial_profile, typologies)
            }

        except Exception as e:
            print(f"❌ Generator Critical Error: {e}")
            import traceback
            traceback.print_exc()
            return {"error": str(e)}
        finally:
            self.db_manager.close_connection(conn)

    # --- ANALYTICS HELPERS (Updated to use List of Dicts) ---

    def _analyze_financials(self, txns):
        if not txns: return {"total_volume": 0, "monthly_trend": [], "flow_ratio": {"credit":0, "debit":0}}
        
        df = pd.DataFrame(txns)
        
        # Find Amount Column
        amt_col = self._get_col_name(df, ['amount', 'amt', 'value'])
        if not amt_col: return {}

        df[amt_col] = pd.to_numeric(df[amt_col], errors='coerce').fillna(0)
        
        # Monthly Trend
        trend = []
        date_col = self._get_col_name(df, ['date', 'dt', 'time'])
        if date_col:
            try:
                df[date_col] = pd.to_datetime(df[date_col], errors='coerce')
                monthly = df.groupby(df[date_col].dt.to_period('M'))[amt_col].sum()
                trend = [{"month": str(p), "volume": v} for p, v in monthly.items()]
            except: pass

        # Flow Ratio
        type_col = self._get_col_name(df, ['type', 'dr_cr', 'direction'])
        credit = 0
        debit = 0
        if type_col:
            credit = df[df[type_col].astype(str).str.lower().str.contains('cr|dep|in')][amt_col].sum()
            debit = df[df[type_col].astype(str).str.lower().str.contains('dr|with|out')][amt_col].sum()
        else:
            debit = df[amt_col].sum() # Default

        return {
            "total_volume": float(df[amt_col].sum()),
            "max_transaction": float(df[amt_col].max()),
            "avg_transaction": float(df[amt_col].mean()),
            "monthly_trend": trend,
            "flow_ratio": {"credit": float(credit), "debit": float(debit)}
        }

    def _analyze_network(self, txns):
        if not txns: return {"top_counterparties": [], "geographic_exposure": {}}
        df = pd.DataFrame(txns)
        
        party_col = self._get_col_name(df, ['party', 'beneficiary', 'remitter', 'name', 'desc'])
        amt_col = self._get_col_name(df, ['amount', 'amt'])
        
        top_cps = []
        if party_col and amt_col:
            df[amt_col] = pd.to_numeric(df[amt_col], errors='coerce').fillna(0)
            stats = df.groupby(party_col)[amt_col].sum().sort_values(ascending=False).head(5)
            top_cps = [{"name": k, "volume": v} for k, v in stats.items()]

        # Geo Risk (Mock or via Country Col)
        geo = {}
        country_col = self._get_col_name(df, ['country', 'cntry'])
        if country_col:
            geo = df[country_col].value_counts().head(5).to_dict()
        
        return {"top_counterparties": top_cps, "geographic_exposure": geo}

    def _detect_typologies(self, financials, txns):
        flags = []
        # Structuring
        if txns:
            df = pd.DataFrame(txns)
            amt_col = self._get_col_name(df, ['amount', 'amt'])
            if amt_col:
                # check for values between 9000 and 10000
                vals = pd.to_numeric(df[amt_col], errors='coerce').fillna(0)
                structuring = vals[(vals >= 9000) & (vals < 10000)]
                if len(structuring) > 0:
                    flags.append({"type": "Structuring", "severity": "High", "desc": f"{len(structuring)} txns just below $10k threshold"})

        # Velocity (Quick Turnaround)
        # logic: if total volume is high but average balance is low (requires balance col, skipping for now)
        return flags

    def _calculate_dynamic_risk(self, alerts, financials, typologies):
        score = 0
        score += len(alerts) * 15
        if financials.get('total_volume', 0) > 100000: score += 20
        if len(typologies) > 0: score += 40
        return min(99, score)

    def export_case_pack_json(self, case_id, path):
        data = self.generate_case_pack(case_id)
        with open(path, 'w') as f: json.dump(data, f, default=str, indent=2)