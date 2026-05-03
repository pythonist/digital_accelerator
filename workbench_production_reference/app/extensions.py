from flask_caching import Cache
from flask_session import Session
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy(session_options={"expire_on_commit": False})
cache = Cache()
server_session = Session()
