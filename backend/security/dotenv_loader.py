import os


def _strip_quotes(v: str) -> str:
    s = (v or "").strip()
    if len(s) >= 2 and ((s[0] == s[-1] == '"') or (s[0] == s[-1] == "'")):
        return s[1:-1]
    return s


def load_dotenv(dotenv_path: str, override: bool = False) -> None:
    if not dotenv_path:
        return
    if not os.path.exists(dotenv_path):
        return

    try:
        with open(dotenv_path, "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                k, v = line.split("=", 1)
                key = k.strip()
                val = _strip_quotes(v)
                if not key:
                    continue
                if not override and os.getenv(key) is not None:
                    continue
                os.environ[key] = val
    except Exception:
        return

