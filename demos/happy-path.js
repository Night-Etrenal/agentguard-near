#!/usr/bin/env node
/**
 * Happy path: agent pays an allowlisted merchant.
 * Do: run this script. See: counterparty ALLOW (or mild warn cleared by allowlist
 * path + successful on-chain spend) and a spend_ok log with tx hash.
 */
import { AgentGuard } from '../src/agent.js';
import { loadDeploy } from '../src/config.js';

const deploy = loadDeploy();
const agent = new AgentGuard({ autoDenyWarn: false }); // merchant may be "fresh" → warn; we approve for demo
console.log('=== AgentGuard happy path ===');
console.log('vault:', deploy.vault);
console.log('policy:', await agent.policy());

const res = await agent.pay(deploy.merchant, '0.05');
console.log('\nRESULT:', JSON.stringify({ ok: res.ok, stage: res.stage, decision: res.check?.decision }, null, 2));
if (!res.ok) process.exit(1);
console.log('SEE: spend succeeded to allowlisted merchant under max_per_tx.');
