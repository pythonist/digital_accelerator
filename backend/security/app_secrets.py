import os
import secrets

from security.dotenv_loader import load_dotenv


def _backend_dir() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _dotenv_path() -> str:
    return os.path.join(_backend_dir(), ".env")


def _is_production() -> bool:
    v = (os.getenv("APP_ENV") or os.getenv("FLASK_ENV") or os.getenv("ENV") or "").strip().lower()
    return v in {"prod", "production"}


def _ensure_secret_in_dotenv(key: str) -> str:
    dotenv_path = _dotenv_path()
    if _is_production():
        raise RuntimeError(f"{key} must be set in environment variables")

    secret_val = secrets.token_hex(32)
    try:
        os.makedirs(os.path.dirname(dotenv_path), exist_ok=True)
        existing = ""
        if os.path.exists(dotenv_path):
            with open(dotenv_path, "r", encoding="utf-8") as f:
                existing = f.read()
        if f"{key}=" not in existing:
            with open(dotenv_path, "a", encoding="utf-8") as f:
                if existing and not existing.endswith("\n"):
                    f.write("\n")
                f.write(f"{key}={secret_val}\n")
    except Exception:
        return secret_val
    os.environ[key] = secret_val
    return secret_val


def get_app_secret_key() -> str:
    load_dotenv(_dotenv_path(), override=False)

    key = os.getenv("APP_SECRET_KEY")
    if key and str(key).strip():
        return str(key)

    return _ensure_secret_in_dotenv("APP_SECRET_KEY")
