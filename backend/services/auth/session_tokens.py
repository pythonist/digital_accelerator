from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

from itsdangerous import BadSignature, BadTimeSignature, URLSafeTimedSerializer

from security.app_secrets import get_app_secret_key


@dataclass
class SessionTokenConfig:
    ttl_seconds: int = 86400
    salt: str = "sentinel-aml-session"


class SessionTokenService:
    def __init__(self, config: Optional[SessionTokenConfig] = None):
        self.config = config or SessionTokenConfig()
        secret = get_app_secret_key()
        self.serializer = URLSafeTimedSerializer(secret_key=secret, salt=self.config.salt)

    def issue(self, payload: Dict[str, Any]) -> str:
        return self.serializer.dumps(payload)

    def verify(self, token: str) -> Dict[str, Any]:
        try:
            data = self.serializer.loads(token, max_age=int(self.config.ttl_seconds))
            if not isinstance(data, dict):
                raise ValueError("Invalid token payload")
            return data
        except (BadSignature, BadTimeSignature) as e:
            raise ValueError("Invalid or expired session token") from e

