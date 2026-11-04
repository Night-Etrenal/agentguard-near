#!/usr/bin/env node
/**
 * Redeploy PolicyVault WASM to testnet vault, re-init policy, authorize agent,
 * restore allow/block lists. Uses owner full-access key from secrets (never logged).
 */
import fs from 'fs';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { KeyPair } from '@near-js/crypto';
import { actionCreators } from '@near-js/transactions';
import { loadCred, loadDeploy, nearToYocto } from '../src/config.js';

const deploy = loadDeploy();
const ownerCred = loadCred('owner.testnet.json');
const wasm = fs.readFileSync(new URL('../artifacts/policy_vault.wasm', import.meta.url));

const provider = new JsonRpcProvider({ url: deploy.rpc });
const keyPair = KeyPair.fromString(ownerCred.private_key);
const signer = new KeyPairSigner(keyPair);
const account = new Account(ownerCred.account_id, provider, signer);

const maxPerTx = nearToYocto(deploy.max_per_tx_near || '0.5').toString();
const maxDaily = nearToYocto(deploy.max_daily_near || '2').toString();

console.log('Redeploying to', deploy.vault, 'wasm bytes', wasm.length);

// Deploy + init in one tx when possible: deployContract + functionCall new
const deployResult = await account.signAndSendTransaction({
  receiverId: deploy.vault,
  actions: [
    actionCreators.deployContract(new Uint8Array(wasm)),
    actionCreators.functionCall(
      'new',
      {
        owner: deploy.owner,
        max_per_tx: maxPerTx,
        max_daily: maxDaily,
      },
      30000000000000n,
      0n,
    ),
  ],
});
const deployTx =
  deployResult?.transaction_outcome?.id || deployResult?.transaction?.hash || null;
console.log('deploy+init tx', deployTx);

async function call(method, args = {}) {
  const r = await account.functionCall({
    contractId: deploy.vault,
    methodName: method,
    args,
    gas: 30000000000000n,
    attachedDeposit: 0n,
  });
  const id = r?.transaction_outcome?.id || r?.transaction?.hash;
  console.log(method, id);
  return r;
}

await call('agent_add', { account: deploy.vault }); // FC key predecessor = vault account
await call('set_allowlist_enabled', { enabled: true });
await call('allowlist_add', { account: deploy.merchant });
await call('blocklist_add', { account: deploy.scam });

const policy = await provider.callFunction(deploy.vault, 'get_policy', {});
const auth = await provider.callFunction(deploy.vault, 'is_authorized_agent', {
  account: deploy.vault,
});
console.log('policy', JSON.stringify(policy, null, 2));
console.log('authorized vault as agent?', auth);

// Persist deploy meta
const meta = {
  ...deploy,
  redeploy_tx: deployTx,
  redeployed_at: new Date().toISOString(),
  wasm_bytes: wasm.length,
};
fs.writeFileSync(
  new URL('../deployments/testnet.json', import.meta.url),
  JSON.stringify(meta, null, 2) + '\n',
);
console.log('redeploy complete');
