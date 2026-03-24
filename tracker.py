import os
import json
import time
import threading
import logging
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from geopy.distance import distance as geo_distance
from pywebpush import webpush, WebPushException
from pyhctb.api import HctbApi
from selenium import webdriver

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
HCTB_EMAIL = os.getenv('HCTB_EMAIL')
HCTB_PASSWORD = os.getenv('HCTB_PASSWORD')
HCTB_SCHOOL_CODE = os.getenv('HCTB_SCHOOL_CODE')
SCHOOL_LAT = float(os.getenv('SCHOOL_LAT', '0.0'))
SCHOOL_LON = float(os.getenv('SCHOOL_LON', '0.0'))
RADIUS_MILES = float(os.getenv('NOTIFICATION_RADIUS_MILES', '2.0'))
VAPID_PRIVATE_KEY = os.getenv('VAPID_PRIVATE_KEY')
VAPID_PUBLIC_KEY = os.getenv('VAPID_PUBLIC_KEY')
VAPID_CLAIM_EMAIL = os.getenv('VAPID_CLAIM_EMAIL', 'mailto:admin@bustracker.app')
POLL_INTERVAL = int(os.getenv('POLL_INTERVAL_SECONDS', '60'))
SUBSCRIPTIONS_FILE = 'subscriptions.json'
PORT = int(os.getenv('PORT', '5000'))

# Optional: set CHROME_BINARY on Railway to point at the nixpkgs chromium binary.
# Leave unset for local development — Chrome/Chromium on PATH is used automatically.
CHROME_BINARY = os.getenv('CHROME_BINARY', None)

def _make_chrome_options():
    """Chrome options that work both locally and in containers (Railway/Docker)."""
    opts = webdriver.ChromeOptions()
    opts.add_argument('--headless')
    opts.add_argument('--no-sandbox')            # Required in containers
    opts.add_argument('--disable-dev-shm-usage') # Avoids /dev/shm OOM in containers
    opts.add_argument('--disable-gpu')
    opts.add_argument('--disable-setuid-sandbox')
    opts.add_argument('--disable-logging')
    opts.add_argument('--log-level=3')
    if CHROME_BINARY:
        opts.binary_location = CHROME_BINARY
    return opts


# ---------------------------------------------------------------------------
# Flask App
# ---------------------------------------------------------------------------
app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Subscription store (simple JSON file)
# ---------------------------------------------------------------------------
def load_subscriptions():
    if os.path.exists(SUBSCRIPTIONS_FILE):
        with open(SUBSCRIPTIONS_FILE, 'r') as f:
            return json.load(f)
    return []

def save_subscriptions(subs):
    with open(SUBSCRIPTIONS_FILE, 'w') as f:
        json.dump(subs, f, indent=2)

# ---------------------------------------------------------------------------
# Web Push helpers
# ---------------------------------------------------------------------------
def send_push(subscription_info, title, body, url='/'):
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps({"title": title, "body": body, "url": url}),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_CLAIM_EMAIL},
        )
    except WebPushException as e:
        log.warning(f"WebPush failed: {e}")
        # If the subscription is gone/expired, remove it
        if e.response and e.response.status_code in (404, 410):
            subs = load_subscriptions()
            subs = [s for s in subs if s.get('endpoint') != subscription_info.get('endpoint')]
            save_subscriptions(subs)

def broadcast_push(title, body, url='/'):
    subs = load_subscriptions()
    log.info(f"Broadcasting push to {len(subs)} subscribers: {title}")
    for sub in subs:
        threading.Thread(target=send_push, args=(sub, title, body, url), daemon=True).start()

# ---------------------------------------------------------------------------
# HCTB Polling background thread
# ---------------------------------------------------------------------------
# Shared state
bus_state = {
    "latitude": None,
    "longitude": None,
    "distance_miles": None,
    "in_school_zone": False,
    "last_updated": None,
    "error": None,
}
already_notified = False

def polling_loop():
    global already_notified
    if not all([HCTB_EMAIL, HCTB_PASSWORD, HCTB_SCHOOL_CODE]):
        log.error("HCTB credentials not set. Polling disabled.")
        return

    client = HctbApi(HCTB_EMAIL, HCTB_PASSWORD, HCTB_SCHOOL_CODE)
    client.browser_options = _make_chrome_options()  # Override with container-safe options
    log.info("HCTB polling thread started.")

    while True:
        try:
            log.info("Fetching bus data from HCTB...")
            data = client.get_bus_data()
            lat = data.get('latitude')
            lon = data.get('longitude')

            if lat and lon:
                bus_coords = (float(lat), float(lon))
                school_coords = (SCHOOL_LAT, SCHOOL_LON)
                dist = geo_distance(bus_coords, school_coords).miles

                bus_state.update({
                    "latitude": float(lat),
                    "longitude": float(lon),
                    "distance_miles": round(dist, 2),
                    "in_school_zone": dist <= RADIUS_MILES,
                    "last_updated": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                    "error": None,
                })

                log.info(f"Bus: ({lat}, {lon}) — {dist:.2f} mi from school")

                if dist <= RADIUS_MILES and not already_notified:
                    title = "🚌 Bus Approaching School!"
                    body = f"The bus is {dist:.1f} miles from school."
                    broadcast_push(title, body)
                    already_notified = True
                elif dist > RADIUS_MILES and already_notified:
                    log.info("Bus left school zone. Resetting notification state.")
                    already_notified = False
            else:
                bus_state.update({"error": "Bus not active or no GPS signal.", "last_updated": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
                log.warning("No bus coordinates returned.")

        except Exception as e:
            log.error(f"Error polling HCTB: {e}")
            bus_state.update({"error": str(e), "last_updated": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})

        time.sleep(POLL_INTERVAL)

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/sw.js')
def service_worker():
    response = send_from_directory('static', 'sw.js')
    response.headers['Service-Worker-Allowed'] = '/'
    response.headers['Content-Type'] = 'application/javascript'
    response.headers['Cache-Control'] = 'no-cache'
    return response

@app.route('/manifest.json')
def manifest():
    return send_from_directory('static', 'manifest.json')


@app.route('/api/status')
def api_status():
    return jsonify({
        **bus_state,
        "school": {"lat": SCHOOL_LAT, "lon": SCHOOL_LON},
        "radius_miles": RADIUS_MILES,
        "vapid_public_key": VAPID_PUBLIC_KEY,
    })

@app.route('/api/subscribe', methods=['POST'])
def api_subscribe():
    sub = request.get_json()
    if not sub or 'endpoint' not in sub:
        return jsonify({"error": "Invalid subscription"}), 400
    subs = load_subscriptions()
    existing_endpoints = [s.get('endpoint') for s in subs]
    if sub['endpoint'] not in existing_endpoints:
        subs.append(sub)
        save_subscriptions(subs)
        log.info(f"New subscriber: {sub['endpoint'][:60]}...")
    return jsonify({"ok": True})

@app.route('/api/unsubscribe', methods=['POST'])
def api_unsubscribe():
    sub = request.get_json()
    if not sub or 'endpoint' not in sub:
        return jsonify({"error": "Invalid subscription"}), 400
    subs = load_subscriptions()
    subs = [s for s in subs if s.get('endpoint') != sub['endpoint']]
    save_subscriptions(subs)
    log.info(f"Unsubscribed: {sub['endpoint'][:60]}...")
    return jsonify({"ok": True})

@app.route('/api/test_push', methods=['POST'])
def api_test_push():
    """Send a test notification to all subscribers."""
    broadcast_push("🔔 Test Notification", "Bus tracker is working!")
    return jsonify({"ok": True, "subscribers": len(load_subscriptions())})

# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    poll_thread = threading.Thread(target=polling_loop, daemon=True)
    poll_thread.start()
    app.run(host='0.0.0.0', port=PORT, debug=False)
