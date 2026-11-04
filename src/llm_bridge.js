/**
 * Optional reasoning via shared /workspace/shared/llm.py (gpt-6-luna at runtime).
 * Falls back silently if unavailable — checker still works without it.
 */
import { spawnSync } from 'child_process';

export async function askLlm(receiverId, ctx) {
  const prompt = `You are a NEAR payment-risk reviewer for an AI agent wallet.
Receiver: ${receiverId}
Score so far: ${ctx.score}
Reasons: ${ctx.reasons.join('; ')}
Signals: ${JSON.stringify(ctx.signals)}
Reply with ONLY JSON: {"decision":"allow"|"warn"|"block","reason":"..."} 
Default to warn if unsure. Prefer block for phishing/sink patterns.`;

  const r = spawnSync('python3', ['/workspace/shared/llm.py', prompt, 'gpt-6-luna'], {
    encoding: 'utf8',
    timeout: 180000,
    env: process.env,
  });
  if (r.status !== 0) throw new Error(r.stderr || 'llm failed');
  const text = (r.stdout || '').trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no json in llm output');
  return JSON.parse(m[0]);
}
