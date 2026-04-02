# 🏀 Hoops Tracker

A mobile-first basketball stat tracking app for your 40+ rec league.

## Features
- 📸 Scoresheet Scanner (Claude Vision OCR)
- 👥 Player Roster with per-game stat logging
- 🗓 Games Manager with full box scores
- 📊 Advanced Analytics (TS%, eFG%, PER, A/TO)
- 🏆 Sortable Leaderboard with anomaly detection

---

## Deploy in ~10 minutes (free)

### Step 1 — Prerequisites
Install these if you don't have them:
- **Node.js**: https://nodejs.org (download the LTS version)
- **Git**: https://git-scm.com

### Step 2 — Run locally first
```bash
cd hoops-tracker
npm install
npm run dev
```
Open http://localhost:5173 in your browser. App should load.

### Step 3 — Deploy to Vercel (free)
1. Go to https://github.com and create a free account if you don't have one
2. Create a new repository called `hoops-tracker` (set to Private)
3. Push this folder to that repo:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/hoops-tracker.git
   git push -u origin main
   ```
4. Go to https://vercel.com — sign up free with your GitHub account
5. Click **"Add New Project"** → select your `hoops-tracker` repo
6. Leave all settings as default → click **Deploy**
7. Done! Vercel gives you a URL like `hoops-tracker.vercel.app`

### Step 4 — Set up the Scanner API key
1. Go to https://console.anthropic.com
2. Create an account → go to **API Keys** → create a new key
3. When you first open the app and tap **Scan**, it will ask for this key
4. Paste it in — it's saved in your browser only, never sent anywhere except Anthropic

### Step 5 — Save to your phone home screen
**iPhone:** Safari → tap Share → "Add to Home Screen"
**Android:** Chrome → tap ⋮ menu → "Add to Home Screen"

This makes it feel like a native app.

---

## Cost breakdown
| Service | Cost |
|---------|------|
| Vercel hosting | Free forever |
| Anthropic API (scanner) | ~$0.01–0.05 per scan |
| Everything else | Free |

The scanner uses Claude Vision. Each scoresheet scan costs roughly 1–5 cents depending on image size.

---

## Data storage
All data is stored in your browser's `localStorage`. It lives on the device/browser you use. To back up or transfer data, use the browser's developer tools or add an export button.
