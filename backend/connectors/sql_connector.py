"""
SQL Connector for Oracle, DB2, SQL Server
Read-only access to bank databases
"""
import pandas as pd
from typing import Dict, Any
import traceback
from .base_connector import BaseConnector

# Database drivers (install as needed)
try:
    import cx_Oracle
    ORACLE_AVAILABLE = True
except ImportError:
    ORACLE_AVAILABLE = False

try:
    import pyodbc
    ODBC_AVAILABLE = True
except ImportError:
    ODBC_AVAILABLE = False

try:
    import pymssql
    MSSQL_AVAILABLE = True
except ImportError:
    MSSQL_AVAILABLE = False

class SQLConnector(BaseConnector):
    """
    SQL Database Connector for enterprise AML systems.
    Supports Oracle, DB2, SQL Server with read-only access.
    """
    
    SUPPORTED_DATABASES = {
        'oracle': {'available': ORACLE_AVAILABLE, 'driver': 'cx_Oracle'},
        'db2': {'available': ODBC_AVAILABLE, 'driver': 'pyodbc'},
        'sqlserver': {'available': ODBC_AVAILABLE or MSSQL_AVAILABLE, 'driver': 'pyodbc/pymssql'},
        'postgres': {'available': True, 'driver': 'psycopg2'}  # For testing
    }
    
    def __init__(self, config: Dict[str, Any]):
        """
        Initialize SQL Connector.
        
        Config structure:
        {
            'connector_id': str,
            'name': str,
            'type': 'sql',
            'entity_type': 'transactions'|'alerts'|etc,
            'db_type': 'oracle'|'db2'|'sqlserver',
            'host': str,
            'port': int,
            'database': str,
            'username': str,
            'password': str (encrypted in production),
            'query': str (SQL query),
            'schema_mapping': dict (optional)
        }
        """
        super().__init__(config)
        self.db_type = config.get('db_type', '').lower()
        self.host = config.get('host')
        self.port = config.get('port')
        self.database = config.get('database')
        self.username = config.get('username')
        self.password = config.get('password')
        self.query = config.get('query')
        self.schema_mapping = config.get('schema_mapping', {})
        
    def validate_config(self) -> Dict[str, Any]:
        """Validate SQL-specific configuration"""
        result = super().validate_config()
        errors = result['errors']
        
        if self.db_type not in self.SUPPORTED_DATABASES:
            errors.append(f"Unsupported database type: {self.db_type}")
        elif not self.SUPPORTED_DATABASES[self.db_type]['available']:
            driver = self.SUPPORTED_DATABASES[self.db_type]['driver']
            errors.append(f"{self.db_type} driver ({driver}) not installed")
            
        if not self.host:
            errors.append("host is required")
        if not self.database:
            errors.append("database is required")
        if not self.username:
            errors.append("username is required")
        if not self.query:
            errors.append("SQL query is required")
            
        # Validate query is SELECT only (security)
        if self.query:
            query_upper = self.query.upper().strip()
            if not query_upper.startswith('SELECT'):
                errors.append("Only SELECT queries are allowed")
            
            forbidden_keywords = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 
                                'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE']
            if any(keyword in query_upper for keyword in forbidden_keywords):
                errors.append("Query contains forbidden keywords (modification not allowed)")
        
        return {
            'valid': len(errors) == 0,
            'errors': errors
        }
    
    def _create_connection(self):
        """
        Create database connection based on db_type.
        Returns connection object.
        """
        try:
            if self.db_type == 'oracle':
                if not ORACLE_AVAILABLE:
                    raise Exception("cx_Oracle not installed. Install: pip install cx_Oracle")
                
                dsn = cx_Oracle.makedsn(self.host, self.port or 1521, service_name=self.database)
                conn = cx_Oracle.connect(user=self.username, password=self.password, dsn=dsn)
                return conn
                
            elif self.db_type == 'sqlserver':
                if not ODBC_AVAILABLE:
                    raise Exception("pyodbc not installed. Install: pip install pyodbc")
                
                conn_str = (
                    f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                    f"SERVER={self.host},{self.port or 1433};"
                    f"DATABASE={self.database};"
                    f"UID={self.username};"
                    f"PWD={self.password}"
                )
                conn = pyodbc.connect(conn_str, timeout=10)
                return conn
                
            elif self.db_type == 'db2':
                if not ODBC_AVAILABLE:
                    raise Exception("pyodbc not installed. Install: pip install pyodbc")
                
                conn_str = (
                    f"DRIVER={{IBM DB2 ODBC DRIVER}};"
                    f"DATABASE={self.database};"
                    f"HOSTNAME={self.host};"
                    f"PORT={self.port or 50000};"
                    f"PROTOCOL=TCPIP;"
                    f"UID={self.username};"
                    f"PWD={self.password};"
                )
                conn = pyodbc.connect(conn_str, timeout=10)
                return conn
                
            elif self.db_type == 'postgres':
                # For local testing
                import psycopg2
                conn = psycopg2.connect(
                    host=self.host,
                    port=self.port or 5432,
                    database=self.database,
                    user=self.username,
                    password=self.password,
                    connect_timeout=10
                )
                return conn
                
            else:
                raise Exception(f"Unsupported database type: {self.db_type}")
                
        except Exception as e:
            raise Exception(f"Connection failed: {str(e)}")
    
    def test_connection(self) -> Dict[str, Any]:
        """Test database connection"""
        try:
            # Validate config first
            validation = self.validate_config()
            if not validation['valid']:
                return {
                    'success': False,
                    'message': 'Configuration invalid',
                    'details': {'errors': validation['errors']}
                }
            
            # Try to connect
            conn = self._create_connection()
            
            # Try a simple query
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.close()
            conn.close()
            
            return {
                'success': True,
                'message': f'Connected successfully to {self.db_type} database',
                'details': {
                    'host': self.host,
                    'database': self.database,
                    'user': self.username
                }
            }
            
        except Exception as e:
            return {
                'success': False,
                'message': f'Connection test failed: {str(e)}',
                'details': {'error': str(e)}
            }
    
    def get_schema_preview(self) -> Dict[str, Any]:
        """Get schema without fetching all data"""
        try:
            conn = self._create_connection()
            
            # Execute query with LIMIT
            preview_query = f"{self.query} FETCH FIRST 5 ROWS ONLY" if 'oracle' in self.db_type else f"{self.query} LIMIT 5"
            
            df = pd.read_sql(preview_query, conn)
            conn.close()
            
            return {
                'columns': df.columns.tolist(),
                'sample_rows': df.to_dict('records'),
                'estimated_rows': len(df)  # This is just sample size
            }
            
        except Exception as e:
            return {
                'columns': [],
                'sample_rows': [],
                'estimated_rows': 0,
                'error': str(e)
            }
    
    def fetch_data(self, params: Dict[str, Any] = None) -> pd.DataFrame:
        """
        Execute SQL query and return data as DataFrame.
        
        Args:
            params: Optional parameters (e.g., date filters)
        
        Returns:
            pandas.DataFrame with query results
        """
        try:
            conn = self._create_connection()
            
            # Execute query
            print(f"🔍 Executing SQL query for {self.entity_type}...")
            df = pd.read_sql(self.query, conn)
            conn.close()
            
            print(f"✅ Fetched {len(df)} rows from {self.db_type} database")
            
            # Apply schema mapping if provided
            if self.schema_mapping:
                df = self._apply_schema_mapping(df)
            
            return df
            
        except Exception as e:
            print(f"❌ SQL Connector Error: {e}")
            traceback.print_exc()
            raise Exception(f"Failed to fetch data: {str(e)}")
    
    def _apply_schema_mapping(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Apply column mapping to standardize schema.
        
        Example:
            schema_mapping = {
                'TXN_AMT': 'amount',
                'TXN_DATE': 'date',
                'CUSTOMER_ID': 'customer_id'
            }
        """
        try:
            if not self.schema_mapping:
                return df
            
            # Rename columns based on mapping
            rename_dict = {}
            for source_col, target_col in self.schema_mapping.items():
                if source_col in df.columns:
                    rename_dict[source_col] = target_col
            
            if rename_dict:
                df = df.rename(columns=rename_dict)
                print(f"📋 Applied schema mapping: {len(rename_dict)} columns renamed")
            
            return df
            
        except Exception as e:
            print(f"⚠️ Schema mapping failed: {e}")
            return df  # Return unmapped data rather than failing


# Example connector configurations for reference
EXAMPLE_CONNECTORS = {
    'oracle_transactions': {
        'connector_id': 'oracle_txn_001',
        'name': 'Oracle Core Banking Transactions',
        'type': 'sql',
        'entity_type': 'transactions',
        'db_type': 'oracle',
        'host': '10.20.30.40',
        'port': 1521,
        'database': 'COREBANK',
        'username': 'aml_readonly',
        'password': 'encrypted_password',
        'query': '''
            SELECT 
                TXN_ID as transaction_id,
                CUSTOMER_ID as customer_id,
                ACCOUNT_NO as account_number,
                TXN_AMOUNT as amount,
                TXN_DATE as date,
                TXN_TYPE as type,
                CHANNEL as channel,
                NARRATION as description
            FROM TRANSACTIONS
            WHERE TXN_DATE >= SYSDATE - 30
        ''',
        'schema_mapping': {
            'transaction_id': 'txn_id',
            'customer_id': 'cust_id'
        }
    },
    
    'db2_alerts': {
        'connector_id': 'db2_alert_001',
        'name': 'DB2 AML Alerts',
        'type': 'sql',
        'entity_type': 'alerts',
        'db_type': 'db2',
        'host': '10.20.30.50',
        'port': 50000,
        'database': 'AMLDB',
        'username': 'aml_user',
        'password': 'encrypted_password',
        'query': '''
            SELECT 
                ALERT_ID,
                CASE_ID,
                CUSTOMER_ID,
                ALERT_DATE,
                ALERT_TYPE,
                RISK_SCORE,
                STATUS
            FROM AML_ALERTS
            WHERE ALERT_DATE >= CURRENT_DATE - 7 DAYS
        '''
    }
}