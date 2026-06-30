'use strict';
/*
 * Air Master Agent.
 *
 * Forwards chat messages to the n8n Air Master Agent workflow (OpenAI-backed)
 * via its Chat Trigger webhook, and returns the agent's reply text.
 *
 * Signature kept as (message, context) -> Promise<string> so server.js is unchanged.
 *
 * Config (env, with sane default):
 *   N8N_AGENT_WEBHOOK  full webhook URL of the n8n Chat Trigger
 */

const { runPlan } = require('./engine');

const N8N_AGENT_WEBHOOK =
  process.env.N8N_AGENT_WEBHOOK ||
  'https://donedl-n8n.fly.dev/webhook/air-master-agent/chat';

const TIMEOUT_MS = 30000;

// When the manifest is complete, the n8n agent emits a machine block:
//   <<PLAN>>{"family":"PMC","items":[{"name","length","width","height","weight","quantity"}]}<<END>>
// We strip it, expand quantities into individual boxes, run the local CargoFlow
// engine, and append a build-up verdict.
const PLAN_RE = /<<PLAN>>\s*([\s\S]*?)\s*<<END>>/;

// Expand agent items (with quantity) into unique-id boxes the engine expects.
// Mirrors collectManifestBoxes() in public/app.js.
function expandBoxes(items) {
  const boxes = [], seen = {};
  (items || []).forEach((it, i) => {
    const L = +it.length, W = +it.width, H = +it.height, wt = +it.weight;
    if (!(L > 0 && W > 0 && H > 0 && wt > 0)) return;
    const qty = Math.max(1, Math.floor(+it.quantity || 1));
    const base = String(it.name || it.id || `BOX_${i + 1}`).replace(/\s+/g, '_');
    for (let q = 1; q <= qty; q++) {
      let id = qty > 1 ? `${base}_${q}` : base;
      while (seen[id]) id += '*';
      seen[id] = true;
      boxes.push({ id, length: L, width: W, height: H, weight: wt });
    }
  });
  return boxes;
}

// Turn the engine plan into a short chat verdict: valid? and pallet placement.
function formatVerdict(plan) {
  if (!plan || typeof plan !== 'object') return 'Build-up check failed: no engine result.';

  const STATUS = {
    OK: '✅ Valid — legal, balanced & re-validated.',
    INFEASIBLE: '❌ Not valid — no legal balance could be found.',
    NO_PALLETS: '❌ Not valid — no pallets could be built from this shipment.',
    REVALIDATION_FAILED: '❌ Not valid — rejected by the re-validator.',
    ERROR: '❌ Engine error.',
  };
  const lines = [STATUS[plan.status] || `Status: ${plan.status || 'unknown'}`];

  // Where each pallet lands.
  const placed = (plan.pallets || []).filter((p) => p.position);
  if (placed.length) {
    lines.push('');
    lines.push('Pallet placement:');
    for (const p of placed) {
      lines.push(`• ${p.id} → position ${p.position} (${(p.weight || 0).toLocaleString()} kg)`);
    }
  }

  // Why-not details.
  if (plan.status !== 'OK') {
    const v = (plan.validation && plan.validation.violations) || [];
    const rej = plan.rejected || [];
    if (rej.length) {
      lines.push('');
      lines.push('Rejected by build-up:');
      for (const r of rej) {
        const id = r.id || r.box || 'item';
        const reason = r.reason || r.code || 'rejected';
        lines.push(`• ${id} — ${reason}`);
      }
    }
    if (v.length) {
      lines.push('');
      lines.push('Validation issues:');
      for (const x of v) lines.push(`• ${x}`);
    }
  }
  return lines.join('\n');
}

async function askAgent(message, context = {}) {
  const text = (message || '').trim();
  if (!text) return 'Tell me what you need help with, e.g. a shipment or quote.';

  // n8n Chat Trigger expects { chatInput, sessionId }.
  // Pass the platform session id so the workflow's memory threads correctly.
  const payload = {
    chatInput: text,
    sessionId: context.sessionId || 'air-master',
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(N8N_AGENT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`n8n responded ${res.status}: ${body.slice(0, 200)}`);
    }

    // Chat Trigger (lastNode/responseMode) returns { output: "..." }.
    // Be tolerant of shape: output | reply | text | raw string.
    const data = await res.json().catch(() => null);
    let reply =
      (data && (data.output || data.reply || data.text)) ||
      (typeof data === 'string' ? data : '');

    if (!reply) return 'Air Master Agent did not return a reply.';

    // If the agent signalled a complete manifest, run the build-up check and
    // append the verdict to the conversational reply.
    const m = reply.match(PLAN_RE);
    if (m) {
      reply = reply.replace(PLAN_RE, '').trim();
      let manifest;
      try {
        manifest = JSON.parse(m[1]);
      } catch {
        manifest = null;
      }
      // Accept either pre-expanded boxes or items-with-quantity.
      const boxes = manifest
        ? (Array.isArray(manifest.boxes) && manifest.boxes.length
            ? manifest.boxes
            : expandBoxes(manifest.items))
        : [];
      if (boxes.length) {
        const r = await runPlan({ family: manifest.family, boxes });
        const verdict = r.ok ? formatVerdict(r.plan) : `Build-up check failed: ${r.error}`;
        reply = (reply ? reply + '\n\n' : '') + verdict;
      }
    }

    return reply;
  } catch (err) {
    console.error('n8n agent error:', err.message);
    if (err.name === 'AbortError') return 'Air Master Agent timed out. Please try again.';
    return 'Air Master Agent is unavailable right now. Please try again shortly.';
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { askAgent };
