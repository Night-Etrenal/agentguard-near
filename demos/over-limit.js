#!/usr/bin/env node
/** Show on-chain max_per_tx enforcement against an allowlisted merchant. */
import { AgentGuard } from '../src/agent.js';
import { loadDeploy, nearToYocto } from '../src/config.js';

const deploy = loadDeploy();
const agent = new AgentGuard({ autoDenyWarn: false });
console.log('=== Over max_per_tx (0.5 NEAR limit, trying 0.6) ===');
try {
  await agent.account.functionCall({
    contractId: deploy.vault,
    methodName: 'spend',
    args: { receiver_id: deploy.merchant, amount: nearToYocto('0.6').toString() },
    gas: 30000000000000n,
    attachedDeposit: 0n,
  });
  console.error('UNEXPECTED success');
  process.exit(1);
} catch (e) {
  console.log('Rejected as expected:', String(e.message || e).slice(0, 400));
  console.log('SEE: vault max_per_tx stopped the spend even for an allowlisted receiver.');
}
