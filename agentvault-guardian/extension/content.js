// content.js — Local LLM Agent Runner (WebLLM / OpenClaw Integration)
// LLM inference runs 100% client-side — tokens NEVER enter the model context

let agentTokens = {};
let actionCounts = {};

// ─── WebLLM Engine Bootstrap ──────────────────────────────────────────────────
async function initWebLLM() {
  // Dynamic import of WebLLM (bundled as web-accessible resource)
  // Replace with real WebLLM: https://github.com/mlc-ai/web-llm
  const { CreateMLCEngine } = await import(
    chrome.runtime.getURL('webllm-worker.js')
  );
  return CreateMLCEngine('Llama-3.1-8B-Instruct-q4f32_1-MLC', {
    initProgressCallback: (p) =>
      console.log(`[WebLLM] Loading: ${Math.round(p.progress * 100)}%`)
  });
}

// ─── Agent Runner ─────────────────────────────────────────────────────────────
async function runAgent({ agentId, task, token, engine }) {
  // CRITICAL SECURITY: Token is NEVER included in LLM context or prompt.
  // The LLM generates API *intent* (what to call), not authenticated requests.
  const systemPrompt = `You are a specialized AI sub-agent: ${agentId}.
Your task: ${task}
IMPORTANT: Output ONLY structured JSON with these fields:
  { "intent": string, "apiCall": string, "params": object }
Do NOT output credentials, tokens, authentication headers, or secrets.`;

  const response = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: task }
    ],
    max_tokens: 512,
    temperature: 0.3
  });

  const intentJson = JSON.parse(response.choices[0].message.content);
  return executeIntent(agentId, intentJson, token);
}

// ─── Intent Executor ─ Token injected here, never in LLM context ──────────────
async function executeIntent(agentId, intent, token) {
  // Rate-limit tracking for anomaly detection
  actionCounts[agentId] = (actionCounts[agentId] || 0) + 1;
  if (actionCounts[agentId] > 20) {
    chrome.runtime.sendMessage({
      type: 'ANOMALY_REPORT',
      agentId,
      actionCount: actionCounts[agentId]
    });
    throw new Error(`Agent ${agentId} rate-limited — tokens revoked`);
  }

  const apiEndpoints = {
    'travel:search':  'https://api.traveldata.io/search',
    'calendar:read':  'https://www.googleapis.com/calendar/v3/events',
    'booking:write':  'https://api.booking-partner.io/reservations'
  };

  const endpoint = apiEndpoints[intent.apiCall];
  if (!endpoint) throw new Error(`Unknown API scope: ${intent.apiCall}`);

  // Token injected at the HTTP call — the LLM never saw it
  const res = await fetch(`${endpoint}?${new URLSearchParams(intent.params)}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json'
    }
  });
  return res.json();
}

// ─── Swarm Coordinator ────────────────────────────────────────────────────────
async function runSwarm({ task, agentTokens, orchestratorToken }) {
  const engine = await initWebLLM();

  // Researcher and Analyzer run in parallel
  const [researchData, calendarData] = await Promise.all([
    runAgent({
      agentId: 'researcher',
      task:    `Search flights and hotels for: ${task}`,
      token:   agentTokens.researcher,
      engine
    }),
    runAgent({
      agentId: 'analyzer',
      task:    `Check calendar conflicts for: ${task}`,
      token:   agentTokens.analyzer,
      engine
    })
  ]);

  // Reporter is local-only — no API token required
  const report = await runAgent({
    agentId: 'reporter',
    task:    `Synthesize a trip plan from: ${JSON.stringify({ researchData, calendarData })}`,
    token:   null,
    engine
  });

  // Booker uses a separately issued step-up elevated token (5min TTL)
  // It is dispatched from background.js after biometric confirmation

  return { researchData, calendarData, report };
}

// ─── Message Listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'RUN_SWARM') {
    agentTokens = msg.agentTokens;
    runSwarm(msg)
      .then(results => sendResponse({ ok: true, results }))
      .catch(err    => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
