from collections import defaultdict
from datetime import datetime, timedelta

import pandas as pd

from case_pack.case_pack_generator import CasePackGenerator


def _pick_col(df, candidates):
    for candidate in candidates:
        if candidate in df.columns:
            return candidate
    return None


def _to_iso(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.replace(microsecond=0).isoformat() + "Z"
    try:
        parsed = pd.to_datetime(value, errors="coerce")
        if pd.isna(parsed):
            return None
        return parsed.to_pydatetime().replace(microsecond=0).isoformat() + "Z"
    except Exception:
        return None


class NetworkGraphBuilderService:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.generator = CasePackGenerator(db_manager)

    def _canonicalize_transactions(self, rows):
        df = pd.DataFrame(rows or [])
        if df.empty:
            return []

        df.columns = [str(col) for col in df.columns]
        mappings = {
            "account_id": ["account_id", "acct_id", "accountid", "account_no", "ACCOUNT_ID"],
            "counterparty": [
                "counterparty_account",
                "counterparty_account_id",
                "counterparty",
                "beneficiary_account",
                "beneficiary_name",
                "to_account",
                "receiver_account",
                "BENEFICIARY_COUNTRY",
                "COUNTERPARTY",
            ],
            "txn_timestamp": ["txn_timestamp", "timestamp", "txn_time", "transaction_time", "transaction_datetime", "created_at", "date", "time", "TXN_TIMESTAMP"],
            "amount": ["amount", "txn_amount", "transaction_amount", "amt", "value", "TXN_AMOUNT"],
            "txn_type": ["txn_type", "type", "transaction_type", "TXN_TYPE"],
            "channel": ["channel", "CHANNEL"],
            "direction": ["direction", "dr_cr", "debit_credit", "txn_direction"],
            "beneficiary_country": ["beneficiary_country", "BENEFICIARY_COUNTRY"],
            "transaction_id": ["transaction_id", "TRANSACTION_ID", "reference"],
        }

        out = pd.DataFrame()
        for target, candidates in mappings.items():
            source = _pick_col(df, candidates)
            if source:
                out[target] = df[source]

        if "txn_timestamp" in out.columns:
            out["txn_timestamp"] = pd.to_datetime(out["txn_timestamp"], errors="coerce")
        if "amount" in out.columns:
            out["amount"] = pd.to_numeric(out["amount"], errors="coerce")
        out = out.fillna("")
        normalized = []
        for row in out.to_dict(orient="records"):
            account_id = str(row.get("account_id") or "").strip()
            counterparty = str(row.get("counterparty") or "").strip()
            if not account_id:
                continue
            normalized.append(
                {
                    "transaction_id": str(row.get("transaction_id") or "").strip(),
                    "account_id": account_id,
                    "counterparty": counterparty or "External Counterparty",
                    "txn_timestamp": row.get("txn_timestamp"),
                    "amount": float(row.get("amount") or 0),
                    "txn_type": str(row.get("txn_type") or "").strip(),
                    "channel": str(row.get("channel") or "").strip(),
                    "direction": str(row.get("direction") or "").strip().lower(),
                    "beneficiary_country": str(row.get("beneficiary_country") or "").strip(),
                }
            )
        return normalized

    def _filter_transactions(self, transactions, filters):
        filters = filters or {}
        min_amount = float(filters.get("min_amount") or 0)
        txn_type_filter = {str(item).strip().lower() for item in (filters.get("transaction_types") or []) if str(item).strip()}
        time_window_days = int(filters.get("time_window_days") or 90)
        cutoff = datetime.utcnow() - timedelta(days=time_window_days)

        scoped = []
        for txn in transactions:
            amount = float(txn.get("amount") or 0)
            if amount < min_amount:
                continue
            txn_type = str(txn.get("txn_type") or "").lower()
            if txn_type_filter and txn_type not in txn_type_filter:
                continue
            ts = txn.get("txn_timestamp")
            if isinstance(ts, pd.Timestamp):
                ts = ts.to_pydatetime()
            if isinstance(ts, datetime) and ts < cutoff:
                continue
            scoped.append(txn)
        return scoped

    def build_case_graph(self, case_id, filters=None):
        pack = self.generator.generate_case_pack(case_id)
        if not isinstance(pack, dict) or pack.get("error"):
            raise ValueError(pack.get("error") if isinstance(pack, dict) else "Unable to load case pack.")

        filters = filters or {}
        alerts = list(pack.get("alerts") or [])
        customers = list(pack.get("customers") or [])
        accounts = list(pack.get("accounts") or [])
        transactions = self._filter_transactions(self._canonicalize_transactions(pack.get("transactions") or pack.get("ledger") or []), filters)
        focal_account = str(filters.get("account_id") or pack.get("account_id") or "").strip()
        if not focal_account and accounts:
            focal_account = str(accounts[0].get("account_id") or accounts[0].get("ACCOUNT_ID") or "").strip()
        if not focal_account and transactions:
            focal_account = str(transactions[0].get("account_id") or "").strip()

        nodes = []
        links = []
        node_index = {}
        entity_stats = defaultdict(lambda: {"txn_count": 0, "total_amount": 0.0, "first_seen": None, "last_seen": None, "countries": set()})

        def add_node(node_id, label, entity_type, **extra):
            if not node_id:
                return
            key = str(node_id)
            if key in node_index:
                node_index[key].update({k: v for k, v in extra.items() if v not in (None, "", [], {})})
                return
            payload = {
                "id": key,
                "label": str(label or key),
                "type": entity_type,
                **extra,
            }
            node_index[key] = payload
            nodes.append(payload)

        case_node_id = f"CASE::{case_id}"
        add_node(case_node_id, case_id, "case", focal=True)

        for customer in customers[:5]:
            customer_id = str(customer.get("customer_id") or customer.get("CUSTOMER_ID") or "").strip()
            if not customer_id:
                continue
            add_node(
                f"CUSTOMER::{customer_id}",
                customer_id,
                "customer",
                risk_score=float(customer.get("CUSTOMER_RISK_RATING") or 0),
                pep_flag=bool(customer.get("PEP_FLAG")),
                sanctions_flag=bool(customer.get("SANCTION_HIT")),
                adverse_media_flag=bool(customer.get("ADVERSE_MEDIA_FLAG")),
            )
            links.append({"source": case_node_id, "target": f"CUSTOMER::{customer_id}", "relationship_type": "belongs_to_case", "volume": 0.0})

        for account in accounts[:10]:
            account_id = str(account.get("account_id") or account.get("ACCOUNT_ID") or "").strip()
            if not account_id:
                continue
            add_node(
                f"ACCOUNT::{account_id}",
                account_id,
                "account",
                focal=account_id == focal_account,
                account_type=str(account.get("account_type") or account.get("ACCOUNT_TYPE") or "").strip(),
                risk_score=float(account.get("risk_score") or 0),
                balance=float(account.get("CURRENT_BALANCE") or 0),
            )
            links.append({"source": case_node_id, "target": f"ACCOUNT::{account_id}", "relationship_type": "belongs_to_case", "volume": 0.0})

        for alert in alerts[:20]:
            alert_id = str(alert.get("alert_id") or alert.get("ALERT_ID") or "").strip()
            if not alert_id:
                continue
            add_node(
                f"ALERT::{alert_id}",
                alert_id,
                "alert",
                risk_score=float(alert.get("risk_score") or alert.get("RISK_SCORE") or 0),
                scenario=str(alert.get("rule_triggered") or alert.get("RULE_TRIGGERED") or alert.get("alert_type") or "").strip(),
            )
            links.append({"source": case_node_id, "target": f"ALERT::{alert_id}", "relationship_type": "linked_to_alert", "volume": 0.0})

        for txn in transactions:
            source_id = f"ACCOUNT::{txn['account_id']}"
            target_label = txn.get("counterparty") or "External Counterparty"
            target_id = f"COUNTERPARTY::{target_label}"
            add_node(source_id, txn["account_id"], "account", focal=txn["account_id"] == focal_account)
            add_node(
                target_id,
                target_label,
                "counterparty",
                external=target_label == "External Counterparty" or bool(txn.get("beneficiary_country")),
            )

            ts = txn.get("txn_timestamp")
            if isinstance(ts, pd.Timestamp):
                ts = ts.to_pydatetime()

            edge = {
                "id": txn.get("transaction_id") or f"{source_id}->{target_id}->{len(links) + 1}",
                "source": source_id,
                "target": target_id,
                "relationship_type": "transacted_with",
                "amount": float(txn.get("amount") or 0),
                "volume": float(txn.get("amount") or 0),
                "timestamp": _to_iso(ts),
                "txn_type": txn.get("txn_type"),
                "channel": txn.get("channel"),
                "beneficiary_country": txn.get("beneficiary_country"),
            }
            links.append(edge)

            for entity_id in (source_id, target_id):
                stats = entity_stats[entity_id]
                stats["txn_count"] += 1
                stats["total_amount"] += float(txn.get("amount") or 0)
                if txn.get("beneficiary_country"):
                    stats["countries"].add(txn.get("beneficiary_country"))
                if isinstance(ts, datetime):
                    if not stats["first_seen"] or ts < stats["first_seen"]:
                        stats["first_seen"] = ts
                    if not stats["last_seen"] or ts > stats["last_seen"]:
                        stats["last_seen"] = ts

        for node in nodes:
            stats = entity_stats.get(node["id"]) or {}
            node["txn_count"] = stats.get("txn_count", 0)
            node["total_amount"] = round(float(stats.get("total_amount") or 0), 2)
            node["first_seen"] = _to_iso(stats.get("first_seen"))
            node["last_seen"] = _to_iso(stats.get("last_seen"))
            node["country_count"] = len(stats.get("countries") or [])

        entity_focus = str(filters.get("entity_focus") or "all").strip().lower()
        if entity_focus in {"accounts", "counterparties", "alerts"}:
            allowed = {"case"}
            if entity_focus == "accounts":
                allowed.update({"account", "customer"})
            elif entity_focus == "counterparties":
                allowed.update({"account", "counterparty"})
            elif entity_focus == "alerts":
                allowed.update({"alert", "case", "account"})
            allowed_ids = {node["id"] for node in nodes if node.get("type") in allowed}
            nodes = [node for node in nodes if node["id"] in allowed_ids]
            links = [link for link in links if link.get("source") in allowed_ids and link.get("target") in allowed_ids]

        if filters.get("only_high_risk"):
            allowed_ids = {
                node["id"]
                for node in nodes
                if node.get("focal")
                or node.get("type") == "case"
                or float(node.get("risk_score") or 0) >= 60
                or int(node.get("txn_count") or 0) >= 3
            }
            nodes = [node for node in nodes if node["id"] in allowed_ids]
            links = [link for link in links if link.get("source") in allowed_ids and link.get("target") in allowed_ids]

        visibility = {
            "coverage_note": (
                "Network visibility is limited to entities and transactions visible within the institution and imported investigation data."
            ),
            "confidence": "Moderate" if transactions else "Low",
            "external_visibility_limited": any(
                str(link.get("target") or "").startswith("COUNTERPARTY::External")
                or bool(link.get("beneficiary_country"))
                for link in links
            ),
        }

        return {
            "case_id": case_id,
            "focal_account_id": focal_account,
            "graph": {"nodes": nodes, "links": links},
            "pack": pack,
            "transactions": transactions,
            "visibility": visibility,
        }
