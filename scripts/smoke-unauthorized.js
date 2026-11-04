#!/usr/bin/env node
/** Prove an unrelated account cannot spend even to an allowlisted merchant. */
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { KeyPair } from '@near-js/crypto';
import { loadCred, loadDeploy, nearToYocto } from '../src/config.js';

const deploy = loadDeploy();
const merchantCred = loadCred('nightscoutpay808620.json'); // unrelated to vault agents
const provider = new JsonRpcProvider({ url: deploy.rpc });
const signer = new KeyPairSigner(KeyPair.fromString(merchantCred.private_key));
const acct = new Account(merchantCred.account_id, provider, signer);
try {
  await acct.functionCall({
    contractId: deploy.vault,
    methodName: 'spend',
    args: { receiver_id: deploy.merchant, amount: nearToYocto('0.01').toString() },
    gas: 50000000000000n,
    attachedDeposit: 0n,
  });
  console.error('FAIL: unauthorized spend succeeded');
  process.exit(1);
} catch (e) {
  const msg = String(e.message || e);
  console.log('unauthorized spend rejected:', msg.slice(0, 240));
  if (!/Unauthorized agent/i.test(msg)) {
    console.warn('WARN: expected Unauthorized agent panic');
  } else {
    console.log('smoke-unauthorized ok');
  }
}
