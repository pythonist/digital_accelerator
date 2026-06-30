import os
import urllib.request
import urllib.error

def fetch_doppler_env():
    print("==================================================")
    print("  Doppler Cloud .env Fetcher (No CLI Required)  ")
    print("==================================================")
    token = input("\nEnter your Doppler Service Token (dp.st....): ").strip()
    
    if not token:
        print("No token provided. Exiting.")
        return

    url = "https://api.doppler.com/v3/configs/config/secrets/download?format=env"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    
    try:
        print("Fetching secrets from Doppler cloud...")
        with urllib.request.urlopen(req) as response:
            env_content = response.read().decode('utf-8')
            
            # Ensure backend directory exists
            os.makedirs("backend", exist_ok=True)
            backend_env_path = os.path.join("backend", ".env")
            
            with open(backend_env_path, "w", encoding='utf-8') as f:
                f.write(env_content)
                
            print(f"✅ Successfully securely downloaded and saved to: {backend_env_path}")
            print("You are now ready to run .\\start-dev.bat!")
            print("==================================================")
    except urllib.error.HTTPError as e:
        print(f"❌ HTTP Error: {e.code} - {e.reason}")
        if e.code == 401:
            print("Hint: Check if your token is correct and hasn't expired.")
    except urllib.error.URLError as e:
        print(f"❌ Network Error: {e.reason}")
    except Exception as e:
        print(f"❌ An unexpected error occurred: {e}")

if __name__ == "__main__":
    fetch_doppler_env()
