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
        last_key = None
        with open(dotenv_path, "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    # Some copied secrets, especially long API keys, are pasted
                    # across two lines. Preserve that value instead of silently
                    # dropping the continuation.
                    if last_key and last_key.upper().endswith(("API_KEY", "TOKEN", "SECRET")):
                        os.environ[last_key] = f"{os.getenv(last_key, '')}{line}"
                    continue
                k, v = line.split("=", 1)
                key = k.strip()
                val = _strip_quotes(v)
                if not key:
                    continue
                if not override and os.getenv(key) is not None:
                    last_key = key
                    continue
                os.environ[key] = val
                last_key = key
    except Exception:
        return

