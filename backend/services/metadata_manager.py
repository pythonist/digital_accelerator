"""
Metadata Manager: Tenant-Aware Environment Management
File: services/metadata_manager.py
"""
import os
import json
import sqlite3
from datetime import datetime

class MetadataManager:
    def __init__(self, base_dir='env'):
        """
        Initialize metadata manager with tenant-aware folder structure.
        
        New Structure:
        env/
          ├── hsbc/              # Tenant folder
          │   ├── CASE-001/      # Environment
          │   └── CASE-002/
          ├── chase/
          │   └── FRAUD-2024/
        """
        self.base_dir = os.path.abspath(base_dir)
        self.active_env = None
        self.active_tenant = None
        self.registry_cache = {}
        
        if not os.path.exists(self.base_dir):
            os.makedirs(self.base_dir, exist_ok=True)

    def list_environments(self, tenant_id=None):
        """
        List environments filtered by tenant.
        
        Args:
            tenant_id: If provided, only returns environments for this tenant
        
        Returns:
            list: Environment names
        """
        if not os.path.exists(self.base_dir):
            return []
        
        all_envs = []
        
        # Iterate through tenant folders
        for tenant_folder in os.listdir(self.base_dir):
            tenant_path = os.path.join(self.base_dir, tenant_folder)
            
            if not os.path.isdir(tenant_path):
                continue
            
            # Filter by tenant if specified
            if tenant_id and tenant_folder != tenant_id:
                continue
            
            # List environments within this tenant's folder
            for env_name in os.listdir(tenant_path):
                env_path = os.path.join(tenant_path, env_name)
                if os.path.isdir(env_path):
                    all_envs.append(env_name)
        
        return all_envs

    def create_environment(self, case_name, tenant_id):
        """
        Create a new environment under the tenant's folder.
        
        Args:
            case_name: Name of the environment
            tenant_id: Tenant ID (required)
        
        Returns:
            dict: Environment info with paths
        """
        if not tenant_id:
            raise ValueError("Tenant ID is required to create environment")
        
        # Tenant-scoped path
        tenant_path = os.path.join(self.base_dir, tenant_id)
        case_path = os.path.join(tenant_path, case_name)
        
        if os.path.exists(case_path):
            raise ValueError(f"Environment '{case_name}' already exists for this tenant")

        # Create folder structure
        os.makedirs(os.path.join(case_path, 'investigation', 'source_data'), exist_ok=True)
        os.makedirs(os.path.join(case_path, 'investigation', 'master_data'), exist_ok=True)
        os.makedirs(os.path.join(case_path, 'investigation', 'vector_store'), exist_ok=True)
        os.makedirs(os.path.join(case_path, 'calibration', 'experiments'), exist_ok=True)
        os.makedirs(os.path.join(case_path, 'calibration', 'datasets'), exist_ok=True)
        os.makedirs(os.path.join(case_path, 'audit_logs'), exist_ok=True)

        # Create registry file with tenant ownership
        registry = {
            "case_id": case_name,
            "tenant_id": tenant_id,
            "created_at": datetime.now().isoformat(),
            "tables": {},
            "pipeline_stage": "INIT"
        }
        
        with open(os.path.join(case_path, 'registry.json'), 'w') as f:
            json.dump(registry, f, indent=2)

        # Initialize empty databases
        self._init_db(os.path.join(case_path, 'investigation', 'investigation.db'))
        self._init_db(os.path.join(case_path, 'calibration', 'calibration.db'))

        return self.activate_environment(case_name, tenant_id)

    def _init_db(self, path):
        """Helper to create an empty SQLite DB file"""
        try:
            conn = sqlite3.connect(path)
            conn.close()
        except Exception as e:
            print(f"⚠️ Failed to init DB at {path}: {e}")

    def activate_environment(self, case_name, tenant_id='default'):
        """
        Load an environment and return paths with tenant validation.
        
        Args:
            case_name: Environment name
            tenant_id: Tenant ID (required for security)
        
        Returns:
            dict: Environment info with paths
        """
        if not tenant_id:
            raise ValueError("Tenant ID is required to activate environment")
        
        # Tenant-scoped path
        tenant_path = os.path.join(self.base_dir, tenant_id)
        case_path = os.path.join(tenant_path, case_name)
        
        if not os.path.exists(case_path):
            raise ValueError(f"Environment '{case_name}' not found for tenant '{tenant_id}'")

        self.active_env = case_name
        self.active_tenant = tenant_id
        
        reg_path = os.path.join(case_path, 'registry.json')
        if os.path.exists(reg_path):
            with open(reg_path, 'r') as f:
                self.registry_cache = json.load(f)
                
                # Security check: Verify tenant ownership
                if self.registry_cache.get('tenant_id') != tenant_id:
                    raise ValueError("Tenant ID mismatch - access denied")
        else:
            self.registry_cache = {
                "case_id": case_name,
                "tenant_id": tenant_id,
                "tables": {}
            }
            
        return {
            "name": case_name,
            "tenant_id": tenant_id,
            "paths": {
                "root": case_path,
                "investigation_db": os.path.join(case_path, 'investigation', 'investigation.db'),
                "calibration_db": os.path.join(case_path, 'calibration', 'calibration.db'),
                "vector_store": os.path.join(case_path, 'investigation', 'vector_store'),
                "source_data": os.path.join(case_path, 'investigation', 'source_data'),
                "audit_dir": os.path.join(case_path, 'audit_logs')
            },
            "registry": self.registry_cache
        }

    def validate_env_ownership(self, case_name, tenant_id):
        """
        Validate that an environment belongs to a tenant.
        
        Args:
            case_name: Environment name
            tenant_id: Tenant ID to validate
        
        Returns:
            bool: True if tenant owns the environment
        """
        if not tenant_id:
            return False
        
        tenant_path = os.path.join(self.base_dir, tenant_id)
        case_path = os.path.join(tenant_path, case_name)
        
        if not os.path.exists(case_path):
            return False
        
        # Double-check registry file
        reg_path = os.path.join(case_path, 'registry.json')
        if os.path.exists(reg_path):
            try:
                with open(reg_path, 'r') as f:
                    registry = json.load(f)
                    return registry.get('tenant_id') == tenant_id
            except:
                return False
        
        return True

    def get_env_path(self):
        """Get the full path of the active environment"""
        if not self.active_env or not self.active_tenant:
            raise ValueError("No active environment selected")
        
        return os.path.join(self.base_dir, self.active_tenant, self.active_env)

    def get_all_tables(self):
        """Returns list of registered tables"""
        if not self.registry_cache: 
            return []
        return list(self.registry_cache.get('tables', {}).keys())

    def save_schema(self, table_name, columns, row_count=0):
        """Updates the registry with table metadata"""
        if not self.active_env: 
            return
        
        if 'tables' not in self.registry_cache:
            self.registry_cache['tables'] = {}

        self.registry_cache['tables'][table_name] = {
            'columns': columns,
            'row_count': row_count,
            'updated_at': datetime.now().isoformat()
        }
        self.save_registry()

    def save_registry(self):
        """Persists the registry cache to disk"""
        if not self.active_env or not self.active_tenant: 
            return
        
        path = os.path.join(self.base_dir, self.active_tenant, self.active_env, 'registry.json')
        try:
            with open(path, 'w') as f:
                json.dump(self.registry_cache, f, indent=2)
        except Exception as e:
            print(f"❌ Failed to save registry: {e}")