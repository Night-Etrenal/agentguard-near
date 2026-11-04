import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { KeyPair } from '@near-js/crypto';
import { loadCred, loadDeploy } from './config.js';

export function provider() {
  const d = loadDeploy();
  return new JsonRpcProvider({ url: d.rpc });
}

export function accountFromCred(credName) {
  const cred = loadCred(credName);
  const keyPair = KeyPair.fromString(cred.private_key);
  const signer = new KeyPairSigner(keyPair);
  return new Account(cred.account_id, provider(), signer);
}

export async function viewPolicy(vaultId) {
  const p = provider();
  return p.callFunction(vaultId, 'get_policy', {});
}

export async function viewAccount(accountId) {
  const p = provider();
  try {
    return await p.query({ request_type: 'view_account', account_id: accountId, finality: 'final' });
  } catch (e) {
    return null;
  }
}
