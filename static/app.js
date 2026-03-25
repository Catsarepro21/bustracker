/* ================================================================
   app.js – Bus Tracker PWA logic
   ================================================================ */

const API = '';

// Panther Creek High School, Cary, NC - hardcoded
const SCHOOL = { lat: 35.8303530, lon: -78.8902128, name: "Panther Creek High School" };
let RADIUS_MILES = 2.0;
let RADIUS_METERS = RADIUS_MILES * 1609.34;

let swReg = null;
let pushSubscription = null;
let map = null;
let busMarker = null;
let radiusCircle = null;
let schoolMarker = null;

// ── DOM refs ──────────────────────────────────────────────────────
const distanceEl   = document.getElementById('distance-value');
const distanceUnit = document.getElementById('distance-unit');
const distLabel    = document.getElementById('distance-label');
const statusDot    = document.getElementById('status-dot');
const zoneFill     = document.getElementById('zone-fill');
const zoneBadge    = document.getElementById('zone-badge');
const lastUpdEl    = document.getElementById('last-updated');
const errorBox     = document.getElementById('error-box');
const pushToggle   = document.getElementById('push-toggle');
const iosNotice    = document.getElementById('ios-notice');
const testPushBtn   = document.getElementById('test-push-btn');
const radiusSlider  = document.getElementById('radius-slider');
const radiusDisplay = document.getElementById('radius-display');

// ── Map init ──────────────────────────────────────────────────────
function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: false })
             .setView([SCHOOL.lat, SCHOOL.lon], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // School marker
    const schoolIcon = L.divIcon({
        html: '🏫',
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
    });
    schoolMarker = L.marker([SCHOOL.lat, SCHOOL.lon], { icon: schoolIcon })
        .addTo(map)
        .bindPopup(`<strong>${SCHOOL.name}</strong><br>Cary, NC`);

    // Radius circle
    radiusCircle = L.circle([SCHOOL.lat, SCHOOL.lon], {
        radius: RADIUS_METERS,
        color: '#2563eb',
        fillColor: '#2563eb',
        fillOpacity: 0.07,
        weight: 1.5,
        dashArray: '5, 5',
    }).addTo(map);

    // Fit map to circle
    map.fitBounds(radiusCircle.getBounds(), { padding: [20, 20] });

    // Radius slider
    radiusSlider.addEventListener('input', () => {
        RADIUS_MILES = parseFloat(radiusSlider.value);
        RADIUS_METERS = RADIUS_MILES * 1609.34;
        radiusDisplay.textContent = RADIUS_MILES.toFixed(2).replace(/\.?0+$/, '') + ' mi';
        radiusCircle.setRadius(RADIUS_METERS);
        map.fitBounds(radiusCircle.getBounds(), { padding: [20, 20] });
        zoneBadge.textContent = `${RADIUS_MILES} mi alert radius`;
    });
}

// ── Status polling ────────────────────────────────────────────────
function formatTime(isoStr) {
    if (!isoStr) return '—';
    try { return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return isoStr; }
}

async function fetchStatus() {
    try {
        const res = await fetch(`${API}/api/status`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        updateUI(data);
        window._vapidPublicKey = data.vapid_public_key;
    } catch (e) {
        showError('Could not reach the server.');
    }
}

function updateUI(data) {
    hideError();
    lastUpdEl.textContent = formatTime(data.last_updated);
    const dist = data.distance_miles;

    if (dist !== null && dist !== undefined) {
        distanceEl.textContent = dist.toFixed(1);
        distanceUnit.textContent = 'mi';
        distLabel.textContent = 'from Panther Creek HS';

        const dotClass = data.in_school_zone ? 'active alert' : 'active';
        statusDot.className = 'status-dot ' + dotClass;

        const pct = Math.max(0, Math.min(100, (1 - dist / (RADIUS_MILES * 3)) * 100));
        zoneFill.style.width = pct + '%';

        if (data.in_school_zone) {
            zoneBadge.textContent = '⚠ Bus approaching school';
            zoneBadge.classList.add('in-zone');
        } else {
            zoneBadge.textContent = `${RADIUS_MILES} mi alert radius`;
            zoneBadge.classList.remove('in-zone');
        }

        // Update bus marker on map
        if (data.latitude && data.longitude) {
            const pos = [data.latitude, data.longitude];
            const busIcon = L.divIcon({
                html: '🚌',
                className: '',
                iconSize: [24, 24],
                iconAnchor: [12, 12],
            });
            if (busMarker) {
                busMarker.setLatLng(pos);
            } else {
                busMarker = L.marker(pos, { icon: busIcon }).addTo(map)
                    .bindPopup(`Bus — ${dist.toFixed(1)} mi from school`);
            }
        }
    } else if (data.error) {
        distanceEl.textContent = '—';
        distanceUnit.textContent = '';
        distLabel.textContent = '';
        statusDot.className = 'status-dot';
        zoneFill.style.width = '0%';
        zoneBadge.textContent = 'Bus not active';
        zoneBadge.classList.remove('in-zone');
        showError(data.error);
    } else {
        // Null state — server just started, first poll hasn't completed yet
        distanceEl.textContent = '—';
        distanceUnit.textContent = '';
        statusDot.className = 'status-dot';
        zoneFill.style.width = '0%';
        zoneBadge.textContent = 'Starting up…';
        zoneBadge.classList.remove('in-zone');
        hideError();
    }
}

// ── Push notifications ────────────────────────────────────────────
function urlBase64ToUint8Array(b64) {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from([...atob(base64)].map(c => c.charCodeAt(0)));
}

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
        swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch (e) { console.error('SW failed:', e); }
}

async function subscribePush() {
    if (!swReg) { alert('Service Worker not ready.'); return; }
    const key = window._vapidPublicKey;
    if (!key) { alert('VAPID key not loaded yet. Try again in a moment.'); return; }
    try {
        const sub = await swReg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key),
        });
        pushSubscription = sub;
        await fetch(`${API}/api/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub.toJSON()),
        });
    } catch (e) {
        console.error('Push subscribe failed:', e);
        alert('Could not enable notifications. On iPhone, add this app to your Home Screen first, then try again.');
        pushToggle.checked = false;
    }
}

async function unsubscribePush() {
    if (!pushSubscription) return;
    await fetch(`${API}/api/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pushSubscription.toJSON()),
    });
    await pushSubscription.unsubscribe();
    pushSubscription = null;
}

async function syncToggleState() {
    if (!swReg) return;
    const sub = await swReg.pushManager.getSubscription().catch(() => null);
    pushSubscription = sub;
    pushToggle.checked = !!sub;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS && !window.navigator.standalone) {
        iosNotice.style.display = 'block';
    }
}

pushToggle.addEventListener('change', async () => {
    pushToggle.disabled = true;
    if (pushToggle.checked) {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            alert('Please allow notifications in your settings.');
            pushToggle.checked = false;
            pushToggle.disabled = false;
            return;
        }
        await subscribePush();
    } else {
        await unsubscribePush();
    }
    pushToggle.disabled = false;
});

testPushBtn.addEventListener('click', async () => {
    testPushBtn.disabled = true;
    testPushBtn.textContent = 'Sending…';
    try {
        await fetch(`${API}/api/test_push`, { method: 'POST' });
        testPushBtn.textContent = 'Sent!';
    } catch { testPushBtn.textContent = 'Error'; }
    setTimeout(() => { testPushBtn.textContent = 'Send Test Notification'; testPushBtn.disabled = false; }, 2000);
});

function showError(msg) { errorBox.textContent = msg; errorBox.style.display = 'block'; }
function hideError()    { errorBox.style.display = 'none'; }

// ── Init ──────────────────────────────────────────────────────────
(async () => {
    initMap();
    await registerServiceWorker();
    await syncToggleState();
    await fetchStatus();
    setInterval(fetchStatus, 30000);
})();
