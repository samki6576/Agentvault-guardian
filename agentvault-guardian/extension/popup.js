// popup.js — AgentVault Guardian Dashboard Controller

const BADGES = [
  { id: 'gcal',    icon: '📅', name: 'Calendar Read', scope: 'calendar:events:read',   risk: 'low',  ttl: '28m' },
  { id: 'github',  icon: '💾', name: 'GitHub Repos',  scope: 'repo:contents:read',     risk: 'low',  ttl: '55m' },
  { id: 'travel',  icon: '✈️', name: 'Travel Search', scope: 'travel:search',           risk: 'low',  ttl: '14m' },
  { id: 'booking', icon: '🏨', name: 'Book & Pay',    scope: 'booking:write:financial', risk: 'high', ttl: '4m'  },
];

const AGENTS = [
  { id: 'orch', name: 'Trip Planner Orchestrator', icon: '🧠', scopes: 'calendar:read, travel:search, booking:write', status: 'active',  level: 0 },
  { id: 'res',  name: 'Researcher Agent',          icon: '🔍', scopes: 'travel:search',          status: 'active',  level: 1 },
  { id: 'ana',  name: 'Analyzer Agent',            icon: '📊', scopes: 'calendar:read',          status: 'active',  level: 1 },
  { id: 'rep',  name: 'Reporter Agent',            icon: '📝', scopes: '(local only)',            status: 'active',  level: 1 },
  { id: 'book', name: 'Booker Agent',              icon: '💳', scopes: 'booking:write (step-up)', status: 'pending', level: 1 },
];

const AUDIT = [
  { time: '14:32:01', event: 'Token issued: Researcher ← travel:search',           proof: '0xf3a2...8c1d' },
  { time: '14:32:03', event: 'Token issued: Analyzer ← calendar:read',             proof: '0xb9e1...4f7a' },
  { time: '14:32:18', event: 'Anomaly probe: rate-limit check passed',              proof: '0xcc2d...91e3' },
  { time: '14:32:55', event: '⚠ Step-up triggered: booking:write requested',       proof: '0xd44f...2219' },
  { time: '14:33:01', event: 'Biometric verified — elevated token issued (TTL:5m)', proof: '0xa8f0...7bc6' },
];

function renderBadges() {
  document.getElementById('nft-gallery').innerHTML = BADGES.map(b => `
    <div class="nft-badge" draggable="true" data-id="${b.id}" data-risk="${b.risk}">
      <div class="badge-icon">${b.icon}</div>
      <div class="badge-name">${b.name}</div>
      <div class="badge-scope">${b.scope}</div>
      <div class="badge-meta">
        <span class="badge-ttl">⏱ ${b.ttl} left</span>
        <span class="badge-risk risk-${b.risk}">${b.risk.toUpperCase()}</span>
      </div>
    </div>
  `).join('');
  setupDragDrop();
}

function renderAgents() {
  document.getElementById('agent-tree').innerHTML = AGENTS.map(a => `
    <div class="agent-node ${a.level > 0 ? 'sub' : ''}">
      <div class="agent-icon">${a.icon}</div>
      <div class="agent-info">
        <div class="agent-name">${a.name}</div>
        <div class="agent-scopes">${a.scopes}</div>
      </div>
      <div class="agent-status status-${a.status}"></div>
    </div>
  `).join('');
}

function renderAudit() {
  document.getElementById('audit-log').innerHTML = AUDIT.map(e => `
    <div class="audit-entry">
      <div class="audit-time">${e.time}</div>
      <div class="audit-event">${e.event}</div>
      <div class="audit-proof" title="View ZK Proof">${e.proof}</div>
    </div>
  `).join('');
}

function setupDragDrop() {
  let dragged = null;

  document.querySelectorAll('.nft-badge').forEach(badge => {
    badge.addEventListener('dragstart', () => { dragged = badge; badge.classList.add('dragging'); });
    badge.addEventListener('dragend',   () => { badge.classList.remove('dragging'); dragged = null; });
  });

  const dropDelegate = document.getElementById('drop-delegate');
  const dropRevoke   = document.getElementById('drop-revoke');

  [dropDelegate, dropRevoke].forEach(zone => {
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('over');
      if (!dragged) return;

      const action   = zone.id === 'drop-delegate' ? 'delegate' : 'revoke';
      const badgeId  = dragged.dataset.id;
      const highRisk = dragged.dataset.risk === 'high';

      if (action === 'revoke') {
        chrome.runtime.sendMessage({ type: 'REVOKE_TOKEN', badgeId }, () => {
          dragged.style.opacity = '0.3';
          dragged.style.filter  = 'grayscale(1)';
          dragged.draggable     = false;
        });
      } else if (action === 'delegate') {
        if (highRisk) {
          triggerStepUp(badgeId);
        } else {
          chrome.runtime.sendMessage({ type: 'DELEGATE_TOKEN', badgeId });
        }
      }
    });
  });
}

function triggerStepUp(badgeId) {
  const modal = document.getElementById('stepup-modal');
  modal.classList.add('active');

  navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => { document.getElementById('camera-feed').srcObject = stream; })
    .catch(() => {});

  document.getElementById('biometric-confirm-btn').onclick = () => {
    performWebAuthn().then(() => {
      modal.classList.remove('active');
      chrome.runtime.sendMessage({ type: 'STEPUP_APPROVED', badgeId });
    });
  };
}

async function performWebAuthn() {
  try {
    return await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: chrome.runtime.id,
        allowCredentials: [],
        userVerification: 'required',
        timeout: 30000
      }
    });
  } catch {
    return true; // demo fallback — production must hard-fail
  }
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

document.getElementById('launch-swarm-btn')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'LAUNCH_SWARM', task: 'Plan a 5-day trip to Tokyo' });
});

renderBadges();
renderAgents();
renderAudit();
