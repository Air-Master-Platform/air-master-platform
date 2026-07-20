'use strict';
/*
 * CargoFlow engine runner.
 *
 * Spawns the Python build-up/balance/re-validate engine for one manifest and
 * resolves with the parsed plan JSON. Shared by the /api/loadplan route and the
 * Sky Vision Agent (agent.js), so both run the exact same engine.
 */

const path = require('path');
const { spawn } = require('child_process');

const ENGINE_SCRIPT = path.join(__dirname, 'engine', 'plan_api.py');
const PYTHON_BIN =
  process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const ENGINE_TIMEOUT_MS = 30000;

// Run the engine. Resolves { ok, plan } on a parsed plan, or { ok:false, error }.
function runPlan({ family, boxes }) {
  return new Promise((resolve) => {
    if (!Array.isArray(boxes) || boxes.length === 0) {
      return resolve({ ok: false, error: 'Provide a non-empty "boxes" array.' });
    }
    const payload = JSON.stringify({ family: family || 'PMC', boxes });

    let child;
    try {
      child = spawn(PYTHON_BIN, [ENGINE_SCRIPT], { cwd: __dirname });
    } catch (e) {
      return resolve({ ok: false, error: 'Could not start engine: ' + e.message });
    }

    let out = '', errOut = '', done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: 'Engine timed out.' });
    }, ENGINE_TIMEOUT_MS);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (errOut += d));
    child.on('error', (e) => finish({ ok: false, error: 'Engine spawn failed: ' + e.message }));
    child.on('close', (code) => {
      try {
        finish({ ok: true, plan: JSON.parse(out) });
      } catch (e) {
        console.error('engine output parse error:', errOut.slice(0, 400));
        finish({
          ok: false,
          error: 'Engine returned no valid plan (exit ' + code + ').',
          stderr: errOut.slice(0, 400),
        });
      }
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}

module.exports = { runPlan, ENGINE_TIMEOUT_MS };
