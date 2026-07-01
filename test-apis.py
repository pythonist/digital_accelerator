import os
import urllib.request
import urllib.error
import ssl
import json

print("==================================================")
print("       AI API Connection Diagnostic Tester        ")
print("==================================================")

# Allow ignoring SSL if they want to test that specific bypass
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def test_endpoint(name, url, headers):
    print(f"\nTesting {name} -> {url}")
    print("--------------------------------------------------")
    
    req = urllib.request.Request(url, headers=headers)
    
    try:
        # First test WITH standard SSL
        with urllib.request.urlopen(req, timeout=10) as response:
            print(f"✅ SUCCESS! Connected to {name} with strict SSL.")
            return True
    except urllib.error.URLError as e:
        if "CERTIFICATE_VERIFY_FAILED" in str(e.reason):
            print(f"⚠️ SSL INTERCEPTION DETECTED for {name}!")
            print("   Your corporate firewall is rewriting SSL certificates.")
            print("   Testing again with SSL verification disabled...")
            
            try:
                # Test WITHOUT SSL verification
                with urllib.request.urlopen(req, timeout=10, context=ctx) as response:
                    print(f"✅ SUCCESS! Connected to {name} by bypassing SSL verification.")
                    return True
            except Exception as bypass_e:
                print(f"❌ FAILED: Even with SSL disabled, connection failed: {bypass_e}")
                return False
                
        else:
            print(f"❌ NETWORK BLOCKED: Python cannot reach {name} at all.")
            print(f"   Error: {e.reason}")
            print("   This means your VPN/Firewall is completely dropping the connection.")
            return False
    except Exception as e:
        print(f"❌ UNEXPECTED ERROR: {e}")
        return False

# Grab keys from environment if they exist, otherwise ask
openai_key = os.environ.get("OPENAI_API_KEY", "")
openrouter_key = os.environ.get("OPENROUTER_API_KEY", "") or os.environ.get("NEMOTRON_API_KEY", "")

if not openai_key:
    openai_key = input("Enter OpenAI API Key (sk-...): ").strip()

if not openrouter_key:
    openrouter_key = input("Enter OpenRouter/Nemotron API Key (sk-or-...): ").strip()

print("\nStarting diagnostics...")

test_endpoint(
    "ChatGPT (OpenAI)", 
    "https://api.openai.com/v1/models", 
    {"Authorization": f"Bearer {openai_key}"}
)

test_endpoint(
    "Nemotron (OpenRouter)", 
    "https://openrouter.ai/api/v1/auth/key", 
    {"Authorization": f"Bearer {openrouter_key}"}
)

print("\n==================================================")
print("If both say NETWORK BLOCKED, you MUST disconnect")
print("from the VPN or use a mobile hotspot for the demo.")
print("==================================================")
