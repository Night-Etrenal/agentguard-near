/**
 * Natural-language → PolicyVault config compiler.
 *
 * Optional LLM (gpt-6-luna) turns phrases like
 *   "max 0.5 NEAR per tx, 2 NEAR/day, only pay *.near allowlist, block scam.near"
 * into a structured policy. Deterministic regex fallback works without an API key.
 *
 * Env: AGENTGUARD_LLM=1 to enable LLM path (still falls back on failure).
 */
import { spawnSync } from 'child_process';
import { nearToYocto } from './config.js';

const EMPTY = {
  max_per_tx_near: null,
  max_daily_near: null,
  allowlist_enabled: null,
  allowlist_add: [],
  blocklist_add: [],
  pause: null,
};

/**
 * @param {string} text
 * @param {{ useLlm?: boolean }} [opts]
 * @returns {Promise<object>} policy patch (NEAR amounts as decimal strings)
 */
export async function compilePolicy(text, opts = {}) {
  const heuristic = heuristicCompile(text);
  if (!opts.useLlm) {
    return { ...heuristic, engine: 'heuristic', source: text };
  }
  try {
    const llm = await askPolicyLlm(text);
    // Prefer LLM fields when present; fill gaps from heuristic.
    const merged = {
      max_per_tx_near: llm.max_per_tx_near ?? heuristic.max_per_tx_near,
      max_daily_near: llm.max_daily_near ?? heuristic.max_daily_near,
      allowlist_enabled:
        llm.allowlist_enabled !== undefined && llm.allowlist_enabled !== null
          ? llm.allowlist_enabled
          : heuristic.allowlist_enabled,
      allowlist_add: uniq([...(llm.allowlist_add || []), ...heuristic.allowlist_add]),
      blocklist_add: uniq([...(llm.blocklist_add || []), ...heuristic.blocklist_add]),
      pause: llm.pause ?? heuristic.pause,
      engine: 'llm+heuristic',
      source: text,
    };
    validatePatch(merged);
    return merged;
  } catch (e) {
    return {
      ...heuristic,
      engine: 'heuristic',
      source: text,
      llmError: String(e.message || e).slice(0, 200),
    };
  }
}

/** Convert a patch into contract call args (yocto strings). */
export function patchToContractCalls(patch) {
  const calls = [];
  if (patch.max_per_tx_near != null && patch.max_daily_near != null) {
    calls.push({
      methodName: 'set_limits',
      args: {
        max_per_tx: nearToYocto(patch.max_per_tx_near).toString(),
        max_daily: nearToYocto(patch.max_daily_near).toString(),
      },
    });
  }
  if (patch.allowlist_enabled != null) {
    calls.push({
      methodName: 'set_allowlist_enabled',
      args: { enabled: !!patch.allowlist_enabled },
    });
  }
  for (const account of patch.allowlist_add || []) {
    calls.push({ methodName: 'allowlist_add', args: { account } });
  }
  for (const account of patch.blocklist_add || []) {
    calls.push({ methodName: 'blocklist_add', args: { account } });
  }
  if (patch.pause === true) calls.push({ methodName: 'pause', args: {} });
  if (patch.pause === false) calls.push({ methodName: 'unpause', args: {} });
  return calls;
}

function heuristicCompile(text) {
  const out = { ...EMPTY, allowlist_add: [], blocklist_add: [] };
  const t = String(text || '');

  const perTx =
    t.match(/max(?:imum)?\s+(\d+(?:\.\d+)?)\s*NEAR\s*(?:per\s*(?:tx|transaction)|\/\s*tx)/i) ||
    t.match(/(\d+(?:\.\d+)?)\s*NEAR\s*per\s*(?:tx|transaction)/i);
  if (perTx) out.max_per_tx_near = perTx[1];

  const daily =
    t.match(/max(?:imum)?\s+(\d+(?:\.\d+)?)\s*NEAR\s*(?:per\s*day|\/\s*day|daily)/i) ||
    t.match(/(\d+(?:\.\d+)?)\s*NEAR\s*(?:per\s*day|\/\s*day|daily)/i);
  if (daily) out.max_daily_near = daily[1];

  if (/only\s+pay\s+allowlist|allowlist\s+only|only\s+allowlisted/i.test(t)) {
    out.allowlist_enabled = true;
  }
  if (/disable\s+allowlist|allowlist\s+off/i.test(t)) {
    out.allowlist_enabled = false;
  }

  for (const m of t.matchAll(/\ballow\s+([a-z0-9._-]+\.near|[a-z0-9._-]+\.testnet)\b/gi)) {
    out.allowlist_add.push(m[1].toLowerCase());
  }
  for (const m of t.matchAll(/\bblock\s+([a-z0-9._-]+\.near|[a-z0-9._-]+\.testnet)\b/gi)) {
    out.blocklist_add.push(m[1].toLowerCase());
  }

  if (/\bpause\b/i.test(t) && !/\bunpause\b/i.test(t)) out.pause = true;
  if (/\bunpause\b/i.test(t)) out.pause = false;

  return out;
}

function validatePatch(p) {
  if (p.max_per_tx_near != null) nearToYocto(p.max_per_tx_near);
  if (p.max_daily_near != null) nearToYocto(p.max_daily_near);
}

function uniq(arr) {
  return [...new Set(arr.map(String))];
}

async function askPolicyLlm(text) {
  const prompt = `Compile this natural-language NEAR PolicyVault policy into JSON ONLY:
{"max_per_tx_near":string|null,"max_daily_near":string|null,"allowlist_enabled":true|false|null,"allowlist_add":[accountId],"blocklist_add":[accountId],"pause":true|false|null}
Use decimal NEAR strings. Omit unknown fields as null / [].
Policy text: ${JSON.stringify(String(text).slice(0, 1000))}`;

  const r = spawnSync('python3', ['/workspace/shared/llm.py', prompt, 'gpt-6-luna'], {
    encoding: 'utf8',
    timeout: 180000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  if (r.status !== 0) throw new Error((r.stderr || 'llm failed').slice(0, 300));
  const m = (r.stdout || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no json');
  return JSON.parse(m[0]);
}
