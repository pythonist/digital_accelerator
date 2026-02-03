"""
Data Connectors Package
Supports CSV (legacy) and SQL (enterprise) data ingestion
"""
from .base_connector import BaseConnector
from .sql_connector import SQLConnector, EXAMPLE_CONNECTORS
from .connector_manager import ConnectorManager

__all__ = [
    'BaseConnector',
    'SQLConnector',
    'ConnectorManager',
    'EXAMPLE_CONNECTORS'
]