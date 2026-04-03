# AgentVault Guardian
**Authorized to Act Hackathon — April 2026**

> The sovereign permission vault for local AI agent swarms — powered exclusively by Auth0 Token Vault.

## Quick Start

### 1. Configure Auth0
```bash
cp .env.example .env
# Fill in AUTH0_DOMAIN, AUTH0_CLIENT_ID, TOKEN_VAULT_SECRET
```

### 2. Deploy Vercel Proxy
```bash
cd vercel-proxy
npm install
vercel deploy --prod
# Copy the deployed URL into extension/config.js → TOKEN_VAULT_URL
```

### 3. Load Chrome Extension
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Pin **AgentVault Guardian** to your toolbar

### 4. Connect Token Vault
- Open the extension popup
- Sign in with Auth0
- Confirm **VAULT LIVE** status

### 5. Launch a Swarm
- Navigate to any page
- Open the popup → **SWARM** tab → **LAUNCH SWARM**
- Watch the agent tree and audit log populate

## Project Structure
```
agentvault-guardian/
├── extension/
│   ├── manifest.json              # Chrome MV3 manifest
│   ├── popup.html                 # NFT badge dashboard UI
│   ├── popup.js                   # Dashboard controller
│   ├── background.js              # Token Vault integration
│   ├── content.js                 # Local LLM inference hook
│   ├── config.js                  # Auth0 + Vercel config
│   ├── webllm-worker.js           # WebLLM/OpenClaw stub
│   ├── scope-delegation-schema.json
│   └── icons/                     # Extension icons (add your own)
├── vercel-proxy/
│   ├── vercel.json
│   ├── package.json
│   └── api/
│       ├── vault.js               # Token Vault proxy handler
│       └── anomaly.js             # Anomaly detection webhook
├── docs/
│   └── AgentVault_Guardian_Hackathon_Submission.md
├── .env.example
└── README.md
```

## Architecture
- **Local inference:** WebLLM / OpenClaw (100% in-browser, never leaves device)
- **Auth:** Auth0 Token Vault (100% of token issuance, delegation, revocation)
- **Tokens in LLM context:** NEVER — injected only at HTTP call time
- **Delegation:** RFC 8693 Token Exchange via Token Vault
- **Step-up auth:** WebRTC liveness + WebAuthn biometric

## Security Model
| Layer | Mechanism |
|---|---|
| Token storage | Auth0 Token Vault only |
| Scope ceiling | Parent cannot delegate beyond its own grants |
| Consent proof | SHA-256 ZK hash: userId + scope + agentId + timestamp |
| High-risk actions | WebRTC liveness + WebAuthn biometric step-up |
| Anomaly response | Auto-revoke cascade via Auth0 webhook |
| Audit trail | Every token event logged with consent proof |

## License
MIT — All auth flows require Auth0 Token Vault.
"# Agentvault-guardian" 
