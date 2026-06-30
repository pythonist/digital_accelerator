import sqlite3
import os
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
               (SELECT model FROM llm_interaction_log l WHERE l.session_id = s.id LIMIT 1) as model
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

def get_activities(session_id: str, limit: int = 100):
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
