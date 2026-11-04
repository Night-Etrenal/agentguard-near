import { checkCounterparty } from '../src/checker.js';
import { loadDeploy } from '../src/config.js';
import assert from 'assert';

const deploy = loadDeploy();

const scam = await checkCounterparty(deploy.scam);
assert.equal(scam.decision, 'block', 'scam must be blocked');
console.log('ok scam blocked', scam.score);

const merchant = await checkCounterparty(deploy.merchant);
assert.notEqual(merchant.decision, 'block', 'merchant must not be blocked');
console.log('ok merchant', merchant.decision, merchant.score);

const missing = await checkCounterparty('this-account-should-not-exist-zz.testnet');
assert.ok(missing.score >= 40, 'missing account should be warn/block');
console.log('ok missing', missing.decision, missing.score);

console.log('checker tests passed');
