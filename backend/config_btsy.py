# backend/config_btsy.py
"""
BTSY-specific configuration
Add this to your Flask app configuration to enable unlimited file uploads
"""

# Flask Configuration for BTSY
BTSY_CONFIG = {
    # Remove file upload size limits
    'MAX_CONTENT_LENGTH': None,  # No limit on upload size
    
    # Increase timeout for large file operations (if using gunicorn/nginx)
    'SEND_FILE_MAX_AGE_DEFAULT': 43200,  # 12 hours
    
    # DuckDB Configuration
    'DUCKDB_MEMORY_LIMIT': '6GB',  # Leave 2GB for OS/other processes
    'DUCKDB_THREADS': 4,  # Adjust based on CPU cores
    
    # File handling
    'ALLOWED_EXTENSIONS': ['csv', 'parquet'],
    'STREAM_CHUNK_SIZE': 8192,  # 8KB chunks for streaming
}

def configure_btsy_app(app):
    """
    Apply BTSY configuration to Flask app
    Call this in your app.py after creating the Flask app instance
    """
    app.config['MAX_CONTENT_LENGTH'] = BTSY_CONFIG['MAX_CONTENT_LENGTH']
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = BTSY_CONFIG['SEND_FILE_MAX_AGE_DEFAULT']
    
    return app


# Example usage in app.py:
# from config_btsy import configure_btsy_app
# app = Flask(__name__)
# app = configure_btsy_app(app)  # Enable unlimited uploads