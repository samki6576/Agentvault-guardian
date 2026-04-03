// api/vault.js — Token Vault proxy handler (Vercel serverless function)
// Normalises CORS, proxies Auth0 Token Vault, relays audit log entries.
// No tokens are stored on this server — all state lives in Auth0.

const AUTH0_DOMAIN       = process.env.AUTH0_DOMAIN;
const AUTH0_CLIENT_ID    = process.env.AUTH0_CLIENT_ID;
const TOKEN_VAULT_SECRET = process.env.TOKEN_VAULT_SECRET;

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204)
      .setHeader('Access-Control-Allow-Origin',  '*')
      .setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Agent-ID, X-Consent-Proof')
      .end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract sub-path: /api/vault/token → "token"
  const url    = req.url || '';
  const path   = url.split('/api/vault/')[1]?.split('?')[0] || '';
  const vaultBase = `https://${AUTH0_DOMAIN}/oauth`;

  try {
    switch (path) {

      // ── Issue scoped token via Token Vault ──────────────────────────────────
      case 'token': {
        const { scope, agent_id, elevated, grant_type, client_id } = req.body;
        const vaultRes = await fetch(`${vaultBase}/token`, {
          method: 'POST',
          headers: {
            'Content-Type':    'application/json',
            'Authorization':   `Bearer ${TOKEN_VAULT_SECRET}`,
            'X-Agent-ID':      req.headers['x-agent-id'] || agent_id || '',
            'X-Consent-Proof': req.headers['x-consent-proof'] || ''
          },
          body: JSON.stringify({
            grant_type: grant_type || 'client_credentials',
            client_id:  client_id  || AUTH0_CLIENT_ID,
            scope,
            audience:   `https://${AUTH0_DOMAIN}/api/v2/`,
            ...(elevated ? { acr_values: 'http://schemas.openid.net/pape/policies/2007/06/multi-factor' } : {})
          })
        });
        const data = await vaultRes.json();
        return res.status(vaultRes.status).json(data);
      }

      // ── Delegate token to sub-agent (RFC 8693 Token Exchange) ───────────────
      case 'delegate': {
        const { parent_token_id, child_scope, child_agent_id, consent_proof, ttl_seconds, client_id } = req.body;

        const vaultRes = await fetch(`${vaultBase}/token`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${TOKEN_VAULT_SECRET}`
          },
          body: JSON.stringify({
            grant_type:           'urn:ietf:params:oauth:grant-type:token-exchange',
            subject_token:        parent_token_id,
            subject_token_type:   'urn:ietf:params:oauth:token-type:access_token',
            requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
            scope:                child_scope,
            audience:             child_agent_id,
            client_id:            client_id || AUTH0_CLIENT_ID,
            // Token Vault scope ceiling: child cannot exceed parent
            requested_expiry:     ttl_seconds || 1800
          })
        });
        const data = await vaultRes.json();

        // Attach the consent proof to the response for audit trail
        return res.status(vaultRes.status).json({ ...data, consent_proof });
      }

      // ── Revoke token ────────────────────────────────────────────────────────
      case 'revoke': {
        const { token_id, client_id } = req.body;
        await fetch(`${vaultBase}/revoke`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${TOKEN_VAULT_SECRET}`
          },
          body: JSON.stringify({
            token:     token_id,
            client_id: client_id || AUTH0_CLIENT_ID
          })
        });
        return res.status(200).json({ revoked: true, token_id });
      }

      // ── Relay audit log entry ───────────────────────────────────────────────
      case 'audit': {
        const entry = req.body;
        // In production: forward to Auth0 log stream or your SIEM
        console.log('[AUDIT]', JSON.stringify({ ...entry, server_ts: Date.now() }));
        return res.status(200).json({ logged: true });
      }

      // ── Keep Token Vault session alive ──────────────────────────────────────
      case 'refresh': {
        const { client_id } = req.body;
        const vaultRes = await fetch(`${vaultBase}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type:    'client_credentials',
            client_id:     client_id || AUTH0_CLIENT_ID,
            client_secret: TOKEN_VAULT_SECRET,
            audience:      `https://${AUTH0_DOMAIN}/api/v2/`
          })
        });
        return res.status(vaultRes.status).json(await vaultRes.json());
      }

      default:
        return res.status(404).json({ error: `Unknown vault endpoint: ${path}` });
    }
  } catch (err) {
    console.error('[Vault Proxy Error]', err);
    return res.status(500).json({ error: err.message });
  }
}
