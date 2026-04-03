#!/usr/bin/env node
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (!fs.existsSync(envPath)) {
  console.error('No .env.local found at', envPath);
  console.error('Create vercel-proxy/.env.local with the required keys first.');
  process.exit(1);
}

const content = fs.readFileSync(envPath, 'utf8');
const lines = content.split(/\r?\n/);
const env = {};
for (const line of lines) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|(.*))\s*$/);
  if (!m) continue;
  const key = m[1];
  const val = m[2] ?? m[3] ?? m[4] ?? '';
  env[key] = val;
}

const mapping = {
  AUTH0_DOMAIN: 'auth0_domain',
  AUTH0_CLIENT_ID: 'auth0_client_id',
  TOKEN_VAULT_SECRET: 'token_vault_secret',
  ANOMALY_WEBHOOK_SECRET: 'anomaly_webhook_secret'
};

function listSecrets() {
  try {
    const out = execSync('npx vercel secrets ls --debug', { encoding: 'utf8' });
    return out;
  } catch (err) {
    // Some vercel versions exit non-zero when no secrets exist; return empty string
    return '';
  }
}

const existing = listSecrets();

for (const [envKey, secretName] of Object.entries(mapping)) {
  const value = env[envKey];
  if (!value) {
    console.log(`Skipping ${envKey}: not present in .env.local`);
    continue;
  }

  if (existing.includes(secretName)) {
    console.log(`Secret '${secretName}' already exists — skipping`);
    continue;
  }

  console.log(`Adding secret '${secretName}' from ${envKey}...`);
  try {
    // Use execSync so the command runs synchronously and prints output
    execSync(`npx vercel secrets add ${secretName} "${value.replace(/\"/g, '\\"')}"`, { stdio: 'inherit' });
    console.log(`-> Added ${secretName}`);
  } catch (err) {
    console.error(`Failed to add ${secretName}:`, err.message || err);
  }
}

console.log('Done. If any secrets were added, run `npx vercel deploy --prod --force` to redeploy.');
