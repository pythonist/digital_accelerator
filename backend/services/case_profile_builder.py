import math
import re
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional

from case_pack.case_pack_generator import CasePackGenerator
from services.case_queue_service import CaseQueueService


HIGH_RISK_COUNTRIES = {"KY", "VG", "NG", "IR", "PK", "RU", "SY", "AF"}
TYPOLOGY_KEYWORDS = {
    "structuring": ["structuring", "sub threshold", "cash", "smurf"],
    "layering": ["layering", "multi hop", "circular", "high risk dest", "swift"],
    "mule": ["mule", "rapid mvt", "rapid movement", "pass through", "imps"],
    "funnel": ["funnel", "pass through", "velocity", "burst"],
    "pass_through": ["pass through", "rapid", "outbound", "velocity"],
}


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value in (None, ""):
            return default
        return float(value)
    except Exception:
        return default


def _pick_first(record: Dict[str, Any], keys: List[str], default: Any = None) -> Any:
    if not isinstance(record, dict):
        return default
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return default


def _parse_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    for fmt in (None, "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%d/%m/%Y %H:%M"):
        try:
            if fmt is None:
                return datetime.fromisoformat(text)
            return datetime.strptime(text, fmt)
        except Exception:
            continue
    return None


def _normalize_alert_family(value: Any) -> str:
    text = str(value or "").upper().strip()
    if not text:
        return "UNKNOWN"
    if "_" in text:
        return text.split("_", 1)[0]
    match = re.match(r"([A-Z0-9]+)", text)
    return match.group(1) if match else text


def _bounded_ratio(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return max(0.0, min(float(numerator) / float(denominator), 1.0))


class CaseProfileBuilder:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.generator = CasePackGenerator(db_manager)
        self.queue_service = CaseQueueService(db_manager)

    def _get_queue_rows(self) -> List[Dict[str, Any]]:
        conn = self.queue_service._connect()
        try:
            self.queue_service._sync_case_queue(conn)
            cur = conn.cursor()
            cur.execute("SELECT * FROM case_queue ORDER BY case_id")
            return [self.queue_service._row_to_queue_item(dict(row)) for row in cur.fetchall()]
        finally:
            self.db_manager.close_connection(conn)

    def list_case_rows(self) -> List[Dict[str, Any]]:
        return self._get_queue_rows()

    def get_case_row(self, case_id: str) -> Optional[Dict[str, Any]]:
        rows = self._get_queue_rows()
        lookup = {str(row.get("case_id")): row for row in rows}
        return lookup.get(str(case_id))

    def build_case_profile(self, case_id: str, queue_row: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        queue_row = queue_row or self.get_case_row(case_id) or {"case_id": case_id}
        pack = self.generator.generate_case_pack(case_id) or {}
        alerts = list(pack.get("alerts") or [])
        transactions = list(pack.get("transactions") or [])
        ledger = list(pack.get("ledger") or [])
        customers = list(pack.get("customers") or [])
        accounts = list(pack.get("accounts") or [])
        network_profile = pack.get("network_profile") or {}
        graph = pack.get("network_graph") or {}

        movement_rows = transactions or ledger
        amounts = []
        counterparty_values = []
        countries = []
        alert_families = []
        alert_labels = []
        timestamps = []
        inbound_count = 0
        outbound_count = 0

        for txn in movement_rows:
            amount = _safe_float(_pick_first(txn, ["amount", "txn_amount", "transaction_amount", "amt", "value", "TXN_AMOUNT"]), 0.0)
            if amount > 0:
                amounts.append(amount)
            counterparty = _pick_first(txn, ["counterparty", "beneficiary", "party", "beneficiary_account", "merchant_name"])
            if counterparty:
                counterparty_values.append(str(counterparty))
            country = _pick_first(txn, ["beneficiary_country", "BENEFICIARY_COUNTRY", "country", "beneficiary_ctry"])
            if country:
                countries.append(str(country).upper())
            timestamp = _parse_datetime(_pick_first(txn, ["date", "ts", "TXN_TIMESTAMP", "txn_timestamp"]))
            if timestamp:
                timestamps.append(timestamp)
            txn_type = str(_pick_first(txn, ["type", "txn_type", "TXN_TYPE", "transaction_type"], "")).lower()
            if any(word in txn_type for word in ["deposit", "credit", "inbound", "cash_deposit", "salary"]):
                inbound_count += 1
            elif txn_type:
                outbound_count += 1

        for alert in alerts:
            label = _pick_first(alert, ["type", "alert_type", "RULE_TRIGGERED", "rule_triggered"], "UNKNOWN")
            alert_labels.append(str(label))
            alert_families.append(_normalize_alert_family(label))
            timestamp = _parse_datetime(_pick_first(alert, ["date", "alert_date", "ALERT_DATE"]))
            if timestamp:
                timestamps.append(timestamp)

        counterparty_counter = Counter(counterparty_values)
        unique_counterparties = len(counterparty_counter)
        total_counterparty_hits = sum(counterparty_counter.values())
        concentration_hhi = sum((count / total_counterparty_hits) ** 2 for count in counterparty_counter.values()) if total_counterparty_hits else 0.0
        repeated_beneficiary_ratio = _bounded_ratio(sum(1 for count in counterparty_counter.values() if count > 1), max(unique_counterparties, 1))
        high_risk_geo_ratio = _bounded_ratio(sum(1 for country in countries if country in HIGH_RISK_COUNTRIES), max(len(countries), 1))

        off_hours_ratio = 0.0
        weekend_ratio = 0.0
        burstiness = 0.0
        if timestamps:
            off_hours_ratio = _bounded_ratio(sum(1 for ts in timestamps if ts.hour < 6 or ts.hour >= 21), len(timestamps))
            weekend_ratio = _bounded_ratio(sum(1 for ts in timestamps if ts.weekday() >= 5), len(timestamps))
            daily_counter = Counter(ts.date().isoformat() for ts in timestamps)
            burstiness = _bounded_ratio(max(daily_counter.values()), max(len(timestamps), 1))

        total_amount = sum(amounts)
        average_amount = total_amount / len(amounts) if amounts else 0.0
        max_amount = max(amounts) if amounts else 0.0
        amount_std = 0.0
        if len(amounts) > 1:
            mean = average_amount
            amount_std = math.sqrt(sum((amt - mean) ** 2 for amt in amounts) / len(amounts))

        inbound_outbound_imbalance = abs(inbound_count - outbound_count) / max(inbound_count + outbound_count, 1)
        pass_through_ratio = _bounded_ratio(min(inbound_count, outbound_count), max(inbound_count, outbound_count, 1))

        customer = customers[0] if customers else {}
        account = accounts[0] if accounts else {}

        customer_risk = _safe_float(_pick_first(customer, ["customer_risk_rating", "CUSTOMER_RISK_RATING", "risk_score"]), _safe_float(queue_row.get("risk_score"), 0.0))
        kyc_completeness = _safe_float(_pick_first(customer, ["kyc_completeness_pct", "KYC_COMPLETENESS_PCT"]), 0.0)
        days_since_kyc = _safe_float(_pick_first(customer, ["days_since_kyc", "DAYS_SINCE_KYC"]), 0.0)
        pep_flag = 1.0 if _safe_float(_pick_first(customer, ["pep_flag", "PEP_FLAG", "is_pep"]), 0.0) > 0 else 0.0
        sanctions_flag = 1.0 if _safe_float(_pick_first(customer, ["sanction_hit", "SANCTION_HIT", "sanctions_flag"]), 0.0) > 0 else 0.0
        adverse_media_flag = 1.0 if _safe_float(_pick_first(customer, ["adverse_media_flag", "ADVERSE_MEDIA_FLAG"]), 0.0) > 0 else 0.0

        account_open_date = _parse_datetime(_pick_first(account, ["open_date", "OPEN_DATE"]))
        account_age_days = max(0.0, float((datetime.utcnow() - account_open_date).days)) if account_open_date else 0.0
        linked_accounts_count = max(1.0, float(len(accounts)))
        connectivity_score = unique_counterparties + _safe_float(network_profile.get("counterparty_count"), 0.0) + linked_accounts_count

        typology_flags = pack.get("typology_flags") or {}
        if isinstance(typology_flags, list):
            typology_texts = [str(item) for item in typology_flags]
        else:
            typology_texts = [key for key, value in typology_flags.items() if value]
        typology_source_text = " ".join(typology_texts + alert_labels + [str(pack.get("narrative") or "")]).lower()

        typology_scores = {}
        for typology, keywords in TYPOLOGY_KEYWORDS.items():
            hits = sum(1 for keyword in keywords if keyword in typology_source_text)
            if typology_flags and isinstance(typology_flags, dict):
                direct_flag = typology_flags.get(typology) or typology_flags.get(typology.upper())
                if direct_flag:
                    hits += 2
            typology_scores[typology] = min(1.0, hits / max(len(keywords), 1))

        dominant_alert_family = Counter(alert_families).most_common(1)[0][0] if alert_families else "UNKNOWN"
        dominant_typology = max(typology_scores, key=typology_scores.get) if typology_scores else "structuring"
        time_period = timestamps[0].strftime("%Y-Q%q") if timestamps else ""
        if timestamps:
            first_ts = min(timestamps)
            quarter = ((first_ts.month - 1) // 3) + 1
            time_period = f"{first_ts.year}-Q{quarter}"

        risk_tier = "High" if customer_risk >= 80 else "Medium" if customer_risk >= 45 else "Low"
        customer_segment = _pick_first(customer, ["occupation", "OCCUPATION", "income_bracket", "INCOME_BRACKET"], "Unclassified")
        outcome_status = str(queue_row.get("current_status") or "Open")

        raw_features = {
            "suspicious_txn_count": float(len(movement_rows)),
            "total_suspicious_amount": total_amount,
            "average_suspicious_amount": average_amount,
            "max_suspicious_amount": max_amount,
            "amount_volatility": amount_std,
            "burstiness": burstiness,
            "off_hours_ratio": off_hours_ratio,
            "weekend_ratio": weekend_ratio,
            "inbound_outbound_imbalance": inbound_outbound_imbalance,
            "pass_through_ratio": pass_through_ratio,
            "repeated_beneficiary_ratio": repeated_beneficiary_ratio,
            "unique_counterparties": float(unique_counterparties),
            "counterparty_concentration": concentration_hhi,
            "high_risk_geo_ratio": high_risk_geo_ratio,
            "corridor_exposure": float(len(set(countries))),
            "alert_count": float(len(alerts)),
            "distinct_alert_families": float(len(set(alert_families))),
            "alert_recurrence_ratio": _bounded_ratio(max(Counter(alert_families).values()) if alert_families else 0, max(len(alert_families), 1)),
            "customer_risk_rating": customer_risk,
            "account_age_days": account_age_days,
            "kyc_completeness": kyc_completeness,
            "overdue_review_indicator": 1.0 if days_since_kyc > 365 else 0.0,
            "pep_flag": pep_flag,
            "sanctions_flag": sanctions_flag,
            "adverse_media_flag": adverse_media_flag,
            "linked_accounts_count": linked_accounts_count,
            "shared_beneficiaries_count": float(sum(1 for value in counterparty_counter.values() if value > 1)),
            "network_connectivity_score": connectivity_score,
            "structuring_score": typology_scores["structuring"],
            "layering_score": typology_scores["layering"],
            "mule_score": typology_scores["mule"],
            "funnel_score": typology_scores["funnel"],
            "pass_through_typology_score": typology_scores["pass_through"],
        }

        behavioral_vector = [
            math.log1p(raw_features["suspicious_txn_count"]),
            math.log1p(raw_features["total_suspicious_amount"]),
            math.log1p(raw_features["average_suspicious_amount"]),
            math.log1p(raw_features["max_suspicious_amount"]),
            math.log1p(raw_features["amount_volatility"]),
            raw_features["burstiness"],
            raw_features["off_hours_ratio"],
            raw_features["weekend_ratio"],
            raw_features["inbound_outbound_imbalance"],
            raw_features["pass_through_ratio"],
            raw_features["repeated_beneficiary_ratio"],
        ]
        typology_vector = [
            raw_features["structuring_score"],
            raw_features["layering_score"],
            raw_features["mule_score"],
            raw_features["funnel_score"],
            raw_features["pass_through_typology_score"],
            raw_features["high_risk_geo_ratio"],
        ]
        network_vector = [
            math.log1p(raw_features["unique_counterparties"]),
            raw_features["counterparty_concentration"],
            math.log1p(raw_features["linked_accounts_count"]),
            math.log1p(raw_features["shared_beneficiaries_count"]),
            math.log1p(raw_features["network_connectivity_score"]),
            raw_features["corridor_exposure"],
        ]
        alert_vector = [
            math.log1p(raw_features["alert_count"]),
            math.log1p(raw_features["distinct_alert_families"]),
            raw_features["alert_recurrence_ratio"],
            customer_risk / 100.0,
            pep_flag,
            sanctions_flag,
            adverse_media_flag,
            1.0 if risk_tier == "High" else 0.5 if risk_tier == "Medium" else 0.0,
            min(1.0, _safe_float(queue_row.get("risk_score"), 0.0) / 100.0),
            1.0 if outcome_status == "SAR Recommended" else 0.0,
        ]

        preview = {
            "alerts": alerts[:5],
            "transactions": movement_rows[:8],
            "top_counterparties": [{"name": name, "count": count} for name, count in counterparty_counter.most_common(5)],
        }

        return {
            "case_id": str(case_id),
            "metadata": {
                "branch_code": queue_row.get("branch_code"),
                "region": queue_row.get("region"),
                "scenario_name": queue_row.get("scenario_name"),
                "risk_score": _safe_float(queue_row.get("risk_score"), customer_risk),
                "severity": queue_row.get("severity"),
                "outcome_status": outcome_status,
                "current_stage": queue_row.get("current_stage"),
                "customer_id": queue_row.get("customer_id"),
                "account_id": queue_row.get("account_id"),
                "customer_name": queue_row.get("customer_name") or _pick_first(customer, ["customer_name", "name", "CUSTOMER_ID"], "Customer"),
                "dominant_alert_family": dominant_alert_family,
                "risk_tier": risk_tier,
                "customer_segment": customer_segment,
                "time_period": time_period,
                "dominant_typology": dominant_typology,
                "last_updated_at": queue_row.get("last_updated_at"),
            },
            "raw_features": raw_features,
            "vectors": {
                "behavioral": behavioral_vector,
                "typology": typology_vector,
                "network": network_vector,
                "alert": alert_vector,
            },
            "tokens": {
                "counterparties": sorted({str(name) for name in counterparty_values if str(name).strip()}),
                "alert_families": sorted(set(alert_families)),
                "alert_labels": sorted(set(alert_labels)),
                "countries": sorted(set(countries)),
            },
            "preview": preview,
            "packet_summary": {
                "risk_score": pack.get("risk_score"),
                "narrative": pack.get("narrative") or pack.get("summary"),
            },
        }
