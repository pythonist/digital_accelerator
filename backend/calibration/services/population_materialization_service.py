# backend/calibration/services/population_materialization_service.py
"""
Population Materialization Service
Materializes transaction IDs for downstream steps (NOT full data)
"""
import pandas as pd
from datetime import datetime

class PopulationMaterializationService:
    """
    Materializes eligible transaction IDs after Step 1 confirmation
    Prevents re-scanning in Step 2+
    """
    
    def __init__(self, db_manager):
        self.db = db_manager
    
    def materialize_population_ids(self, run_id, env_id, filters):
        """
        Materialize transaction IDs matching filters
        Stores only IDs, not full transaction data
        """
        from calibration.services.population_explorer_service import PopulationExplorerService
        
        explorer = PopulationExplorerService(self.db)
        
        # Fetch filtered population (ID columns only for speed)
        df = explorer.fetch_population_dataframe(run_id, env_id, filters, limit=None)
        
        if df.empty:
            raise ValueError("No transactions match filters")
        
        # Extract IDs only
        id_cols = ['transaction_id']
        if 'account_id' in df.columns:
            id_cols.append('account_id')
        if 'customer_id' in df.columns:
            id_cols.append('customer_id')
        
        id_df = df[id_cols].copy()
        
        # Store in temporary table
        conn = self.db.connect()
        table_name = f"materialized_ids_{run_id}"
        
        # Drop if exists
        conn.execute(f'DROP TABLE IF EXISTS "{table_name}"')
        
        # Save IDs
        id_df.to_sql(table_name, conn, index=False, if_exists='replace')
        
        # Log metadata
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO materialized_populations 
            (run_id, table_name, row_count, materialized_at)
            VALUES (?, ?, ?, ?)
        """, (run_id, table_name, len(id_df), datetime.utcnow().isoformat()))
        
        conn.commit()
        conn.close()
        
        print(f"✅ Materialized {len(id_df):,} transaction IDs for {run_id}")
        
        return {
            'materialized_count': len(id_df),
            'table_name': table_name
        }
    
    def get_materialized_population(self, run_id):
        """
        Retrieve materialized population for downstream steps
        Returns DataFrame with IDs only
        """
        conn = self.db.connect()
        cursor = conn.cursor()
        
        # Get table name
        cursor.execute("""
            SELECT table_name FROM materialized_populations
            WHERE run_id = ?
        """, (run_id,))
        
        row = cursor.fetchone()
        
        if not row:
            conn.close()
            raise ValueError(f"No materialized population found for {run_id}")
        
        table_name = row[0]
        
        # Load IDs
        df = pd.read_sql(f'SELECT * FROM "{table_name}"', conn)
        conn.close()
        
        return df
    
    def cleanup_materialized_data(self, run_id):
        """Clean up materialized tables after calibration complete"""
        conn = self.db.connect()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT table_name FROM materialized_populations
            WHERE run_id = ?
        """, (run_id,))
        
        row = cursor.fetchone()
        
        if row:
            table_name = row[0]
            conn.execute(f'DROP TABLE IF EXISTS "{table_name}"')
            
            cursor.execute("""
                DELETE FROM materialized_populations
                WHERE run_id = ?
            """, (run_id,))
            
            conn.commit()
        
        conn.close()