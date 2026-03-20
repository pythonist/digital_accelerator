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

    def _table_exists(self, conn, table_name: str) -> bool:
        try:
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
            return cur.fetchone() is not None
        except Exception:
            return False

    def _pick_table(self, conn, candidates):
        for t in candidates:
            if self._table_exists(conn, t):
                return t
        return None

    def _build_ledger_rows(self, txns):
        if not txns:
            return []
        df = pd.DataFrame(txns)
        if df.empty:
            return []

        date_col = self._get_col_name(df, ['date', 'txn_timestamp', 'timestamp', 'transaction_date', 'txn_date', 'time', 'created_at'])
        amt_col = self._get_col_name(df, ['amount', 'txn_amount', 'transaction_amount', 'amt', 'value'])
        type_col = self._get_col_name(df, ['txn_type', 'transaction_type', 'type', 'direction', 'dr_cr'])
        ref_col = self._get_col_name(df, ['reference', 'ref', 'transaction_id', 'txn_id', 'id', 'description', 'narrative', 'remarks', 'party', 'beneficiary', 'remitter'])

        if date_col:
            df[date_col] = pd.to_datetime(df[date_col], errors='coerce')
        if amt_col:
            df[amt_col] = pd.to_numeric(df[amt_col], errors='coerce')

        out = []
        for _, r in df.iterrows():
            d = None
            if date_col:
                ts = r.get(date_col)
                if pd.notna(ts):
                    try:
                        d = pd.to_datetime(ts).date().isoformat()
                    except Exception:
                        d = str(ts)
            a = None
            if amt_col:
                v = r.get(amt_col)
                if pd.notna(v):
                    try:
                        a = float(v)
                    except Exception:
                        a = None
            t = None
            if type_col:
                v = r.get(type_col)
                if pd.notna(v) and str(v) != '':
                    t = str(v)
            ref = None
            if ref_col:
                v = r.get(ref_col)
                if pd.notna(v) and str(v) != '':
                    ref = str(v)

            out.append(
                {
                    "date": d,
                    "amount": a,
                    "type": t,
                    "reference": ref,
                }
            )
        return out

    def _build_money_flow_graph(self, txns):
        if not txns:
            return {"success": False, "reason": "No transactions available for link analysis", "nodes": [], "links": []}
        df = pd.DataFrame(txns)
        if df.empty:
            return {"success": False, "reason": "No transactions available for link analysis", "nodes": [], "links": []}

        src_col = self._get_col_name(df, [
            'account_id', 'acct_id', 'accountid', 'account', 'account_no',
            'source_account', 'from_account', 'from_acct', 'sender_account', 'debit_account', 'payer_account',
            'customer_id', 'cust_id', 'entity_id'
        ])
        dst_col = self._get_col_name(df, [
            'counterparty_account', 'counterparty_account_id', 'counterparty', 'cp_account',
            'to_account', 'to_acct', 'receiver_account', 'credit_account', 'beneficiary_account', 'payee_account',
            'destination_account', 'dst_account'
        ])
        ts_col = self._get_col_name(df, ['txn_timestamp', 'timestamp', 'transaction_date', 'txn_date', 'date', 'time', 'created_at'])
        amt_col = self._get_col_name(df, ['txn_amount', 'amount', 'transaction_amount', 'amt', 'value', 'rule_metric'])
        dir_col = self._get_col_name(df, ['direction', 'dr_cr', 'debit_credit', 'type', 'txn_type', 'transaction_type'])
        id_col = self._get_col_name(df, ['transaction_id', 'txn_id', 'id', 'trans_id'])

        dst_kind = "account"
        if not dst_col:
            dst_col = self._get_col_name(df, [
                'party', 'counterparty_name', 'counterparty', 'beneficiary', 'remitter', 'merchant', 'merchant_name',
                'merchant_type', 'counterparty_country', 'country', 'description', 'desc'
            ])
            if dst_col:
                key = str(dst_col).lower()
                if "country" in key:
                    dst_kind = "country"
                elif "merchant" in key:
                    dst_kind = "merchant"
                elif "desc" in key or "description" in key:
                    dst_kind = "descriptor"
                else:
                    dst_kind = "counterparty"

        if not src_col or not dst_col:
            return {
                "success": False,
                "reason": "Missing linkage columns in transactions",
                "nodes": [],
                "links": [],
                "missing": {"source": src_col is None, "target": dst_col is None},
            }

        if ts_col:
            df[ts_col] = pd.to_datetime(df[ts_col], errors="coerce")
        if amt_col:
            df[amt_col] = pd.to_numeric(df[amt_col], errors="coerce")

        nodes = {}
        links = []

        def _norm_dir(v):
            if v is None:
                return None
            s = str(v).strip().lower()
            if s in ["out", "outbound", "debit", "dr"]:
                return "outbound"
            if s in ["in", "inbound", "credit", "cr"]:
                return "inbound"
            return s

        for _, r in df.iterrows():
            src = r.get(src_col)
            dst = r.get(dst_col)
            if pd.isna(src) or pd.isna(dst) or str(src) == "" or str(dst) == "":
                continue

            src_id = str(src)
            dst_id = str(dst)

            d = _norm_dir(r.get(dir_col)) if dir_col else None
            if d == "inbound":
                from_id, to_id = dst_id, src_id
            else:
                from_id, to_id = src_id, dst_id

            nodes[from_id] = {"id": from_id, "type": "account"}
            nodes[to_id] = {"id": to_id, "type": dst_kind if to_id != from_id else "account"}

            ts = None
            if ts_col:
                v = r.get(ts_col)
                if pd.notna(v):
                    try:
                        ts = pd.to_datetime(v).isoformat()
                    except Exception:
                        ts = str(v)

            amt = None
            if amt_col:
                v = r.get(amt_col)
                if pd.notna(v):
                    try:
                        amt = float(v)
                    except Exception:
                        amt = None

            txn_id = None
            if id_col:
                v = r.get(id_col)
                if pd.notna(v) and str(v) != "":
                    txn_id = str(v)

            links.append(
                {
                    "id": txn_id,
                    "source": from_id,
                    "target": to_id,
                    "ts": ts,
                    "amount": amt,
                    "direction": d,
                }
            )

        if not links:
            return {"success": False, "reason": "No linked transactions found for this case", "nodes": [], "links": []}

        try:
            links.sort(key=lambda x: (x["ts"] is None, x["ts"]))
        except Exception:
            pass

        return {"success": True, "nodes": list(nodes.values()), "links": links, "link_target_kind": dst_kind}

    def generate_case_pack(self, case_id):
        print(f"Generating Deep Dive Pack for: {case_id}")
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
                print(f"Warning: Metadata fetch error: {e}")

            metadata = df_case.iloc[0].to_dict() if not df_case.empty else {"Case ID": case_id}

            # 2. FETCH RAW ALERTS (Live Query)
            alerts = []
            try:
                alerts_table = self._pick_table(conn, ['alerts', 'alert'])
                if not alerts_table:
                    raise ValueError("No alerts table found")
                alerts_df = pd.read_sql(f"SELECT * FROM {alerts_table}", conn)
                a_case_col = self._get_col_name(alerts_df, ['case_id', 'caseid'])
                if a_case_col:
                    alerts = pd.read_sql(f'SELECT * FROM {alerts_table} WHERE "{a_case_col}" = ?', conn, params=(case_id,)).to_dict(orient='records')
            except: pass

            # 3. FETCH RAW ACCOUNTS (Linked to Case)
            accounts = []
            account_ids = []
            customer_ids = []
            try:
                # Try linking via Case ID in accounts table
                accounts_table = self._pick_table(conn, ['accounts', 'account'])
                if not accounts_table:
                    raise ValueError("No accounts table found")
                acc_df = pd.read_sql(f"SELECT * FROM {accounts_table} LIMIT 1", conn)
                ac_case_col = self._get_col_name(acc_df, ['case_id', 'caseid'])
                
                if ac_case_col:
                    accounts_df = pd.read_sql(f'SELECT * FROM {accounts_table} WHERE "{ac_case_col}" = ?', conn, params=(case_id,))
                    accounts = accounts_df.to_dict(orient='records')
                    
                    # Collect Account IDs to find transactions
                    ac_id_col = self._get_col_name(accounts_df, ['account_id', 'acct_id', 'accountid', 'account_no'])
                    if ac_id_col:
                        account_ids = accounts_df[ac_id_col].astype(str).tolist()

                    cust_id_col = self._get_col_name(accounts_df, ['customer_id', 'cust_id', 'entity_id'])
                    if cust_id_col:
                        customer_ids = accounts_df[cust_id_col].dropna().astype(str).tolist()
            except: pass

            # 3B. FETCH RAW CUSTOMERS (Linked via Accounts or Case Metadata)
            customers = []
            try:
                if not customer_ids:
                    for k, v in (metadata or {}).items():
                        lk = str(k).lower()
                        if any(x in lk for x in ["customer", "cust", "entity"]) and v not in [None, ""]:
                            customer_ids.append(str(v))
                customer_ids = list(dict.fromkeys([c for c in customer_ids if c not in [None, ""]]))

                customers_table = self._pick_table(conn, ['customers', 'customer'])
                if customers_table and customer_ids:
                    cust_limit_df = pd.read_sql(f"SELECT * FROM {customers_table} LIMIT 1", conn)
                    c_id_col = self._get_col_name(cust_limit_df, ['customer_id', 'cust_id', 'entity_id', 'id'])
                    if c_id_col:
                        placeholders = ','.join(['?'] * len(customer_ids))
                        customers_df = pd.read_sql(
                            f'SELECT * FROM {customers_table} WHERE "{c_id_col}" IN ({placeholders})',
                            conn,
                            params=customer_ids
                        )
                        customers = customers_df.fillna("").to_dict(orient='records')
            except:
                customers = []

            # 4. FETCH RAW TRANSACTIONS (The Missing Grid Fix)
            transactions = []
            try:
                transactions_table = self._pick_table(conn, ['transactions', 'transaction', 'txns', 'txn'])
                if not transactions_table:
                    raise ValueError("No transactions table found")
                txn_limit_df = pd.read_sql(f"SELECT * FROM {transactions_table} LIMIT 1", conn)
                t_case_col = self._get_col_name(txn_limit_df, ['case_id', 'caseid'])
                t_acct_col = self._get_col_name(txn_limit_df, ['account_id', 'acct_id', 'accountid', 'account_no'])
                t_cust_col = self._get_col_name(txn_limit_df, ['customer_id', 'cust_id', 'entity_id'])

                txn_query = ""
                params = []

                # Strategy A: Transactions have Case ID (Direct Link)
                if t_case_col:
                    txn_query = f'SELECT * FROM {transactions_table} WHERE "{t_case_col}" = ?'
                    params = [case_id]
                
                # Strategy B: Transactions link to Accounts (Indirect Link)
                elif t_acct_col and account_ids:
                    placeholders = ','.join(['?'] * len(account_ids))
                    txn_query = f'SELECT * FROM {transactions_table} WHERE "{t_acct_col}" IN ({placeholders})'
                    params = account_ids

                # Strategy C: Transactions link to Customer/Entity via case metadata
                elif t_cust_col:
                    candidate_ids = []
                    try:
                        for k, v in (metadata or {}).items():
                            lk = str(k).lower()
                            if any(x in lk for x in ["customer", "cust", "entity"]) and v not in [None, ""]:
                                candidate_ids.append(str(v))
                    except Exception:
                        candidate_ids = []
                    candidate_ids = list(dict.fromkeys(candidate_ids))
                    if candidate_ids:
                        placeholders = ','.join(['?'] * len(candidate_ids))
                        txn_query = f'SELECT * FROM {transactions_table} WHERE "{t_cust_col}" IN ({placeholders})'
                        params = candidate_ids

                if txn_query:
                    # Limit to 500 to prevent crash on massive datasets
                    txn_df = pd.read_sql(txn_query + " LIMIT 500", conn, params=params)
                    transactions = txn_df.fillna("").to_dict(orient='records')
                else:
                    # Fallback: Infer transaction linkage via alerts-derived account IDs
                    try:
                        alert_accounts = []
                        alerts_table = self._pick_table(conn, ['alerts', 'alert'])
                        if alerts_table:
                            # Inspect alert columns to locate potential account identifiers
                            alert_head = pd.read_sql(f'SELECT * FROM {alerts_table} LIMIT 1', conn)
                            a_cols = [str(c) for c in alert_head.columns]
                            cand_acc_cols = [c for c in a_cols if any(k in c.lower() for k in ['account_id', 'acct_id', 'accountid', 'account_no', 'account', 'src_account', 'source_account', 'from_account', 'sender'])]
                            # Pull alerts for the case and collect unique account IDs
                            a_case_col = self._get_col_name(alert_head, ['case_id', 'caseid'])
                            if a_case_col:
                                alerts_df2 = pd.read_sql(f'SELECT * FROM {alerts_table} WHERE "{a_case_col}" = ?', conn, params=(case_id,))
                                for c in cand_acc_cols:
                                    if c in alerts_df2.columns:
                                        vals = alerts_df2[c].dropna().astype(str).tolist()
                                        alert_accounts.extend(vals)
                            alert_accounts = list(dict.fromkeys([v for v in alert_accounts if v not in [None, ""]]))
                        # If we discovered account IDs from alerts, try fetching transactions that reference them
                        if alert_accounts:
                            transactions_table = transactions_table or self._pick_table(conn, ['transactions', 'transaction', 'txns', 'txn'])
                            if transactions_table:
                                txn_limit_df2 = pd.read_sql(f"SELECT * FROM {transactions_table} LIMIT 1", conn)
                                t_acct_col2 = self._get_col_name(txn_limit_df2, ['account_id', 'acct_id', 'accountid', 'account_no'])
                                if t_acct_col2:
                                    placeholders = ','.join(['?'] * len(alert_accounts))
                                    txn_df2 = pd.read_sql(
                                        f'SELECT * FROM {transactions_table} WHERE "{t_acct_col2}" IN ({placeholders}) LIMIT 500',
                                        conn,
                                        params=alert_accounts
                                    )
                                    transactions = txn_df2.fillna("").to_dict(orient='records')
                    except Exception:
                        # Keep transactions empty if inference fails
                        transactions = []

                # Final fallback: If still no transactions, synthesize them from alerts
                if not transactions:
                    try:
                        alerts_table = alerts_table or self._pick_table(conn, ['alerts', 'alert'])
                        if alerts_table:
                            alerts_df = pd.read_sql(f'SELECT * FROM {alerts_table}', conn)
                            a_case_col = self._get_col_name(alerts_df, ['case_id', 'caseid'])
                            if a_case_col:
                                alerts_df = pd.read_sql(f'SELECT * FROM {alerts_table} WHERE "{a_case_col}" = ?', conn, params=(case_id,))
                            # Find likely columns
                            src_col = self._get_col_name(alerts_df, ['account_id', 'acct_id', 'accountid', 'account_no', 'account', 'src_account', 'source_account', 'from_account', 'sender'])
                            dst_col = self._get_col_name(alerts_df, ['counterparty_account', 'counterparty', 'beneficiary', 'dest', 'to_account', 'receiver_account', 'payee', 'cp_account'])
                            ts_col = self._get_col_name(alerts_df, ['txn_timestamp', 'timestamp', 'transaction_date', 'txn_date', 'date', 'time', 'created_at'])
                            amt_col = self._get_col_name(alerts_df, ['amount', 'txn_amount', 'transaction_amount', 'amt', 'value', 'rule_metric'])
                            id_col = self._get_col_name(alerts_df, ['transaction_id', 'txn_id', 'id', 'trans_id', 'ref', 'reference'])
                            dir_col = self._get_col_name(alerts_df, ['direction', 'dr_cr', 'debit_credit', 'type', 'txn_type', 'transaction_type'])
                            synth = []
                            if not alerts_df.empty and (src_col or dst_col):
                                for _, r in alerts_df.iterrows():
                                    src = r.get(src_col) if src_col else None
                                    dst = r.get(dst_col) if dst_col else None
                                    if not src and not dst:
                                        continue
                                    amt = r.get(amt_col)
                                    ts = r.get(ts_col)
                                    tid = r.get(id_col)
                                    direction = r.get(dir_col)
                                    synth.append(
                                        {
                                            'account_id': str(src) if src not in [None, ""] else (str(dst) if dst not in [None, ""] else None),
                                            'counterparty_account': str(dst) if dst not in [None, ""] else (str(src) if src not in [None, ""] else None),
                                            'txn_timestamp': ts,
                                            'amount': amt,
                                            'direction': direction,
                                            'transaction_id': tid,
                                        }
                                    )
                                # Limit to 500
                                transactions = pd.DataFrame(synth).fillna("").to_dict(orient='records')[:500]
                    except Exception:
                        transactions = []

            except Exception as e:
                print(f"Warning: Transaction fetch error: {e}")

            # 5. INTELLIGENCE GENERATION
            financial_profile = self._analyze_financials(transactions) # Pass raw txns now!
            network_profile = self._analyze_network(transactions)
            typologies = self._detect_typologies(financial_profile, transactions)
            ledger = self._build_ledger_rows(transactions)
            link_analysis = self._build_money_flow_graph(transactions)

            return {
                "case_id": case_id,
                "generated_at": datetime.now().isoformat(),
                "metadata": metadata,
                "alerts": alerts,
                "transactions": transactions, # Now contains REAL data
                "ledger": ledger,
                "link_analysis": link_analysis,
                "accounts": accounts,
                "customers": customers,
                "financial_profile": financial_profile,
                "network_profile": network_profile,
                "typology_flags": typologies,
                "risk_score": self._calculate_dynamic_risk(alerts, financial_profile, typologies)
            }

        except Exception as e:
            print(f"Generator Critical Error: {e}")
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
                    flags.append({"type": "Structuring", "severity": "High", "desc": f"{len(structuring)} txns just below 10000 threshold"})

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
