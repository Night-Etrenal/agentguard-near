import { provider } from '../src/near.js';
import { loadDeploy } from '../src/config.js';

const deploy = loadDeploy();
const p = provider();
const policy = await p.callFunction(deploy.vault, 'get_policy', {});
console.log('policy', policy);
if (!policy.allowlist_enabled) throw new Error('allowlist should be on');
if (!(Number(policy.authorized_agents) >= 1)) throw new Error('need >=1 authorized agent');
const blocked = await p.callFunction(deploy.vault, 'is_blocked', { account: deploy.scam });
const allowed = await p.callFunction(deploy.vault, 'is_allowed', { account: deploy.merchant });
const auth = await p.callFunction(deploy.vault, 'is_authorized_agent', { account: deploy.vault });
console.log({ blocked, allowed, auth });
if (!blocked) throw new Error('scam should be blocked');
if (!allowed) throw new Error('merchant should be allowed');
if (!auth) throw new Error('vault account should be authorized agent');
console.log('verify:live ok');
