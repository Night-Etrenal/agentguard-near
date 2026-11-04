#!/usr/bin/env node
/** Read-only live verification — no private keys required. */
import { JsonRpcProvider } from '@near-js/providers';
import { loadDeploy } from '../src/config.js';

const d = loadDeploy();
const p = new JsonRpcProvider({ url: d.rpc });
const policy = await p.callFunction(d.vault, 'get_policy', {});
const blocked = await p.callFunction(d.vault, 'is_blocked', { account: d.scam });
const allowed = await p.callFunction(d.vault, 'is_allowed', { account: d.merchant });
const acct = await p.query({ request_type: 'view_account', account_id: d.vault, finality: 'final' });

console.log('vault:', d.vault);
console.log('policy:', policy);
console.log('scam blocked on-chain:', blocked);
console.log('merchant allowed on-chain:', allowed);
console.log('code_hash:', acct.code_hash);
console.log('explorer:', d.explorer_account);

if (!blocked) throw new Error('scam should be blocked');
if (!allowed) throw new Error('merchant should be allowed');
if (!policy.allowlist_enabled) throw new Error('allowlist should be on');
if (acct.code_hash === '11111111111111111111111111111111') throw new Error('contract missing');
console.log('LIVE VERIFY OK');
