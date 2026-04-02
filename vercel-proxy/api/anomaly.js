// api/anomaly.js — Anomaly detection webhook processor (Vercel serverless)
// Receives anomaly signals from the extension and triggers token revocation
// via Auth0 Token Vault.

const AUTH0_DOMAIN           = process.env.AUTH0_DOMAIN;
const TOKEN_VAULT_SECRET     = process.env.TOKEN_VAULT_SECRET;
const ANOMALY_WEBHOOK_SECRET = process.env.ANOMALY_WEBHOOK_SECRET;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204)
      .setHeader('Access-Control-Allow-Origin',  '*')
      .setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type')
      .end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { agent_id, reason, action_count } = req.body;

  if (!agent_id || !reason) {
    return res.status(400).json({ error: 'Missing agent_id or reason' });
  }

  console.log(`[ANOMALY] agent=${agent_id} reason=${reason} count=${action_count}`);

  try {
    // Instruct Auth0 Token Vault to revoke ALL tokens for this agent_id
    // cascade:true revokes all child delegated tokens too
    const revokeRes = await fetch(
      `https://${AUTH0_DOMAIN}/api/v2/tokens/revoke-by-agent`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKEN_VAULT_SECRET}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({
          agent_id,
          reason,
          cascade: true,         // revoke all delegated child tokens
          notify:  true          // notify user via Auth0 Actions
        })
      }
    );

    if (!revokeRes.ok) {
      const err = await revokeRes.text();
      console.error(`[ANOMALY] Revoke failed for ${agent_id}:`, err);
    } else {
      console.log(`[ANOMALY] Tokens cascade-revoked for agent: ${agent_id}`);
    }

    return res.status(200).json({
      received:      true,
      agent_id,
      reason,
      action:        'tokens_cascade_revoked',
      timestamp:     Date.now()
    });
  } catch (err) {
    console.error('[ANOMALY] Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
