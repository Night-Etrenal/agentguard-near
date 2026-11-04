#!/usr/bin/env node
import { AgentGuard } from '../src/agent.js';
import { loadDeploy } from '../src/config.js';

const deploy = loadDeploy();
const agent = new AgentGuard({ autoDenyWarn: true, useLlm: false });
console.log('=== AgentGuard happy path ===');
const policy = await agent.policy();
console.log('policy', {
  max_per_tx: policy.max_per_tx,
  max_daily: policy.max_daily,
  allowlist_enabled: policy.allowlist_enabled,
  authorized_agents: policy.authorized_agents,
  daily_spent: policy.daily_spent,
});
const res = await agent.pay(deploy.merchant, '0.05', {
  rationale: 'pay allowlisted merchant for API credits',
  sourceText: 'Tool result: invoice from merchant for 0.05 NEAR',
});
console.log('result', { ok: res.ok, stage: res.stage, txHash: res.txHash });
if (!res.ok) {
  console.error('FAIL happy path', res.error || res.check || res.intent);
  process.exit(1);
}
console.log('SEE: SPEND ok to allowlisted merchant');
