import ast
import inspect
from pathlib import Path
import duckdb

from services.mule_detection.db_service import get_md_db_service

try:
    from features.feature_engineer import FeatureEngineer
    _FE_OK = True
except Exception:
    FeatureEngineer = None
    _FE_OK = False

try:
    from features.feature_store import FeatureStore
    _FS_OK = True
except Exception:
    FeatureStore = None
    _FS_OK = False


_ORIGIN_INDEX = None


def _first_line(s: str | None) -> str | None:
    if not s:
        return None
    t = str(s).strip()
    if not t:
        return None
    return t.splitlines()[0].strip() or None


def _format_call_target(fn: ast.AST) -> str | None:
    if isinstance(fn, ast.Attribute):
        base = None
        if isinstance(fn.value, ast.Name):
            base = fn.value.id
        if base == "self":
            return f"{fn.attr}()"
        if base:
            return f"{base}.{fn.attr}()"
        return f"{fn.attr}()"
    if isinstance(fn, ast.Name):
        return f"{fn.id}()"
    return None


def _family_from_method(method_name: str) -> str | None:
    n = str(method_name or "")
    if n.startswith("_engineer_") and n.endswith("_features"):
        mid = n[len("_engineer_") : -len("_features")]
        return mid.replace("_", " ")
    if n == "_add_derived_features":
        return "derived"
    if n == "_calculate_rule_scores":
        return "risk scores"
    return None


def _window_hint(name: str) -> str | None:
    n = str(name or "").lower()
    if "24h" in n:
        return "last 24 hours"
    if "7d" in n:
        return "last 7 days"
    if "30d" in n:
        return "last 30 days"
    if "90d" in n:
        return "last 90 days"
    return None


def _col_name_from_subscript(node: ast.AST) -> str | None:
    if not isinstance(node, ast.Subscript):
        return None
    sl = node.slice
    if isinstance(sl, ast.Constant) and isinstance(sl.value, str):
        return str(sl.value)
    return None


def _describe_df(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        hint = _window_hint(node.id)
        if hint:
            return hint
        return node.id
    return None


def _describe_tx_subset(node: ast.AST) -> str | None:
    if isinstance(node, ast.Subscript):
        base = _describe_tx_subset(node.value) or _describe_df(node.value)
        if base:
            return base
        return None
    if isinstance(node, ast.Name):
        hint = _window_hint(node.id)
        if hint:
            return hint
        if node.id in ["account_df", "transactions_df", "all_df", "tx", "df"]:
            return "transactions"
        return node.id
    if isinstance(node, ast.Call):
        if isinstance(node.func, ast.Attribute) and node.func.attr in ["copy", "sort_values", "reset_index", "dropna", "astype", "to_datetime"]:
            return _describe_tx_subset(node.func.value)
    return None


def _literal(v: ast.AST) -> str | None:
    if isinstance(v, ast.Constant):
        return str(v.value)
    return None


def _cond_summary(node: ast.AST) -> str | None:
    if isinstance(node, ast.Compare):
        left = _cond_summary(node.left) or _literal(node.left) or "value"
        if len(node.ops) == 1 and len(node.comparators) == 1:
            op = node.ops[0]
            right = _cond_summary(node.comparators[0]) or _literal(node.comparators[0]) or "threshold"
            if isinstance(op, ast.Gt):
                return f"{left} > {right}"
            if isinstance(op, ast.GtE):
                return f"{left} ≥ {right}"
            if isinstance(op, ast.Lt):
                return f"{left} < {right}"
            if isinstance(op, ast.LtE):
                return f"{left} ≤ {right}"
            if isinstance(op, ast.Eq):
                return f"{left} = {right}"
            if isinstance(op, ast.NotEq):
                return f"{left} ≠ {right}"
        return "condition"
    if isinstance(node, ast.BoolOp):
        parts = [_cond_summary(v) for v in node.values]
        parts = [p for p in parts if p]
        if not parts:
            return None
        join = " AND " if isinstance(node.op, ast.And) else " OR "
        return join.join(parts[:3]) if len(parts) <= 3 else join.join(parts[:3]) + "…"
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        inner = _cond_summary(node.operand) or "condition"
        return f"NOT ({inner})"
    if isinstance(node, ast.Call):
        t = _format_call_target(node.func)
        return t or "condition"
    if isinstance(node, ast.Name):
        h = _window_hint(node.id)
        return h or node.id
    return None


def _explain_expr(node: ast.AST, assigns: dict[str, ast.AST], seen: set[str]) -> str | None:
    if node is None:
        return None
    if isinstance(node, ast.Name):
        n = node.id
        if n in assigns and n not in seen:
            seen.add(n)
            return _explain_expr(assigns[n], assigns, seen)
        hint = _window_hint(n)
        return hint or n

    if isinstance(node, ast.IfExp):
        body = _explain_expr(node.body, assigns, seen) or "1"
        cond = _cond_summary(node.test) or "condition"
        return f"{body} if {cond} else 0"

    if isinstance(node, ast.Call):
        if isinstance(node.func, ast.Name) and node.func.id == "len" and node.args:
            subset = _describe_tx_subset(node.args[0]) or "transactions"
            hint = _window_hint(subset)
            return f"Count of {subset}" if not hint else f"Count of {hint}"

        if isinstance(node.func, ast.Attribute):
            m = node.func.attr
            base = node.func.value

            if m in ["sum", "mean", "std", "max", "min"] and not node.args:
                subj = None
                if isinstance(base, ast.Subscript):
                    col = _col_name_from_subscript(base) or _col_name_from_subscript(base.value)
                    subset = _describe_tx_subset(base.value) or _describe_tx_subset(base) or "transactions"
                    if col:
                        subj = f"{col} over {subset}"
                if subj is None:
                    subj = _describe_tx_subset(base) or "values"
                op = {"sum": "Sum", "mean": "Average", "std": "Std dev", "max": "Max", "min": "Min"}[m]
                return f"{op} of {subj}"

            if m == "nunique":
                subj = None
                if isinstance(base, ast.Subscript):
                    col = _col_name_from_subscript(base)
                    subset = _describe_tx_subset(base.value) or "transactions"
                    if col:
                        subj = f"{col} over {subset}"
                if subj is None:
                    subj = _describe_tx_subset(base) or "values"
                return f"Distinct count of {subj}"

        t = _format_call_target(node.func) or "function"
        fn = str(t).replace("()", "")
        if fn in ["_safe_divide", "safe_divide"] and len(node.args) >= 2:
            a = _explain_expr(node.args[0], assigns, seen) or "numerator"
            b = _explain_expr(node.args[1], assigns, seen) or "denominator"
            return f"Ratio of {a} to {b}"

        if fn.startswith("_check_") or fn.endswith("_flag") or fn.endswith("_flagged"):
            return f"Flag computed by {t}"
        if fn.startswith("_calculate_"):
            return f"Computed by {t}"

        return f"Computed by {t}"

    if isinstance(node, ast.BinOp):
        if isinstance(node.op, ast.Div):
            a = _explain_expr(node.left, assigns, seen) or "numerator"
            b = _explain_expr(node.right, assigns, seen) or "denominator"
            return f"Ratio of {a} to {b}"
        if isinstance(node.op, ast.Sub):
            a = _explain_expr(node.left, assigns, seen) or "a"
            b = _explain_expr(node.right, assigns, seen) or "b"
            return f"Difference: {a} minus {b}"
        if isinstance(node.op, ast.Add):
            a = _explain_expr(node.left, assigns, seen) or "a"
            b = _explain_expr(node.right, assigns, seen) or "b"
            return f"Sum: {a} plus {b}"

    if isinstance(node, ast.Compare):
        c = _cond_summary(node) or "condition"
        return f"Flag if {c}"

    return None


def _build_origin_index() -> dict:
    if not _FE_OK or FeatureEngineer is None:
        return {"python": {}, "python_file": None, "builder_index": {}}

    src_file = inspect.getsourcefile(FeatureEngineer)
    if not src_file:
        return {"python": {}, "python_file": None, "builder_index": {}}
    p = Path(src_file)
    try:
        text = p.read_text(encoding="utf-8")
    except Exception:
        text = p.read_text(encoding="utf-8", errors="ignore")

    tree = ast.parse(text)
    fe_class = None
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "FeatureEngineer":
            fe_class = node
            break
    if fe_class is None:
        return {"python": {}, "python_file": str(p), "builder_index": {}}

    methods = {}
    for node in fe_class.body:
        if isinstance(node, ast.FunctionDef):
            methods[node.name] = node

    out = {}
    for name, fn in methods.items():
        family = _family_from_method(name)
        if family is None and not name.startswith("_engineer_"):
            continue

        assigns: dict[str, ast.AST] = {}
        for stmt in fn.body:
            if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
                assigns[stmt.targets[0].id] = stmt.value
            if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name) and stmt.value is not None:
                assigns[stmt.target.id] = stmt.value

        for sub in ast.walk(fn):
            if not isinstance(sub, ast.Return):
                continue
            if not isinstance(sub.value, ast.Dict):
                continue
            d: ast.Dict = sub.value
            for k, v in zip(d.keys, d.values):
                if not isinstance(k, ast.Constant) or not isinstance(k.value, str):
                    continue
                feature_name = str(k.value)
                built_by = name
                if isinstance(v, ast.Call):
                    built_by = _format_call_target(v.func) or name
                human_logic = _explain_expr(v, assigns, seen=set()) if v is not None else None
                info = {
                    "origin": "python",
                    "family": family,
                    "origin_module": name,
                    "built_by": built_by,
                    "human_logic": human_logic,
                    "code_location": {
                        "file": str(p),
                        "origin_function": name,
                        "origin_start_line": int(getattr(fn, "lineno", 0) or 0),
                        "origin_end_line": int(getattr(fn, "end_lineno", 0) or 0),
                    },
                }
                out[feature_name] = info

    builder_index = {}
    for name, fn in methods.items():
        ds = ast.get_docstring(fn)
        builder_index[name] = {
            "doc": _first_line(ds),
            "start_line": int(getattr(fn, "lineno", 0) or 0),
            "end_line": int(getattr(fn, "end_lineno", 0) or 0),
        }

    return {"python": out, "python_file": str(p), "builder_index": builder_index}


def _origin_index() -> dict:
    global _ORIGIN_INDEX
    if _ORIGIN_INDEX is None:
        _ORIGIN_INDEX = _build_origin_index()
    return _ORIGIN_INDEX


class FeatureOriginService:
    def __init__(self, env_id: str):
        self.env_id = env_id
        self.md_db = get_md_db_service()
        self._fs = FeatureStore() if _FS_OK and FeatureStore is not None else None

    def _conn(self) -> tuple[duckdb.DuckDBPyConnection, dict]:
        return self.md_db.connect(self.env_id)

    def _feature_type_from_duckdb(self, conn: duckdb.DuckDBPyConnection, feature_name: str) -> tuple[str | None, str | None]:
        try:
            cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
        except Exception:
            return None, None
        if len(cols_df) == 0:
            return None, None
        row = cols_df[cols_df["name"] == feature_name]
        if len(row) == 0:
            return None, None
        duck_type = str(row.iloc[0]["type"] or "").upper()
        kind = None
        if "DOUBLE" in duck_type or "FLOAT" in duck_type or "INT" in duck_type or "DECIMAL" in duck_type:
            kind = "numeric"
        elif "BOOL" in duck_type:
            kind = "binary"
        else:
            kind = "categorical"
        return kind, duck_type

    def _latest_meta(self, conn: duckdb.DuckDBPyConnection, feature_name: str) -> dict:
        try:
            row = conn.execute(
                """
                SELECT typology, business_description, expected_risk_direction, owner, window_spec AS window, data_source, updated_at,
                       entity_level, aggregation, direction, transformation_sql, origin_module, built_by, code_location
                FROM mule_feature_metadata
                WHERE environment_id = ? AND feature_name = ?
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                [self.env_id, feature_name],
            ).fetchone()
        except Exception:
            try:
                row = conn.execute(
                    """
                    SELECT typology, business_description, expected_risk_direction, owner, "window" AS window, data_source, updated_at,
                           entity_level, aggregation, direction, transformation_sql, origin_module, built_by, code_location
                    FROM mule_feature_metadata
                    WHERE environment_id = ? AND feature_name = ?
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """,
                    [self.env_id, feature_name],
                ).fetchone()
            except Exception:
                row = conn.execute(
                    """
                    SELECT typology, business_description, expected_risk_direction, owner, "window" AS window, data_source, updated_at
                    FROM mule_feature_metadata
                    WHERE environment_id = ? AND feature_name = ?
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """,
                    [self.env_id, feature_name],
                ).fetchone()
        if not row:
            return {}

        if len(row) <= 7:
            typology, business_description, expected_risk_direction, owner, window, data_source, updated_at = row
            return {
                "typology": typology,
                "business_description": business_description,
                "expected_risk_direction": expected_risk_direction,
                "owner": owner,
                "window": window,
                "data_source": data_source,
                "updated_at": str(updated_at),
            }

        (
            typology,
            business_description,
            expected_risk_direction,
            owner,
            window,
            data_source,
            updated_at,
            entity_level,
            aggregation,
            direction,
            transformation_sql,
            origin_module,
            built_by,
            code_location,
        ) = row
        return {
            "typology": typology,
            "business_description": business_description,
            "expected_risk_direction": expected_risk_direction,
            "owner": owner,
            "window": window,
            "data_source": data_source,
            "updated_at": str(updated_at),
            "entity_level": entity_level,
            "aggregation": aggregation,
            "direction": direction,
            "transformation_sql": transformation_sql,
            "origin_module": origin_module,
            "built_by": built_by,
            "code_location": code_location,
        }

    def feature_origin(self, feature_name: str):
        feature_name = str(feature_name or "").strip()
        if not feature_name:
            return {"success": False, "error": "feature is required"}

        idx = _origin_index()
        python_map = idx.get("python") or {}
        builders = idx.get("builder_index") or {}

        fs_def = None
        if self._fs is not None:
            fs_def = (self._fs.feature_definitions or {}).get(feature_name)

        conn, _paths = self._conn()
        try:
            kind, duck_type = self._feature_type_from_duckdb(conn, feature_name)
            meta = self._latest_meta(conn, feature_name)
        finally:
            conn.close()

        origin = python_map.get(feature_name)
        origin_type = None
        family = None
        built_by = None
        origin_module = None
        code_location = None
        construction_logic = None

        if fs_def is not None:
            origin_type = "sql" if getattr(fs_def, "sql_query", None) else "python"
            family = getattr(fs_def, "feature_category", None)
            built_by = getattr(fs_def, "python_function", None) or ("FeatureStore SQL" if origin_type == "sql" else "FeatureStore Python")
            origin_module = "FeatureStore"
            code_location = str(Path(inspect.getsourcefile(FeatureStore)).resolve()) if _FS_OK and FeatureStore is not None and inspect.getsourcefile(FeatureStore) else None
            construction_logic = _first_line(getattr(fs_def, "description", None))
        elif origin is not None:
            origin_type = "python"
            family = origin.get("family")
            built_by = origin.get("built_by") or origin.get("origin_module")
            origin_module = origin.get("origin_module")
            cl = origin.get("code_location") or {}
            code_location = {
                **cl,
                "builder_doc": None,
            }
            if origin.get("human_logic"):
                construction_logic = origin.get("human_logic")
            if built_by:
                bname = str(built_by).replace("()", "")
                b = builders.get(bname)
                if b:
                    if construction_logic is None:
                        construction_logic = b.get("doc")
                    code_location["builder_function"] = bname
                    code_location["builder_start_line"] = b.get("start_line")
                    code_location["builder_end_line"] = b.get("end_line")
            if construction_logic is None:
                construction_logic = _first_line(meta.get("business_description"))
        elif meta:
            origin_type = "metadata"
            family = meta.get("origin_module")
            built_by = meta.get("built_by")
            origin_module = meta.get("origin_module")
            construction_logic = _first_line(meta.get("business_description"))
            code_location = meta.get("code_location")

        entity_level = meta.get("entity_level") or "account"
        window = meta.get("window")
        data_source = meta.get("data_source")

        transformation = None
        if isinstance(meta.get("transformation_sql"), str) and meta.get("transformation_sql").strip():
            transformation = {"type": "sql", "body": meta.get("transformation_sql")}
        elif fs_def is not None and getattr(fs_def, "sql_query", None):
            transformation = {"type": "sql", "body": getattr(fs_def, "sql_query")}
        elif fs_def is not None and getattr(fs_def, "python_function", None):
            transformation = {"type": "python", "body": getattr(fs_def, "python_function")}
        else:
            transformation = None

        return {
            "success": True,
            "feature_name": feature_name,
            "type": kind,
            "duckdb_type": duck_type,
            "origin_type": origin_type,
            "family": family,
            "entity_level": entity_level,
            "data_source": data_source,
            "window": window,
            "aggregation": meta.get("aggregation"),
            "direction": meta.get("direction"),
            "typology_intent": meta.get("typology") or (getattr(fs_def, "basel_typology", None) if fs_def is not None else None),
            "expected_risk_direction": meta.get("expected_risk_direction"),
            "business_meaning": meta.get("business_description") or (getattr(fs_def, "description", None) if fs_def is not None else None),
            "construction_logic": construction_logic,
            "built_by": meta.get("built_by") or built_by,
            "origin_module": meta.get("origin_module") or origin_module,
            "code_location": code_location,
            "transformation": transformation,
        }
