# Contributing to Valorant Realtime Score Alert

Thank you for your interest in contributing to Valorant Realtime Score Alert!

## 🚀 Development Workflow

1. **Clone the repository**:
   ```bash
   git clone https://github.com/103PU/Valorant-Alert-Source.git
   cd Valorant-Alert-Source
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run unit tests**:
   ```bash
   npm test
   ```

4. **Start local development server**:
   ```bash
   npm start
   ```

5. **Build portable release package**:
   ```bash
   npm run build
   ```

## 📐 Architecture Overview

- `server/riot/`: Lockfile parsing, local Riot Client TLS authentication, and regional shard detection.
- `server/core/`: Game state polling loop and alert decision rules (`alert-rules.js`).
- `server/transport/`: WebSocket broadcast server for real-time mobile sync.
- `server/routes/`: HTTP route handlers for QR generation, system info, and desktop shortcut generation.
- `server/app.js`: Clean HTTP request router.
- `server/index.js`: Main entrypoint for server startup.
- `public/`: Frontend Progressive Web App (PWA) and PC Dashboard.
- `test/`: Automated test suite powered by `node:test`.

## 🌿 Branching Strategy

- `main`: Production-ready code. Official releases are tagged with `v*.*.*`.
- `dev`: Active development and feature integration.
