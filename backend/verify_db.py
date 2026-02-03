import sqlite3
import os

# CONFIGURATION
ENV_ID = "new_test_env"  # <--- Ensure this matches the name in your top-left corner
PATHS_TO_CHECK = [
    f"data/environments/{ENV_ID}/database.db",
    f"data/environments/{ENV_ID}/investigation.db",
    f"../data/environments/{ENV_ID}/database.db",
    f"backend/data/environments/{ENV_ID}/database.db"
]

print(f"🔍 Searching for database for: {ENV_ID}...\n")

found_path = None
for path in PATHS_TO_CHECK:
    if os.path.exists(path):
        found_path = path
        print(f"✅ FOUND DB AT: {path}")
        print(f"   Size: {os.path.getsize(path) / 1024:.2f} KB")
        break
    else:
        print(f"❌ Not found at: {path}")

if not found_path:
    print("\n🚨 CRITICAL ERROR: Database file is missing!")
    print("The system cannot find the .db file for this environment.")
    print("Solution: Go to 'Load Data' and re-upload your CSVs.")
else:
    try:
        conn = sqlite3.connect(found_path)
        cursor = conn.cursor()
        
        # Check Tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [t[0] for t in cursor.fetchall()]
        print(f"\n📋 Tables Found: {tables}")
        
        if 'cases' in tables:
            cursor.execute("SELECT COUNT(*) FROM cases")
            count = cursor.fetchone()[0]
            print(f"\n📊 CASE COUNT: {count}")
            
            if count == 0:
                print("⚠️ The 'cases' table exists but is EMPTY.")
                print("   This is why you see 'No cases match your filters'.")
            else:
                print("✅ Data exists! The issue is likely the Frontend API or Filter.")
                
                # Show one sample to check IDs
                cursor.execute("SELECT * FROM cases LIMIT 1")
                print(f"   Sample Row: {cursor.fetchone()}")
        else:
            print("\n🚨 MISSING 'cases' TABLE.")
            print("   The file exists, but the schema is wrong.")
            
        conn.close()
    except Exception as e:
        print(f"\n❌ SQL ERROR: {e}")

input("\nPress Enter to exit...")