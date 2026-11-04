#!/usr/bin/env node
import { AgentGuard } from '../src/agent.js';
import { loadDeploy } from '../src/config.js';

const deploy = loadDeploy();
const agent = new AgentGuard({ autoDenyWarn: true, useLlm: false });
console.log('=== AgentGuard over-limit demo ===');
const res = await agent.pay(deploy.merchant, '0.6', {
  rationale: 'pay merchant',
  sourceText: 'normal invoice 0.6 NEAR',
});
console.log('result', { ok: res.ok, stage: res.stage, error: (res.error || '').slice(0, 200) });
if (res.ok) {
  console.error('FAIL: over-limit spend should not succeed');
  process.exit(1);
}
if (res.stage === 'chain' && !/max_per_tx|Exceeds/i.test(res.error || '')) {
  console.warn('WARN: expected Exceeds max_per_tx, got', (res.error || '').slice(0, 120));
}
console.log('SEE: spend rejected (over max_per_tx 0.5)');
