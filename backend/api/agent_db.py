import os
import sqlite3
import json
import uuid
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'agentic_investigation.db')

def get_db_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS investigation_session (
            id TEXT PRIMARY KEY,
            case_id TEXT,
            status TEXT,
            start_time DATETIME,
            end_time DATETIME,
            current_step TEXT,
            risk_score REAL,
            confidence REAL
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS investigation_plan (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            step_number INTEGER,
            action_name TEXT,
            description TEXT,
            status TEXT,
            result_summary TEXT,
            timestamp DATETIME
        )
    ''')

    # Store the configurable agent definitions used by the visual workflow canvas.
    c.execute('''
        CREATE TABLE IF NOT EXISTS agent_definitions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            agent_type TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            description TEXT,
            instructions TEXT,
            config_json TEXT,
            created_at DATETIME,
            updated_at DATETIME
        )
    ''')

    # Lightweight migration for sessions created before canvas agents existed.
    plan_columns = {row["name"] for row in c.execute("PRAGMA table_info(investigation_plan)").fetchall()}
    if "agent_id" not in plan_columns:
        c.execute("ALTER TABLE investigation_plan ADD COLUMN agent_id TEXT")
    if "agent_type" not in plan_columns:
        c.execute("ALTER TABLE investigation_plan ADD COLUMN agent_type TEXT")

    agent_columns = {row["name"] for row in c.execute("PRAGMA table_info(agent_definitions)").fetchall()}
    if "description" not in agent_columns:
        c.execute("ALTER TABLE agent_definitions ADD COLUMN description TEXT")

    c.execute('''
        CREATE TABLE IF NOT EXISTS investigation_memory (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            memory_text TEXT,
            updated_at DATETIME
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS tool_execution_log (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            tool_name TEXT,
            input_params TEXT,
            output_data TEXT,
            summary TEXT,
            status TEXT,
            execution_time_ms INTEGER,
            timestamp DATETIME
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS activity_log (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            message TEXT,
            level TEXT,
            timestamp DATETIME
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS generated_documents (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            doc_type TEXT,
            content TEXT,
            timestamp DATETIME
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS investigation_findings (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            findings_json TEXT,
            timestamp DATETIME
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS llm_interaction_log (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            stage TEXT,
            provider TEXT,
            model TEXT,
            prompt_text TEXT,
            response_text TEXT,
            metadata_json TEXT,
            timestamp DATETIME
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS llm_token_usage (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            model TEXT,
            provider TEXT,
            stage TEXT,
            prompt_tokens INTEGER,
            completion_tokens INTEGER,
            total_tokens INTEGER,
            cost_usd REAL,
            timestamp DATETIME
        )
    ''')

    conn.commit()
    conn.close()

# Initialize DB on import
init_db()

# --- Helpers ---

def create_session(case_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    session_id = str(uuid.uuid4())
    c.execute(
        "INSERT INTO investigation_session (id, case_id, status, start_time, current_step) VALUES (?, ?, ?, ?, ?)",
        (session_id, case_id, 'running', datetime.now().isoformat(), 'Initializing')
    )
    conn.commit()
    conn.close()
    return session_id

def log_activity(session_id: str, message: str, level: str = 'info'):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute(
        "INSERT INTO activity_log (id, session_id, message, level, timestamp) VALUES (?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), session_id, message, level, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()

def get_session(session_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM investigation_session WHERE id = ?", (session_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

def get_session_by_case(case_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM investigation_session WHERE case_id = ? ORDER BY start_time DESC LIMIT 1", (case_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

def get_all_latest_sessions():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('''
        SELECT s.*, 
               (SELECT model FROM llm_interaction_log l WHERE l.session_id = s.id LIMIT 1) as model,
               (SELECT COUNT(*) FROM investigation_plan p WHERE p.session_id = s.id AND p.status = 'completed') as completed_steps,
               (SELECT COUNT(*) FROM investigation_plan p WHERE p.session_id = s.id) as total_steps
        FROM investigation_session s
        WHERE id IN (
            SELECT id FROM investigation_session 
            GROUP BY case_id 
            HAVING start_time = MAX(start_time)
        )
        ORDER BY start_time DESC
    ''')
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_activities(session_id: str, limit: int = 500):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM activity_log WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?", (session_id, limit))
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def update_session_status(session_id: str, status: str, current_step: str = None):
    conn = get_db_connection()
    c = conn.cursor()
    if current_step:
        c.execute("UPDATE investigation_session SET status = ?, current_step = ? WHERE id = ?", (status, current_step, session_id))
    else:
        c.execute("UPDATE investigation_session SET status = ? WHERE id = ?", (status, session_id))
    conn.commit()
    conn.close()

def get_plan(session_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM investigation_plan WHERE session_id = ? ORDER BY step_number ASC", (session_id,))
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_agent_definitions():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM agent_definitions ORDER BY created_at ASC")
    rows = c.fetchall()
    conn.close()
    result = []
    for row in rows:
        item = dict(row)
        item["config"] = json.loads(item.pop("config_json") or "{}")
        result.append(item)
    return result


def save_agent_definition(agent: dict):
    now = datetime.now().isoformat()
    agent_id = str(agent.get("id") or uuid.uuid4())
    conn = get_db_connection()
    c = conn.cursor()
    c.execute(
        """
        INSERT INTO agent_definitions (id, name, agent_type, tool_name, description, instructions, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            agent_type=excluded.agent_type,
            tool_name=excluded.tool_name,
            description=excluded.description,
            instructions=excluded.instructions,
            config_json=excluded.config_json,
            updated_at=excluded.updated_at
        """,
        (
            agent_id,
            str(agent.get("name") or "Custom Investigation Agent"),
            str(agent.get("agent_type") or "custom"),
            str(agent.get("tool_name") or ""),
            str(agent.get("description") or ""),
            str(agent.get("instructions") or ""),
            json.dumps(agent.get("config") or {}),
            now,
            now,
        ),
    )
    conn.commit()
    conn.close()
    return agent_id


def delete_agent_definition(agent_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("DELETE FROM agent_definitions WHERE id = ?", (agent_id,))
    conn.commit()
    conn.close()

def get_memory(session_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM investigation_memory WHERE session_id = ?", (session_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

def update_memory(session_id: str, memory_text: str):
    conn = get_db_connection()
    c = conn.cursor()
    mem = get_memory(session_id)
    now = datetime.now().isoformat()
    if mem:
        c.execute("UPDATE investigation_memory SET memory_text = ?, updated_at = ? WHERE session_id = ?", (memory_text, now, session_id))
    else:
        c.execute("INSERT INTO investigation_memory (id, session_id, memory_text, updated_at) VALUES (?, ?, ?, ?)", (str(uuid.uuid4()), session_id, memory_text, now))
    conn.commit()
    conn.close()

def save_document(session_id: str, doc_type: str, content: str):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("INSERT INTO generated_documents (id, session_id, doc_type, content, timestamp) VALUES (?, ?, ?, ?, ?)", 
        (str(uuid.uuid4()), session_id, doc_type, content, datetime.now().isoformat()))
    conn.commit()
    conn.close()

def get_documents(session_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM generated_documents WHERE session_id = ? ORDER BY timestamp ASC", (session_id,))
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_tool_execution_log(session_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM tool_execution_log WHERE session_id = ? ORDER BY timestamp ASC", (session_id,))
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_document(document_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM generated_documents WHERE id = ?", (document_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

def save_llm_interaction(session_id: str, stage: str, provider: str, model: str, prompt_text: str, response_text: str, metadata: dict = None):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute(
        """
        INSERT INTO llm_interaction_log
            (id, session_id, stage, provider, model, prompt_text, response_text, metadata_json, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(uuid.uuid4()),
            session_id,
            stage,
            provider,
            model,
            prompt_text,
            response_text,
            json.dumps(metadata or {}),
            datetime.now().isoformat(),
        ),
    )
    conn.commit()
    conn.close()

def get_llm_interactions(session_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM llm_interaction_log WHERE session_id = ? ORDER BY timestamp ASC", (session_id,))
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def save_findings(session_id: str, findings_data: dict):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("INSERT INTO investigation_findings (id, session_id, findings_json, timestamp) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), session_id, json.dumps(findings_data), datetime.now().isoformat()))
    conn.commit()
    conn.close()

def get_findings(session_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT findings_json FROM investigation_findings WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1", (session_id,))
    row = c.fetchone()
    conn.close()
    if row and row['findings_json']:
        return json.loads(row['findings_json'])
    return None


def record_token_usage(
    session_id: str | None,
    model: str,
    provider: str = "openai",
    stage: str = "general",
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    cost_usd: float | None = None,
) -> None:
    if total_tokens <= 0:
        total_tokens = prompt_tokens + completion_tokens
    if cost_usd is None:
        cost_usd = round((prompt_tokens * 0.0000025) + (completion_tokens * 0.0000100), 6)
    conn = get_db_connection()
    c = conn.cursor()
    c.execute(
        """
        INSERT INTO llm_token_usage
            (id, session_id, model, provider, stage, prompt_tokens, completion_tokens, total_tokens, cost_usd, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(uuid.uuid4()),
            session_id or "",
            model or "unknown",
            provider or "openai",
            stage or "general",
            prompt_tokens,
            completion_tokens,
            total_tokens,
            cost_usd,
            datetime.now().isoformat(),
        ),
    )
    conn.commit()
    conn.close()


def get_token_usage_stats() -> dict:
    conn = get_db_connection()
    c = conn.cursor()
    today_str = datetime.now().strftime("%Y-%m-%d")

    # Today stats
    c.execute(
        """
        SELECT 
            COALESCE(SUM(total_tokens), 0) as tokens_today,
            COALESCE(SUM(prompt_tokens), 0) as prompt_tokens_today,
            COALESCE(SUM(completion_tokens), 0) as completion_tokens_today,
            COALESCE(SUM(cost_usd), 0.0) as cost_today,
            COUNT(*) as calls_today
        FROM llm_token_usage
        WHERE timestamp LIKE ?
        """,
        (f"{today_str}%",),
    )
    today_row = dict(c.fetchone() or {})

    # Lifetime stats
    c.execute(
        """
        SELECT 
            COALESCE(SUM(total_tokens), 0) as tokens_lifetime,
            COALESCE(SUM(prompt_tokens), 0) as prompt_tokens_lifetime,
            COALESCE(SUM(completion_tokens), 0) as completion_tokens_lifetime,
            COALESCE(SUM(cost_usd), 0.0) as cost_lifetime,
            COUNT(*) as calls_lifetime
        FROM llm_token_usage
        """
    )
    lifetime_row = dict(c.fetchone() or {})

    # Daily breakdown (past 14 days)
    c.execute(
        """
        SELECT 
            SUBSTR(timestamp, 1, 10) as day,
            SUM(total_tokens) as total_tokens,
            SUM(prompt_tokens) as prompt_tokens,
            SUM(completion_tokens) as completion_tokens,
            ROUND(SUM(cost_usd), 4) as cost_usd,
            COUNT(*) as call_count
        FROM llm_token_usage
        GROUP BY SUBSTR(timestamp, 1, 10)
        ORDER BY day DESC
        LIMIT 14
        """
    )
    daily_rows = [dict(r) for r in c.fetchall()]

    # Recent session calls (latest 30)
    c.execute(
        """
        SELECT 
            id, session_id, model, provider, stage,
            prompt_tokens, completion_tokens, total_tokens, cost_usd, timestamp
        FROM llm_token_usage
        ORDER BY timestamp DESC
        LIMIT 30
        """
    )
    recent_calls = [dict(r) for r in c.fetchall()]
    conn.close()

    budget_limit = 2.00
    cost_lifetime = float(lifetime_row.get("cost_lifetime") or 0.0)
    remaining_budget = max(0.0, round(budget_limit - cost_lifetime, 4))
    budget_used_percent = min(100.0, round((cost_lifetime / budget_limit) * 100, 1))

    return {
        "tokens_today": int(today_row.get("tokens_today") or 0),
        "prompt_tokens_today": int(today_row.get("prompt_tokens_today") or 0),
        "completion_tokens_today": int(today_row.get("completion_tokens_today") or 0),
        "cost_today": round(float(today_row.get("cost_today") or 0.0), 4),
        "calls_today": int(today_row.get("calls_today") or 0),
        "tokens_lifetime": int(lifetime_row.get("tokens_lifetime") or 0),
        "prompt_tokens_lifetime": int(lifetime_row.get("prompt_tokens_lifetime") or 0),
        "completion_tokens_lifetime": int(lifetime_row.get("completion_tokens_lifetime") or 0),
        "cost_lifetime": round(cost_lifetime, 4),
        "calls_lifetime": int(lifetime_row.get("calls_lifetime") or 0),
        "budget_limit": budget_limit,
        "remaining_budget": remaining_budget,
        "budget_used_percent": budget_used_percent,
        "daily_history": daily_rows[::-1],
        "recent_calls": recent_calls,
    }
