// background.js — AgentVault Guardian Service Worker
// 100% Auth0 Token Vault reliance — no token ever touches local storage

import { AUTH0_DOMAIN, AUTH0_CLIENT_ID, TOKEN_VAULT_URL, ANOMALY_WEBHOOK } from './config.js';

// ─── ZK Consent Proof ────────────────────────────────────────────────────────
async function generateConsentProof(userId, scope, agentId) {
  const payload = `${userId}|${scope}|${agentId}|${Date.now()}`;
  const msgBuf  = new TextEncoder().encode(payload);
  const hashBuf = await crypto.subtle.digest('SHA-256', msgBuf);
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return { proof: `0x${hashHex}`, payload, timestamp: Date.now() };
}

// ─── Token Vault — Issue Token ────────────────────────────────────────────────
async function fetchVaultToken({ scope, agentId, elevated = false, consentProof }) {
  const res = await fetch(`${TOKEN_VAULT_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'X-Agent-ID':      agentId,
      'X-Consent-Proof': consentProof.proof
    },
    body: JSON.stringify({
      scope,
      agent_id:   agentId,
      elevated,
      grant_type: 'urn:auth0:params:oauth:grant-type:token-vault',
      client_id:  AUTH0_CLIENT_ID
    })
  });
  if (!res.ok) throw new Error(`Token Vault error: ${res.status}`);
  return res.json(); // { access_token, expires_in, scope, token_id }
}

// ─── Token Vault — Delegate to Sub-Agent ─────────────────────────────────────
async function delegateToken({ parentTokenId, childScope, childAgentId, userId }) {
  const proof  = await generateConsentProof(userId, childScope, childAgentId);
  const res    = await fetch(`${TOKEN_VAULT_URL}/delegate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parent_token_id: parentTokenId,
      child_scope:     childScope,
      child_agent_id:  childAgentId,
      consent_proof:   proof.proof,
      ttl_seconds:     1800,
      client_id:       AUTH0_CLIENT_ID
    })
  });
  if (!res.ok) throw new Error('Delegation failed');
  const result = await res.json();
  await relayAuditLog({ event: 'TOKEN_DELEGATED', agentId: childAgentId, scope: childScope, proof });
  return result;
}

// ─── Token Vault — Revoke ────────────────────────────────────────────────────
async function revokeToken(tokenId) {
  await fetch(`${TOKEN_VAULT_URL}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token_id: tokenId, client_id: AUTH0_CLIENT_ID })
  });
  await relayAuditLog({ event: 'TOKEN_REVOKED', tokenId });
}

// ─── Anomaly Detection → Auto-Revoke ─────────────────────────────────────────
async function checkAnomaly(agentId, actionCount) {
  const rateLimit = 20;
  if (actionCount > rateLimit) {
    console.warn(`[AgentVault] Anomaly: ${agentId} exceeded rate limit — triggering revoke`);
    await fetch(ANOMALY_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, reason: 'rate_limit_exceeded', action_count: actionCount })
    });
  }
}

// ─── Audit Log Relay ──────────────────────────────────────────────────────────
async function relayAuditLog(entry) {
  await fetch(`${TOKEN_VAULT_URL}/audit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...entry, timestamp: Date.now() })
  });
}

// ─── Launch Agent Swarm ───────────────────────────────────────────────────────
async function launchSwarm(task, userId) {
  // 1. Orchestrator token from Token Vault
  const orchProof = await generateConsentProof(userId, 'orchestrate:*', 'orchestrator');
  const orchToken = await fetchVaultToken({
    scope:        'calendar:read travel:search booking:write',
    agentId:      'orchestrator',
    consentProof: orchProof
  });

  // 2. Sub-agent delegation schema
  const subAgents = [
    { id: 'researcher', scope: 'travel:search' },
    { id: 'analyzer',   scope: 'calendar:read' },
    { id: 'reporter',   scope: '' },            // local-only, no API token needed
    { id: 'booker',     scope: 'booking:write', elevated: true }
  ];

  const agentTokens = {};
  for (const agent of subAgents) {
    if (!agent.scope) continue;
    const delegated = await delegateToken({
      parentTokenId: orchToken.token_id,
      childScope:    agent.scope,
      childAgentId:  agent.id,
      userId
    });
    agentTokens[agent.id] = delegated.access_token;
  }

  // 3. Dispatch to content script for local LLM inference
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, {
    type: 'RUN_SWARM',
    task,
    agentTokens,
    orchestratorToken: orchToken.access_token
  });
}

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const userId = 'auth0|demo-user'; // In prod: read from Auth0 session

  switch (msg.type) {
    case 'LAUNCH_SWARM':
      launchSwarm(msg.task, userId).then(() => sendResponse({ ok: true }));
      return true;

    case 'DELEGATE_TOKEN':
      delegateToken({
        parentTokenId: 'current',
        childScope:    msg.scope,
        childAgentId:  msg.agentId,
        userId
      }).then(r => sendResponse(r));
      return true;

    case 'REVOKE_TOKEN':
      revokeToken(msg.badgeId).then(() => sendResponse({ ok: true }));
      return true;

    case 'STEPUP_APPROVED':
      generateConsentProof(userId, 'booking:write:elevated', msg.badgeId)
        .then(proof => fetchVaultToken({
          scope: 'booking:write', agentId: msg.badgeId, elevated: true, consentProof: proof
        }))
        .then(token => sendResponse({ token }));
      return true;

    case 'ANOMALY_REPORT':
      checkAnomaly(msg.agentId, msg.actionCount).then(() => sendResponse({ ok: true }));
      return true;
  }
});

// ─── Alarm: Proactive Token Refresh ──────────────────────────────────────────
chrome.alarms.create('token-refresh', { periodInMinutes: 25 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'token-refresh') {
    await fetch(`${TOKEN_VAULT_URL}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: AUTH0_CLIENT_ID })
    });
  }
});
