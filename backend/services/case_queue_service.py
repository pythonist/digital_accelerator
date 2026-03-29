import json
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional


STATUS_SEQUENCE = [
    "Open",
    "In Review",
    "Draft Prepared",
    "Pending L2 Review",
    "Pending BM Review",
    "Pending Vigilance Review",
    "Escalated",
    "Awaiting Response",
    "SAR Recommended",
    "Closed",
    "Rejected / No Further Action",
]

STATUS_TO_STAGE = {
    "Open": "Detection",
    "In Review": "Investigation",
    "Draft Prepared": "Resolution Draft",
    "Pending L2 Review": "Escalation",
    "Pending BM Review": "Escalation",
    "Pending Vigilance Review": "Escalation",
    "Escalated": "Escalation",
    "Awaiting Response": "Final Decision",
    "SAR Recommended": "Final Decision",
    "Closed": "Closure",
    "Rejected / No Further Action": "Closure",
}

REVIEW_REQUIRED_STATUSES = {
    "Pending L2 Review",
    "Pending BM Review",
    "Pending Vigilance Review",
    "Escalated",
    "Awaiting Response",
    "SAR Recommended",
}

SAVED_VIEWS = {
    "All Cases": lambda row: True,
    "SAR Candidates": lambda row: row.get("current_status") in {"Draft Prepared", "SAR Recommended"},
    "Pending L2": lambda row: row.get("current_status") == "Pending L2 Review",
    "Pending BM": lambda row: row.get("current_status") == "Pending BM Review",
    "Pending Vigilance": lambda row: row.get("current_status") == "Pending Vigilance Review",
    "Escalated": lambda row: row.get("current_status") in {"Escalated", "Pending L2 Review", "Pending BM Review", "Pending Vigilance Review"},
    "Awaiting Response": lambda row: row.get("current_status") == "Awaiting Response",
    "Closed Today": lambda row: str(row.get("closed_at") or "").startswith(datetime.utcnow().date().isoformat()),
    "Overdue": lambda row: bool(row.get("is_overdue")),
}

DEFAULT_TEMPLATES = [
    {
        "template_name": "L2 Review Template",
        "template_type": "L2 Reviewer",
        "subject_template": "FCC Escalation Required | Case {case_id} | Pending L2 Review",
        "body_template": (
            "Escalation reason: {escalation_reason}\n\n"
            "Case ID: {case_id}\n"
            "Customer ID: {customer_id}\n"
            "Account ID: {account_id}\n"
            "Risk Severity: {severity}\n"
            "Scenario: {scenario_name}\n"
            "Why further review is needed: {why_review_needed}\n"
            "Transaction summary: {transaction_summary}\n"
            "Analyst comments: {analyst_comment}\n"
            "Recommended next action: {recommended_next_action}\n"
            "Due date: {sla_due_at}\n"
            "Open case in platform: {case_link}"
        ),
    },
    {
        "template_name": "Branch Manager Review Template",
        "template_type": "Branch Manager",
        "subject_template": "FCC Escalation Required | Case {case_id} | Pending BM Review",
        "body_template": (
            "Escalation reason: {escalation_reason}\n\n"
            "Case ID: {case_id}\n"
            "Customer ID: {customer_id}\n"
            "Account ID: {account_id}\n"
            "Risk Severity: {severity}\n"
            "Scenario: {scenario_name}\n"
            "Reason for branch review: {why_review_needed}\n"
            "Transaction summary: {transaction_summary}\n"
            "Analyst comments: {analyst_comment}\n"
            "Recommended next action: {recommended_next_action}\n"
            "Due date: {sla_due_at}\n"
            "Open case in platform: {case_link}"
        ),
    },
    {
        "template_name": "Vigilance Review Template",
        "template_type": "Vigilance Officer",
        "subject_template": "FCC High Risk Case Review | Vigilance Action Required | Case {case_id}",
        "body_template": (
            "Escalation reason: {escalation_reason}\n\n"
            "Case ID: {case_id}\n"
            "Customer ID: {customer_id}\n"
            "Account ID: {account_id}\n"
            "Risk Severity: {severity}\n"
            "Scenario: {scenario_name}\n"
            "High-risk indicators: {risk_indicators}\n"
            "Transaction summary: {transaction_summary}\n"
            "Analyst comments: {analyst_comment}\n"
            "Recommended next action: {recommended_next_action}\n"
            "Due date: {sla_due_at}\n"
            "Open case in platform: {case_link}"
        ),
    },
    {
        "template_name": "Compliance Review Template",
        "template_type": "Compliance SPOC",
        "subject_template": "FCC Escalation Required | Case {case_id} | Compliance Review",
        "body_template": (
            "Escalation reason: {escalation_reason}\n\n"
            "Case ID: {case_id}\n"
            "Customer ID: {customer_id}\n"
            "Account ID: {account_id}\n"
            "Risk Severity: {severity}\n"
            "Scenario: {scenario_name}\n"
            "Case summary: {why_review_needed}\n"
            "Transaction summary: {transaction_summary}\n"
            "Analyst comments: {analyst_comment}\n"
            "Recommended next action: {recommended_next_action}\n"
            "Due date: {sla_due_at}\n"
            "Open case in platform: {case_link}"
        ),
    },
]

DEFAULT_RECIPIENTS = [
    {
        "name": "Rajeev Kumar Singh",
        "role": "Compliance SPOC",
        "email": "rajeev.kumar.singh@pwc.com",
        "branch_code": None,
        "region": "National",
        "case_types_supported": ["AML", "Escalation", "High Risk"],
    },
    {
        "name": "Deepanshu Jindal",
        "role": "Vigilance Officer",
        "email": "deepanshu.jindal@pwc.com",
        "branch_code": None,
        "region": "National",
        "case_types_supported": ["AML", "Fraud", "Vigilance"],
    },
    {
        "name": "Shivank Singh",
        "role": "L2 Reviewer",
        "email": "shivank.singh@gmail.com",
        "branch_code": "BR-001",
        "region": "North",
        "case_types_supported": ["AML", "Review", "Analyst Escalation"],
    },
]

DEFAULT_ROUTING_RULES = [
    ("Operational review to L2", "L2 Reviewer", "BR-001", "North", None, 0, 0, 0, None, None, None, 1, 1),
    ("High risk to vigilance", "Vigilance Officer", None, "National", 80, 0, 0, 0, None, None, "Compliance SPOC", 1, 1),
    ("PEP or sanctions to compliance", "Compliance SPOC", None, "National", 60, 1, 1, 1, None, None, "Vigilance Officer", 1, 1),
    ("Linked accounts to L2", "L2 Reviewer", None, None, 50, 0, 0, 0, 4, None, None, 1, 1),
    ("Mule or fraud patterns to vigilance", "Vigilance Officer", None, None, None, 0, 0, 0, None, "mule|branch fraud|pass-through", "Compliance SPOC", 1, 1),
]


def utcnow_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        text = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except Exception:
        try:
            return datetime.strptime(str(value), "%Y-%m-%d %H:%M:%S")
        except Exception:
            return None


def detect_case_columns(column_names: List[str]) -> Dict[str, Optional[str]]:
    names = [str(col) for col in (column_names or [])]
    return {
        "case_id": next((c for c in names if "case" in c.lower() and ("id" in c.lower() or "no" in c.lower())), None),
        "alert_id": next((c for c in names if c.lower() in {"alert_id", "alertid"} or ("alert" in c.lower() and "id" in c.lower())), None),
        "customer_id": next((c for c in names if c.lower() in {"customer_id", "cust_id"}), None),
        "account_id": next((c for c in names if c.lower() in {"account_id", "acct_id"}), None),
        "branch_code": next((c for c in names if c.lower() in {"branch_code", "branch", "branch_id"}), None),
        "region": next((c for c in names if c.lower() in {"region", "zone"}), None),
        "scenario_name": next((c for c in names if c.lower() in {"scenario_name", "scenario", "alert_type", "rule_triggered"}), None),
        "risk_score": next((c for c in names if "risk_score" in c.lower()), None),
        "severity": next((c for c in names if c.lower() in {"severity", "risk_rating", "risk_level"}), None),
        "assigned_to": next((c for c in names if c.lower() in {"assigned_to", "analyst", "owner"}), None),
        "status": next((c for c in names if c.lower() == "status"), None),
        "created_at": next((c for c in names if c.lower() in {"created_at", "created_date", "case_open_date", "open_date"}), None),
        "updated_at": next((c for c in names if c.lower() in {"updated_at", "last_updated_at", "last_modified", "modified_at"}), None),
        "linked_accounts_count": next((c for c in names if c.lower() in {"linked_accounts_count", "linked_account_count"}), None),
        "pep_flag": next((c for c in names if c.lower() in {"pep_flag", "is_pep"}), None),
        "sanctions_flag": next((c for c in names if c.lower() in {"sanction_hit", "sanctions_flag"}), None),
        "adverse_media_flag": next((c for c in names if c.lower() in {"adverse_media_flag", "adverse_media"}), None),
        "customer_name": next((c for c in names if c.lower() in {"customer_name", "name"}), None),
    }


def ensure_case_queue_schema(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS case_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT UNIQUE NOT NULL,
            alert_id TEXT,
            customer_id TEXT,
            account_id TEXT,
            customer_name TEXT,
            branch_code TEXT,
            region TEXT,
            scenario_name TEXT,
            risk_score REAL,
            severity TEXT,
            current_status TEXT,
            current_stage TEXT,
            assigned_to TEXT,
            escalation_required INTEGER DEFAULT 0,
            escalation_level INTEGER DEFAULT 0,
            escalated_to TEXT,
            created_at TEXT,
            last_updated_at TEXT,
            sla_due_at TEXT,
            closed_at TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS case_status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT NOT NULL,
            old_status TEXT,
            new_status TEXT NOT NULL,
            changed_by TEXT,
            changed_at TEXT NOT NULL,
            remarks TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS case_escalations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT,
            batch_ref TEXT,
            escalation_type TEXT,
            escalation_level INTEGER,
            recipient_role TEXT,
            recipient_email TEXT,
            subject TEXT,
            body_snapshot TEXT,
            status TEXT,
            sent_at TEXT,
            sent_by TEXT,
            response_status TEXT,
            response_at TEXT,
            remarks TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS escalation_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_ref TEXT UNIQUE,
            total_cases INTEGER,
            recipient_group TEXT,
            created_by TEXT,
            created_at TEXT,
            mail_status TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS mail_recipients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            email TEXT NOT NULL,
            branch_code TEXT,
            region TEXT,
            case_types_supported TEXT,
            auto_route_enabled INTEGER DEFAULT 1,
            is_active INTEGER DEFAULT 1,
            created_at TEXT,
            updated_at TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS mail_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_name TEXT NOT NULL,
            template_type TEXT NOT NULL,
            subject_template TEXT NOT NULL,
            body_template TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            created_at TEXT,
            updated_at TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS mail_routing_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_name TEXT NOT NULL,
            recipient_role TEXT NOT NULL,
            branch_code TEXT,
            region TEXT,
            risk_score_min REAL,
            pep_required INTEGER DEFAULT 0,
            sanctions_required INTEGER DEFAULT 0,
            adverse_media_required INTEGER DEFAULT 0,
            linked_accounts_threshold INTEGER,
            case_type_pattern TEXT,
            copy_role TEXT,
            auto_route_enabled INTEGER DEFAULT 1,
            is_active INTEGER DEFAULT 1,
            created_at TEXT,
            updated_at TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS mail_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT,
            batch_ref TEXT,
            recipient_email TEXT,
            subject TEXT,
            send_status TEXT,
            error_message TEXT,
            sent_at TEXT
        )
        """
    )
    conn.commit()


class CaseQueueService:
    def __init__(self, db_manager, username: str = "system"):
        self.db_manager = db_manager
        self.username = username or "system"

    def _connect(self) -> sqlite3.Connection:
        conn = self.db_manager.connect()
        conn.row_factory = sqlite3.Row
        ensure_case_queue_schema(conn)
        return conn

    def _table_exists(self, conn: sqlite3.Connection, table_name: str) -> bool:
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", (table_name,))
        return cur.fetchone() is not None

    def _seed_default_templates(self, conn: sqlite3.Connection) -> None:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS count_value FROM mail_templates")
        row = cur.fetchone()
        now = utcnow_iso()
        if not row or int(row["count_value"] or 0) == 0:
            for template in DEFAULT_TEMPLATES:
                cur.execute(
                    """
                    INSERT INTO mail_templates (
                        template_name, template_type, subject_template, body_template, is_active, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 1, ?, ?)
                    """,
                    (
                        template["template_name"],
                        template["template_type"],
                        template["subject_template"],
                        template["body_template"],
                        now,
                        now,
                    ),
                )

        cur.execute("SELECT id, name, email FROM mail_recipients ORDER BY id")
        recipient_rows = [dict(item) for item in cur.fetchall()]
        should_replace_recipients = not recipient_rows or all(
            str(item.get("email") or "").endswith("@bank.demo")
            or str(item.get("name") or "") in {"Arjun Mehta", "Neha Sharma", "Ritika Rao", "Sanjay Gupta", "Priya Menon"}
            for item in recipient_rows
        )
        if should_replace_recipients:
            cur.execute("DELETE FROM mail_recipients")
            cur.executemany(
                """
                INSERT INTO mail_recipients (
                    name, role, email, branch_code, region, case_types_supported, auto_route_enabled, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        item["name"],
                        item["role"],
                        item["email"],
                        item["branch_code"],
                        item["region"],
                        json.dumps(item["case_types_supported"]),
                        1,
                        1,
                        now,
                        now,
                    )
                    for item in DEFAULT_RECIPIENTS
                ],
            )

        cur.execute("SELECT rule_name FROM mail_routing_rules ORDER BY id")
        existing_rules = [str(item["rule_name"]) for item in cur.fetchall()]
        should_replace_rules = not existing_rules or set(existing_rules).issubset(
            {
                "Branch manager by branch",
                "High risk to vigilance",
                "PEP or sanctions to compliance",
                "Linked accounts to L2",
                "Mule cases to vigilance",
            }
        )
        if should_replace_rules:
            cur.execute("DELETE FROM mail_routing_rules")
            cur.executemany(
                """
                INSERT INTO mail_routing_rules (
                    rule_name, recipient_role, branch_code, region, risk_score_min, pep_required, sanctions_required,
                    adverse_media_required, linked_accounts_threshold, case_type_pattern, copy_role,
                    auto_route_enabled, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [(*item, now, now) for item in DEFAULT_ROUTING_RULES],
            )
        conn.commit()

    def _normalize_status(self, status: Optional[str], risk_score: float = 0.0) -> str:
        text = str(status or "").strip()
        if text in STATUS_TO_STAGE:
            return text
        if not text:
            return "Open"
        lowered = text.lower()
        if "review" in lowered:
            return "In Review"
        if "sar" in lowered:
            return "SAR Recommended"
        if "close" in lowered:
            return "Closed"
        if "reject" in lowered or "no further action" in lowered:
            return "Rejected / No Further Action"
        if risk_score >= 85:
            return "Pending Vigilance Review"
        return "Open"

    def _derive_severity(self, risk_score: float, severity_value: Optional[str]) -> str:
        if severity_value:
            return str(severity_value).strip().title()
        if risk_score >= 85:
            return "Critical"
        if risk_score >= 70:
            return "High"
        if risk_score >= 45:
            return "Medium"
        return "Low"

    def _derive_escalation_level(self, risk_score: float, row: Dict[str, Any]) -> int:
        flags = [
            int(row.get("pep_flag") or 0),
            int(row.get("sanctions_flag") or 0),
            int(row.get("adverse_media_flag") or 0),
        ]
        linked_accounts = int(row.get("linked_accounts_count") or 0)
        if risk_score >= 85 or any(flags):
            return 3
        if risk_score >= 70 or linked_accounts >= 5:
            return 2
        if risk_score >= 50:
            return 1
        return 0

    def _derive_sla_due_at(self, created_at: Optional[str], severity: str) -> str:
        created = parse_iso(created_at) or datetime.utcnow()
        offset_days = 2 if severity == "Critical" else 3 if severity == "High" else 5 if severity == "Medium" else 7
        return (created + timedelta(days=offset_days)).replace(microsecond=0).isoformat() + "Z"

    def _sync_case_queue(self, conn: sqlite3.Connection) -> None:
        self._seed_default_templates(conn)
        if not self._table_exists(conn, "cases"):
            return

        cur = conn.cursor()
        cur.execute("PRAGMA table_info(cases)")
        columns = [row[1] for row in cur.fetchall()]
        detected = detect_case_columns(columns)
        case_id_col = detected.get("case_id")
        if not case_id_col:
            return

        cur.execute('SELECT * FROM "cases"')
        case_rows = [dict(row) for row in cur.fetchall()]
        now = utcnow_iso()
        for row in case_rows:
            case_id = str(row.get(case_id_col) or "").strip()
            if not case_id:
                continue

            risk_score = float(row.get(detected.get("risk_score")) or 0.0) if detected.get("risk_score") else 0.0
            severity = self._derive_severity(risk_score, row.get(detected.get("severity")) if detected.get("severity") else None)
            status = self._normalize_status(row.get(detected.get("status")) if detected.get("status") else None, risk_score)
            stage = STATUS_TO_STAGE.get(status, "Investigation")
            created_at = row.get(detected.get("created_at")) if detected.get("created_at") else now
            updated_at = row.get(detected.get("updated_at")) if detected.get("updated_at") else created_at or now
            escalation_level = self._derive_escalation_level(risk_score, row)
            escalation_required = 1 if escalation_level > 0 else 0

            cur.execute(
                """
                INSERT INTO case_queue (
                    case_id, alert_id, customer_id, account_id, customer_name, branch_code, region, scenario_name,
                    risk_score, severity, current_status, current_stage, assigned_to, escalation_required,
                    escalation_level, escalated_to, created_at, last_updated_at, sla_due_at, closed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(case_id) DO UPDATE SET
                    alert_id = excluded.alert_id,
                    customer_id = COALESCE(case_queue.customer_id, excluded.customer_id),
                    account_id = COALESCE(case_queue.account_id, excluded.account_id),
                    customer_name = COALESCE(case_queue.customer_name, excluded.customer_name),
                    branch_code = COALESCE(case_queue.branch_code, excluded.branch_code),
                    region = COALESCE(case_queue.region, excluded.region),
                    scenario_name = COALESCE(case_queue.scenario_name, excluded.scenario_name),
                    risk_score = excluded.risk_score,
                    severity = excluded.severity,
                    escalation_required = excluded.escalation_required,
                    escalation_level = excluded.escalation_level,
                    last_updated_at = COALESCE(case_queue.last_updated_at, excluded.last_updated_at),
                    sla_due_at = COALESCE(case_queue.sla_due_at, excluded.sla_due_at)
                """,
                (
                    case_id,
                    row.get(detected.get("alert_id")) if detected.get("alert_id") else None,
                    row.get(detected.get("customer_id")) if detected.get("customer_id") else None,
                    row.get(detected.get("account_id")) if detected.get("account_id") else None,
                    row.get(detected.get("customer_name")) if detected.get("customer_name") else None,
                    row.get(detected.get("branch_code")) if detected.get("branch_code") else "BR-001",
                    row.get(detected.get("region")) if detected.get("region") else "North",
                    row.get(detected.get("scenario_name")) if detected.get("scenario_name") else "Retained Alert Review",
                    risk_score,
                    severity,
                    status,
                    stage,
                    row.get(detected.get("assigned_to")) if detected.get("assigned_to") else "Unassigned",
                    escalation_required,
                    escalation_level,
                    None,
                    created_at,
                    updated_at,
                    self._derive_sla_due_at(created_at, severity),
                    updated_at if status in {"Closed", "Rejected / No Further Action"} else None,
                ),
            )
        conn.commit()

    def _row_to_queue_item(self, row: Dict[str, Any]) -> Dict[str, Any]:
        last_updated = parse_iso(row.get("last_updated_at"))
        created_at = parse_iso(row.get("created_at"))
        sla_due = parse_iso(row.get("sla_due_at"))
        now = datetime.utcnow()
        ageing_days = max(0, int((now - (created_at or now)).total_seconds() // 86400))
        overdue = bool(sla_due and now > sla_due and row.get("current_status") not in {"Closed", "Rejected / No Further Action"})
        return {
            **row,
            "risk_score": float(row.get("risk_score") or 0.0),
            "ageing_days": ageing_days,
            "is_overdue": overdue,
            "sla_label": "Overdue" if overdue else f"{max(0, int((sla_due - now).total_seconds() // 86400))}d left" if sla_due else "Unassigned",
        }

    def _apply_filters(self, rows: List[Dict[str, Any]], filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        search = str(filters.get("search") or "").strip().lower()
        status_filter = str(filters.get("status") or "").strip()
        stage_filter = str(filters.get("stage") or "").strip()
        risk_filter = str(filters.get("risk") or "").strip().lower()
        escalation_target = str(filters.get("escalated_to") or "").strip().lower()
        branch_filter = str(filters.get("branch") or "").strip().lower()
        region_filter = str(filters.get("region") or "").strip().lower()
        date_from = parse_iso(filters.get("date_from"))
        date_to = parse_iso(filters.get("date_to"))
        saved_view = str(filters.get("saved_view") or "All Cases").strip()

        filtered = []
        for row in rows:
            item = self._row_to_queue_item(row)
            if search:
                haystack = " ".join([
                    str(item.get("case_id") or ""),
                    str(item.get("customer_id") or ""),
                    str(item.get("account_id") or ""),
                    str(item.get("assigned_to") or ""),
                ]).lower()
                if search not in haystack:
                    continue
            if status_filter and item.get("current_status") != status_filter:
                continue
            if stage_filter and item.get("current_stage") != stage_filter:
                continue
            if risk_filter:
                score = float(item.get("risk_score") or 0.0)
                severity = str(item.get("severity") or "").lower()
                if risk_filter == "high" and not (score >= 70 or severity in {"critical", "high"}):
                    continue
                if risk_filter == "medium" and not (45 <= score < 70):
                    continue
                if risk_filter == "low" and not (score < 45):
                    continue
            if escalation_target and escalation_target not in str(item.get("escalated_to") or "").lower():
                continue
            if branch_filter and branch_filter not in str(item.get("branch_code") or "").lower():
                continue
            if region_filter and region_filter not in str(item.get("region") or "").lower():
                continue
            updated_dt = parse_iso(item.get("last_updated_at"))
            if date_from and (not updated_dt or updated_dt < date_from):
                continue
            if date_to and (not updated_dt or updated_dt > date_to + timedelta(days=1)):
                continue
            view_fn = SAVED_VIEWS.get(saved_view)
            if view_fn and not view_fn(item):
                continue
            filtered.append(item)
        return filtered

    def _compute_kpis(self, rows: List[Dict[str, Any]]) -> Dict[str, int]:
        counts = {
            "total_cases": len(rows),
            "open": 0,
            "in_review": 0,
            "pending_l2_review": 0,
            "escalated": 0,
            "awaiting_response": 0,
            "sar_recommended": 0,
            "closed": 0,
            "overdue": 0,
        }
        for row in rows:
            status = row.get("current_status")
            if status == "Open":
                counts["open"] += 1
            if status == "In Review":
                counts["in_review"] += 1
            if status == "Pending L2 Review":
                counts["pending_l2_review"] += 1
            if status in {"Escalated", "Pending L2 Review", "Pending BM Review", "Pending Vigilance Review"}:
                counts["escalated"] += 1
            if status == "Awaiting Response":
                counts["awaiting_response"] += 1
            if status == "SAR Recommended":
                counts["sar_recommended"] += 1
            if status in {"Closed", "Rejected / No Further Action"}:
                counts["closed"] += 1
            if row.get("is_overdue"):
                counts["overdue"] += 1
        return counts

    def list_queue(self, filters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        filters = filters or {}
        page = max(1, int(filters.get("page") or 1))
        page_size = max(10, min(100, int(filters.get("page_size") or 25)))
        sort_by = str(filters.get("sort_by") or "risk_score")
        sort_dir = str(filters.get("sort_dir") or "desc").lower()

        conn = self._connect()
        try:
            self._sync_case_queue(conn)
            cur = conn.cursor()
            cur.execute("SELECT * FROM case_queue")
            rows = [dict(row) for row in cur.fetchall()]
            filtered = self._apply_filters(rows, filters)

            reverse = sort_dir != "asc"
            sort_key = {
                "risk_score": lambda item: float(item.get("risk_score") or 0.0),
                "ageing": lambda item: int(item.get("ageing_days") or 0),
                "last_updated": lambda item: parse_iso(item.get("last_updated_at")) or datetime.min,
                "sla": lambda item: parse_iso(item.get("sla_due_at")) or datetime.max,
            }.get(sort_by, lambda item: parse_iso(item.get("last_updated_at")) or datetime.min)
            filtered.sort(key=sort_key, reverse=reverse)

            total = len(filtered)
            start = (page - 1) * page_size
            end = start + page_size
            paged = filtered[start:end]

            return {
                "rows": paged,
                "kpis": self._compute_kpis(filtered),
                "saved_views": list(SAVED_VIEWS.keys()),
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": total,
                    "total_pages": max(1, (total + page_size - 1) // page_size),
                },
                "meta": {
                    "refreshed_at": utcnow_iso(),
                    "live_mode": "polling",
                },
            }
        finally:
            self.db_manager.close_connection(conn)

    def get_case_queue_row(self, case_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            self._sync_case_queue(conn)
            cur = conn.cursor()
            cur.execute("SELECT * FROM case_queue WHERE case_id = ?", (str(case_id),))
            row = cur.fetchone()
            return self._row_to_queue_item(dict(row)) if row else None
        finally:
            self.db_manager.close_connection(conn)

    def get_status_history(self, case_id: str) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute("SELECT * FROM case_status_history WHERE case_id = ? ORDER BY changed_at DESC", (str(case_id),))
            return [dict(row) for row in cur.fetchall()]
        finally:
            self.db_manager.close_connection(conn)

    def _validate_status_change(self, row: Dict[str, Any], new_status: str) -> None:
        if new_status not in STATUS_TO_STAGE:
            raise ValueError("Unsupported status transition.")
        if row.get("current_status") in {"Closed", "Rejected / No Further Action"} and new_status not in {row.get("current_status")}:
            raise ValueError("Closed cases are read-only except for privileged reopen actions.")
        high_risk = float(row.get("risk_score") or 0.0) >= 80 or str(row.get("severity") or "").lower() == "critical"
        if new_status in {"Closed", "Rejected / No Further Action"} and high_risk:
            if row.get("current_status") not in REVIEW_REQUIRED_STATUSES and not row.get("escalated_to"):
                raise ValueError("High-risk cases require reviewer sign-off before closure.")

    def update_status(self, case_id: str, new_status: str, remarks: str = "", changed_by: str = "system") -> Dict[str, Any]:
        conn = self._connect()
        try:
            self._sync_case_queue(conn)
            cur = conn.cursor()
            cur.execute("SELECT * FROM case_queue WHERE case_id = ?", (str(case_id),))
            row = cur.fetchone()
            if not row:
                raise ValueError(f"Case {case_id} not found in queue.")
            current = dict(row)
            self._validate_status_change(current, new_status)
            now = utcnow_iso()
            stage = STATUS_TO_STAGE.get(new_status, current.get("current_stage") or "Investigation")
            closed_at = now if new_status in {"Closed", "Rejected / No Further Action"} else None
            cur.execute(
                """
                UPDATE case_queue
                SET current_status = ?, current_stage = ?, last_updated_at = ?, closed_at = ?
                WHERE case_id = ?
                """,
                (new_status, stage, now, closed_at, str(case_id)),
            )
            cur.execute(
                """
                INSERT INTO case_status_history (
                    case_id, old_status, new_status, changed_by, changed_at, remarks
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (str(case_id), current.get("current_status"), new_status, changed_by, now, remarks),
            )
            conn.commit()
            cur.execute("SELECT * FROM case_queue WHERE case_id = ?", (str(case_id),))
            return self._row_to_queue_item(dict(cur.fetchone()))
        finally:
            self.db_manager.close_connection(conn)

    def batch_update_status(self, case_ids: List[str], new_status: str, remarks: str = "", changed_by: str = "system") -> Dict[str, Any]:
        updated = []
        errors = []
        for case_id in case_ids or []:
            try:
                updated.append(self.update_status(case_id, new_status, remarks=remarks, changed_by=changed_by))
            except Exception as exc:
                errors.append({"case_id": str(case_id), "error": str(exc)})
        return {"updated": updated, "errors": errors}

    def assign_owner(self, case_id: str, owner: str, changed_by: str = "system", remarks: str = "") -> Dict[str, Any]:
        conn = self._connect()
        try:
            self._sync_case_queue(conn)
            cur = conn.cursor()
            cur.execute("UPDATE case_queue SET assigned_to = ?, last_updated_at = ? WHERE case_id = ?", (owner, utcnow_iso(), str(case_id)))
            cur.execute(
                """
                INSERT INTO case_status_history (case_id, old_status, new_status, changed_by, changed_at, remarks)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (str(case_id), None, "Owner Assigned", changed_by, utcnow_iso(), remarks or f"Assigned to {owner}"),
            )
            conn.commit()
            cur.execute("SELECT * FROM case_queue WHERE case_id = ?", (str(case_id),))
            row = cur.fetchone()
            return self._row_to_queue_item(dict(row)) if row else {}
        finally:
            self.db_manager.close_connection(conn)
