import os
import urllib.request
import urllib.error
import ssl
import json

print("==================================================")
print("     Deep API Connection Tester (Actual POST)     ")
print("==================================================")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def test_endpoint(name, url, headers, payload):
    print(f"\nTesting {name} -> {url}")
    print("--------------------------------------------------")
    
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    
    try:
        # We will try WITH SSL verification disabled immediately to bypass that specific layer, 
        # so we can see the ACTUAL response body from the firewall.
        with urllib.request.urlopen(req, timeout=15, context=ctx) as response:
            body = response.read().decode('utf-8')
            
            print(f"✅ HTTP Status: {response.getcode()} (The server accepted the connection)")
            
            # Now we try to parse the body to see if it's actually AI data or a Firewall webpage
            try:
                json_data = json.loads(body)
                print(f"✅ SUCCESS! Valid JSON received: {str(json_data)[:100]}...")
                return True
            except json.JSONDecodeError:
                print("❌ ERROR: Connection succeeded, but we did NOT receive valid JSON!")
                print("==================================================")
                print("THIS IS WHAT YOUR FIREWALL RETURNED INSTEAD OF THE API:")
                print("==================================================")
                print(body[:1000])  # Print the first 1000 characters of the HTML block page
                print("==================================================")
                print("As you can see above, your firewall is intercepting the connection and returning an HTML webpage.")
                return False
                
    except urllib.error.URLError as e:
        print(f"❌ NETWORK BLOCKED: Python cannot reach {name} at all.")
        
        # If it returns a 403 Forbidden or similar HTTP error, we can read the body too
        if hasattr(e, 'read'):
            body = e.read().decode('utf-8')
            print("\nFIREWALL/SERVER RESPONSE BODY:")
            print(body[:1000])
        else:
            print(f"Error: {e.reason}")
        return False
    except Exception as e:
        print(f"❌ UNEXPECTED ERROR: {e}")
        return False


openai_key = os.environ.get("OPENAI_API_KEY", "")
openrouter_key = os.environ.get("OPENROUTER_API_KEY", "") or os.environ.get("NEMOTRON_API_KEY", "")

if not openai_key:
    openai_key = input("Enter OpenAI API Key (sk-...): ").strip()

if not openrouter_key:
    openrouter_key = input("Enter OpenRouter/Nemotron API Key (sk-or-...): ").strip()

# Standard chat completion payload
test_payload = {
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Say hello!"}],
    "max_tokens": 10
}

openrouter_payload = {
    "model": "nvidia/nemotron-4-340b-instruct",
    "messages": [{"role": "user", "content": "Say hello!"}],
    "max_tokens": 10
}

print("\nStarting Deep Diagnostics...")

test_endpoint(
    "ChatGPT (OpenAI)", 
    "https://api.openai.com/v1/chat/completions", 
    {
        "Authorization": f"Bearer {openai_key}",
        "Content-Type": "application/json"
    },
    test_payload
)

test_endpoint(
    "Nemotron (OpenRouter)", 
    "https://openrouter.ai/api/v1/chat/completions", 
    {
        "Authorization": f"Bearer {openrouter_key}",
        "Content-Type": "application/json"
    },
    openrouter_payload
)

print("\n==================================================")
print("If you see HTML code above, your VPN is spoofing the connection.")
print("==================================================")
