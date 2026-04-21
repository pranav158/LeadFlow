<h1 align="center">⚡ LeadFlow</h1>

<p align="center">
  <strong>A self-hosted lead management system secured behind Discord OAuth2.</strong><br/>
  Track leads, manage statuses, add notes, and maintain a full audit trail — all from a sleek dark-themed dashboard.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square&logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/express-5.x-blue?style=flat-square&logo=express" alt="Express" />
  <img src="https://img.shields.io/badge/mongodb-atlas%20%7C%20self--hosted-47A248?style=flat-square&logo=mongodb" alt="MongoDB" />
  <img src="https://img.shields.io/badge/auth-discord%20oauth2-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord OAuth2" />
  <img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" alt="License" />
</p>

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔐 **Discord OAuth2** | Whitelist-based login — only approved Discord users can access the app |
| 📋 **Lead Management** | Create, edit, delete leads with company info, email, website, address & country |
| 🏷️ **Status Tracking** | Move leads between **Active**, **Blacklisted**, and **Accepted** |
| 📝 **Notes** | Add timestamped notes to any lead — linked to the user who wrote them |
| 📜 **Audit Logs** | Every action (create, edit, delete, status change, note) is logged with who did it |
| 💾 **Encrypted Backups** | Automatic daily backups encrypted with AES-256-GCM, configurable retention |
| 🛡️ **Security Hardened** | Helmet CSP, rate limiting, CSRF origin validation, session encryption, input sanitization |
| 📱 **Responsive** | Works on desktop, tablet, and mobile with an adaptive sidebar layout |

---

## 🛠️ Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express 5
- **Database:** MongoDB (Atlas or self-hosted) via Mongoose
- **Auth:** Discord OAuth2 (native `fetch`, no Passport)
- **Sessions:** `express-session` + `connect-mongo` with AES-256-GCM encryption
- **Security:** `helmet`, `express-rate-limit`, Origin/Referer CSRF validation
- **Backups:** `node-cron` scheduled encrypted dumps
- **Frontend:** Vanilla HTML / CSS / JS — no build step, no framework

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- A [MongoDB](https://www.mongodb.com/) database (Atlas free tier works great)
- A [Discord Application](https://discord.com/developers/applications) with OAuth2 configured

### 1. Clone & install

```bash
git clone https://github.com/pranav158/leadflow.git
cd leadflow
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your `.env`:



### 3. Set up Discord OAuth2

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application → go to **OAuth2**
3. Add a redirect: `http://localhost:3000/auth/discord/callback`
4. Copy **Client ID** and **Client Secret** into your `.env`

> **Finding your Discord User ID:** Settings → Advanced → Enable Developer Mode → right-click your username → *Copy User ID*

### 4. Run

```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

Open [http://localhost:3000](http://localhost:3000) and log in with Discord.

---

## 📁 Project Structure

```
leadflow/
├── config/
│   └── db.js               # MongoDB connection
├── middleware/
│   └── auth.js              # Auth middleware + Discord ID whitelist
├── models/
│   ├── Lead.js              # Lead schema
│   ├── Log.js               # Audit log schema
│   ├── Note.js              # Note schema
│   └── User.js              # User schema (Discord profile)
├── public/
│   ├── css/style.css         # Full stylesheet (dark theme)
│   ├── js/app.js             # Frontend logic (vanilla JS)
│   ├── dashboard.html        # Protected dashboard
│   ├── index.html            # Login page
│   └── unauthorized.html     # Access denied page
├── routes/
│   ├── auth.js               # Discord OAuth2 flow
│   ├── leads.js              # Lead CRUD API
│   ├── logs.js               # Audit log API
│   └── notes.js              # Notes API
├── utils/
│   └── backup.js             # Encrypted backup + scheduler
├── server.js                 # Express app entry point
├── .env.example              # Environment template
├── .gitignore
└── package.json
```

---

## 🔒 Security

| Layer | Implementation |
|---|---|
| **Headers** | Helmet with strict CSP (script, style, font, img, connect, frame, object directives) |
| **Rate Limiting** | Global 100 req/min, auth 5 req/min, API writes 30 req/min, backup 2 req/min |
| **CSRF** | Origin/Referer header validation on all state-changing requests |
| **OAuth** | Cryptographic state parameter to prevent CSRF/login confusion |
| **Sessions** | MongoDB-backed, AES-256-GCM encrypted, `httpOnly` + `secure` + `sameSite: lax` cookies |
| **Input** | Length validation, regex escaping for search (NoSQL injection prevention) |
| **Backups** | AES-256-GCM encrypted `.enc` files with PBKDF2-derived key, `chmod 600` |

---

## 🌐 Production Deployment

For production behind Nginx:

1. Set `NODE_ENV=production` in `.env`
2. Update `CALLBACK_URL` to your real domain
3. Update the Discord Developer Portal redirect URI to match
4. The app already has `trust proxy` enabled for reverse proxy setups

Example Nginx config:

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 📄 License

[MIT]
