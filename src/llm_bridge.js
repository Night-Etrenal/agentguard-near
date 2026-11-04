/**
 * Optional reasoning via shared /workspace/shared/llm.py (gpt-6-luna).
 * Falls back silently if unavailable — checker still works without it.
 * Model output may escalate risk but callers must not let it downgrade a block.
 */
import { spawnSync } from 'child_process';

export async function askLlm(receiverId, ctx) {
  const prompt = `You are a NEAR payment-risk reviewer for an AI agent wallet.
Receiver: ${JSON.stringify(receiverId)}
Score so far: ${ctx.score}
Reasons: ${JSON.stringify(ctx.reasons)}
Signals: ${JSON.stringify(ctx.signals)}
Reply with ONLY JSON: {"decision":"allow"|"warn"|"block","reason":"..."}
Default to warn if unsure. Prefer block for phishing/sink patterns.
You may escalate risk; do not invent an allow for known-bad patterns.`;

  const r = spawnSync('python3', ['/workspace/shared/llm.py', prompt, 'gpt-6-luna'], {
    encoding: 'utf8',
    timeout: 180000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  if (r.status !== 0) throw new Error(r.stderr || 'llm failed');
  const text = (r.stdout || '').trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no json in llm output');
  const parsed = JSON.parse(m[0]);
  if (!['allow', 'warn', 'block'].includes(parsed.decision)) {
    throw new Error('invalid llm decision');
  }
  return { decision: parsed.decision, reason: String(parsed.reason || '').slice(0, 240) };
}
