"""
Connector Manager - CRUD operations for data connectors
Stores connector definitions per environment
"""
import json
import os
import uuid
from datetime import datetime
from typing import Dict, Any, List
from .sql_connector import SQLConnector
from .base_connector import BaseConnector

class ConnectorManager:
    """
    Manages connector definitions for each environment.
    Connectors are stored in: env/{tenant_id}/{env_name}/connectors.json
    """
    
    def __init__(self, env_path: str):
        """
        Initialize connector manager for an environment.
        
        Args:
            env_path: Path to environment folder (e.g., env/hsbc/CASE-001)
        """
        self.env_path = env_path
        self.connectors_file = os.path.join(env_path, 'connectors.json')
        self._ensure_connectors_file()
    
    def _ensure_connectors_file(self):
        """Create connectors.json if it doesn't exist"""
        if not os.path.exists(self.connectors_file):
            os.makedirs(os.path.dirname(self.connectors_file), exist_ok=True)
            self._save_connectors({})
    
    def _load_connectors(self) -> Dict[str, Any]:
        """Load all connectors from file"""
        try:
            with open(self.connectors_file, 'r') as f:
                return json.load(f)
        except:
            return {}
    
    def _save_connectors(self, connectors: Dict[str, Any]):
        """Save connectors to file"""
        with open(self.connectors_file, 'w') as f:
            json.dump(connectors, f, indent=2)
    
    def create_connector(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create a new connector.
        
        Args:
            config: Connector configuration
        
        Returns:
            Created connector with generated ID
        """
        connectors = self._load_connectors()
        
        # Generate ID if not provided
        if 'connector_id' not in config:
            config['connector_id'] = str(uuid.uuid4())
        
        # Add timestamps
        config['created_at'] = datetime.now().isoformat()
        config['updated_at'] = datetime.now().isoformat()
        
        # Validate
        connector = self._create_connector_instance(config)
        validation = connector.validate_config()
        
        if not validation['valid']:
            raise ValueError(f"Invalid connector config: {validation['errors']}")
        
        # Save
        connectors[config['connector_id']] = config
        self._save_connectors(connectors)
        
        return config
    
    def get_connector(self, connector_id: str) -> Dict[str, Any]:
        """Get connector by ID"""
        connectors = self._load_connectors()
        
        if connector_id not in connectors:
            raise ValueError(f"Connector not found: {connector_id}")
        
        return connectors[connector_id]
    
    def list_connectors(self, entity_type: str = None) -> List[Dict[str, Any]]:
        """
        List all connectors, optionally filtered by entity type.
        
        Args:
            entity_type: Optional filter (e.g., 'transactions', 'alerts')
        
        Returns:
            List of connector configs
        """
        connectors = self._load_connectors()
        result = list(connectors.values())
        
        if entity_type:
            result = [c for c in result if c.get('entity_type') == entity_type]
        
        # Sort by creation date
        result.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        
        return result
    
    def update_connector(self, connector_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        """Update connector configuration"""
        connectors = self._load_connectors()
        
        if connector_id not in connectors:
            raise ValueError(f"Connector not found: {connector_id}")
        
        # Merge updates
        config = connectors[connector_id]
        config.update(updates)
        config['updated_at'] = datetime.now().isoformat()
        
        # Validate
        connector = self._create_connector_instance(config)
        validation = connector.validate_config()
        
        if not validation['valid']:
            raise ValueError(f"Invalid connector config: {validation['errors']}")
        
        # Save
        connectors[connector_id] = config
        self._save_connectors(connectors)
        
        return config
    
    def delete_connector(self, connector_id: str):
        """Delete a connector"""
        connectors = self._load_connectors()
        
        if connector_id not in connectors:
            raise ValueError(f"Connector not found: {connector_id}")
        
        del connectors[connector_id]
        self._save_connectors(connectors)
    
    def test_connector(self, connector_id: str) -> Dict[str, Any]:
        """
        Test a connector's connection.
        
        Returns:
            Test result with success status and message
        """
        config = self.get_connector(connector_id)
        connector = self._create_connector_instance(config)
        
        return connector.test_connection()
    
    def get_connector_preview(self, connector_id: str) -> Dict[str, Any]:
        """
        Get schema preview from connector without full data fetch.
        
        Returns:
            Schema information and sample rows
        """
        config = self.get_connector(connector_id)
        connector = self._create_connector_instance(config)
        
        return connector.get_schema_preview()
    
    def execute_connector(self, connector_id: str, params: Dict[str, Any] = None):
        """
        Execute connector and return DataFrame.
        
        Args:
            connector_id: Connector ID
            params: Optional execution parameters
        
        Returns:
            pandas.DataFrame with fetched data
        """
        config = self.get_connector(connector_id)
        connector = self._create_connector_instance(config)
        
        # Update last_run timestamp
        config['last_run'] = datetime.now().isoformat()
        self.update_connector(connector_id, {'last_run': config['last_run']})
        
        # Fetch data
        return connector.fetch_data(params)
    
    def _create_connector_instance(self, config: Dict[str, Any]) -> BaseConnector:
        """
        Create connector instance based on type.
        
        Args:
            config: Connector configuration
        
        Returns:
            BaseConnector instance
        """
        connector_type = config.get('type', '').lower()
        
        if connector_type == 'sql':
            return SQLConnector(config)
        else:
            raise ValueError(f"Unsupported connector type: {connector_type}")
    
    def get_connector_stats(self) -> Dict[str, Any]:
        """
        Get statistics about connectors in this environment.
        
        Returns:
            Statistics dict
        """
        connectors = self._load_connectors()
        
        stats = {
            'total_connectors': len(connectors),
            'by_type': {},
            'by_entity': {},
            'last_runs': []
        }
        
        for config in connectors.values():
            # Count by type
            conn_type = config.get('type', 'unknown')
            stats['by_type'][conn_type] = stats['by_type'].get(conn_type, 0) + 1
            
            # Count by entity
            entity = config.get('entity_type', 'unknown')
            stats['by_entity'][entity] = stats['by_entity'].get(entity, 0) + 1
            
            # Track last runs
            if config.get('last_run'):
                stats['last_runs'].append({
                    'connector_id': config['connector_id'],
                    'name': config['name'],
                    'last_run': config['last_run']
                })
        
        # Sort last runs by date
        stats['last_runs'].sort(key=lambda x: x['last_run'], reverse=True)
        stats['last_runs'] = stats['last_runs'][:5]  # Keep top 5
        
        return stats