from __future__ import annotations

from . import create_app
from .demo_data import ensure_seed_data
from .extensions import db


def seed() -> None:
    app = create_app()
    with app.app_context():
        db.create_all()
        ensure_seed_data()


if __name__ == "__main__":
    seed()
