# 🚌 Bus Tracker – iOS Web Push PWA

A full-stack PWA that tracks your school bus in real-time and sends native push notifications to your iPhone when the bus approaches school.

## Quick Start

### 1. Configure Your `.env` File
```bash
cp .env.example .env
```
Edit `.env` with your real values:
- **HCTB credentials**: email, password, and 5-digit district code from HereComesBus
- **SCHOOL_LAT / SCHOOL_LON**: Right-click your school on Google Maps → "Copy coordinates"
- **VAPID keys**: Already generated in `vapid_keys.txt` — copy them in

### 2. Run Locally (for testing)
```powershell
.\venv\Scripts\activate
python tracker.py
```
Then open `http://localhost:5000` in your browser.

---

## 🚀 Deploying to Railway (Recommended)

1. Push this folder to a GitHub repo:
   ```bash
   git init && git add . && git commit -m "init"
   gh repo create bustracker --public --push --source .
   ```
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub Repo**
3. Select your repo — Railway auto-detects the `Procfile`
4. Click **Variables** and add all your `.env` values
5. Click **Deploy** — you'll get a public HTTPS URL (e.g., `bustracker.up.railway.app`)

## 📱 Enabling iOS Notifications

Push notifications on iOS require the app to be installed as a PWA:
1. Open the Railway URL in **Safari on your iPhone**
2. Tap the Share button → **"Add to Home Screen"**
3. Open the app from your Home Screen icon
4. Tap the **Enable Notifications** toggle
5. Tap **Allow** when iOS prompts for permission

## 🔑 Regenerating VAPID Keys
```bash
.\venv\Scripts\activate
python generate_vapid.py
```
Copy the output into your `.env` and Railway environment variables.

---

## How It Works
| Component | Purpose |
|---|---|
| `tracker.py` | Flask server + background HCTB polling thread |
| `static/sw.js` | Service Worker — receives push in background |
| `static/app.js` | Subscribes device, polls live status |
| `static/index.html` | Dashboard UI |
| `subscriptions.json` | Auto-created — stores push subscriptions |
