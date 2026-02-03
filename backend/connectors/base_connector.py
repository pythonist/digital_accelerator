"""
Base Connector Interface for AML Data Ingestion
Supports CSV (existing) and SQL (new) connectors
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, List
import pandas as pd
from datetime import datetime

class BaseConnector(ABC):
    """
    Abstract base class for all data connectors.
    Ensures consistent interface for CSV, SQL, and future connector types.
    """
    
    def __init__(self, config: Dict[str, Any]):
        """
        Initialize connector with configuration.
        
        Args:
            config: Connector configuration dict
                {
                    'connector_id': str,
                    'name': str,
                    'type': 'csv'|'sql',
                    'entity_type': 'transactions'|'alerts'|etc,
                    ...connector-specific params
                }
        """
        self.config = config
        self.connector_id = config.get('connector_id')
        self.name = config.get('name')
        self.entity_type = config.get('entity_type')
        
    @abstractmethod
    def test_connection(self) -> Dict[str, Any]:
        """
        Test if connection is valid.
        
        Returns:
            {
                'success': bool,
                'message': str,
                'details': dict (optional)
            }
        """
        pass
    
    @abstractmethod
    def fetch_data(self, params: Dict[str, Any] = None) -> pd.DataFrame:
        """
        Fetch data from source.
        
        Args:
            params: Optional parameters for filtering (date ranges, etc)
        
        Returns:
            pandas.DataFrame with raw data
        """
        pass
    
    @abstractmethod
    def get_schema_preview(self) -> Dict[str, Any]:
        """
        Get schema information without fetching full data.
        
        Returns:
            {
                'columns': List[str],
                'sample_rows': List[dict],
                'estimated_rows': int
            }
        """
        pass
    
    def validate_config(self) -> Dict[str, Any]:
        """
        Validate connector configuration.
        
        Returns:
            {
                'valid': bool,
                'errors': List[str]
            }
        """
        errors = []
        
        if not self.connector_id:
            errors.append("connector_id is required")
        if not self.name:
            errors.append("name is required")
        if not self.entity_type:
            errors.append("entity_type is required")
            
        return {
            'valid': len(errors) == 0,
            'errors': errors
        }
    
    def get_metadata(self) -> Dict[str, Any]:
        """
        Get connector metadata.
        
        Returns:
            Connector metadata dict
        """
        return {
            'connector_id': self.connector_id,
            'name': self.name,
            'type': self.config.get('type'),
            'entity_type': self.entity_type,
            'created_at': self.config.get('created_at'),
            'last_run': self.config.get('last_run')
        }