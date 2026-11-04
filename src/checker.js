/**
 * Counterparty checker for AI agents that pay on NEAR.
 * Returns { decision: 'allow'|'warn'|'block', score, reasons[], signals{} }.
 *
 * Signals:
 * 1. Shared blocklist — local curated JSON + on-chain is_blocked view
 * 2. Account existence / storage — view_account
 * 3. Is contract? — code_hash != empty
 * 4. Recent code change — vs approved baseline in journal (not auto-updated on warn)
 * 5. Prior interactions — local journal
 * 6. Optional LLM reasoner — escalate only (never clears a warn/block)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadBlocklist, loadDeploy } from './config.js';
import { provider, viewAccount } from './near.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOURNAL = path.join(__dirname, '..', 'data', 'journal.json');

function readJournal() {
  if (!fs.existsSync(JOURNAL)) {
    return { interactions: {}, codeHashes: {}, observedHashes: {} };
  }
  return JSON.parse(fs.readFileSync(JOURNAL, 'utf8'));
}
function writeJournal(j) {
  const tmp = JOURNAL + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(j, null, 2));
  fs.renameSync(tmp, JOURNAL);
}

export async function checkCounterparty(receiverId, opts = {}) {
  const deploy = loadDeploy();
  const blocklist = loadBlocklist();
  const reasons = [];
  const signals = {};
  let score = 0; // higher = riskier; >=80 block, >=40 warn

  // 1a. Shared blocklist
  const entry = blocklist.entries.find(e => e.account === receiverId);
  signals.blocklistHit = !!entry;
  if (entry) {
    score += entry.severity === 'high' ? 100 : 60;
    reasons.push(`blocklist: ${entry.reason}`);
  }

  // 1b. On-chain vault blocklist
  try {
    const p = provider();
    const onchain = await p.callFunction(deploy.vault, 'is_blocked', { account: receiverId });
    signals.onchainBlocked = !!onchain;
    if (onchain) {
      score += 100;
      reasons.push('on-chain vault blocklist');
    }
  } catch (e) {
    signals.onchainBlocked = null;
    score += 5;
    reasons.push('on-chain blocklist lookup failed (unknown)');
  }

  // 2–3. Account view
  const acct = await viewAccount(receiverId);
  signals.exists = !!acct;
  if (!acct) {
    score += 70;
    reasons.push('receiver account does not exist on this network');
  } else {
    const emptyCode = '11111111111111111111111111111111';
    const isContract = acct.code_hash && acct.code_hash !== emptyCode;
    signals.isContract = isContract;
    signals.codeHash = acct.code_hash;
    signals.storageUsage = acct.storage_usage;
    signals.amount = acct.amount;
    if (!isContract && Number(acct.storage_usage) <= 182) {
      score += 10;
      reasons.push('receiver looks like a fresh EOA (minimal storage — heuristic, not age)');
    }
    if (isContract) {
      score += 5;
      reasons.push('receiver is a contract — verify method + upgrade history');
      const journal = readJournal();
      const approved = journal.codeHashes[receiverId];
      const observed = journal.observedHashes?.[receiverId];
      signals.approvedCodeHash = approved || null;
      signals.priorObservedHash = observed || null;
      if (approved && approved !== acct.code_hash) {
        // Code-change is always at least a warn, independent of prior-payment discounts.
        score = Math.max(score + 40, 40);
        reasons.push('contract code_hash changed since approved baseline');
      }
      // Record observation only — do NOT promote to approved baseline here.
      journal.observedHashes = journal.observedHashes || {};
      journal.observedHashes[receiverId] = acct.code_hash;
      writeJournal(journal);
    }
  }

  // 5. Prior interactions
  const journal = readJournal();
  const prior = journal.interactions[receiverId] || { count: 0, totalYocto: '0' };
  signals.priorInteractions = prior.count;
  if (prior.count === 0) {
    score += 15;
    reasons.push('no prior successful spends to this receiver from this agent');
  } else {
    score -= 10;
    reasons.push(`prior spends: ${prior.count}`);
  }

  // Floor: a detected code change must remain >= warn even after discounts.
  if (signals.approvedCodeHash && signals.codeHash && signals.approvedCodeHash !== signals.codeHash) {
    score = Math.max(score, 40);
  }

  // Optional LLM — escalate only
  if (opts.useLlm && score >= 40 && score < 80) {
    try {
      const { askLlm } = await import('./llm_bridge.js');
      const verdict = await askLlm(receiverId, { score, reasons, signals });
      signals.llm = verdict;
      if (verdict?.decision === 'block') {
        score = Math.max(score, 80);
        reasons.push(`llm: ${verdict.reason || 'block'}`);
      } else if (verdict?.decision === 'warn') {
        score = Math.max(score, 40);
        reasons.push(`llm: ${verdict.reason || 'warn'}`);
      } else if (verdict?.decision === 'allow') {
        // Explicitly ignore downgrades.
        reasons.push('llm suggested allow (ignored — escalate-only)');
      }
    } catch (e) {
      signals.llmError = String(e.message || e);
    }
  }

  let decision = 'allow';
  if (score >= 80) decision = 'block';
  else if (score >= 40) decision = 'warn';

  return { decision, score, reasons, signals, receiverId };
}

/** Call after a confirmed on-chain success to approve the observed code hash baseline. */
export function approveCodeHash(receiverId, codeHash) {
  if (!receiverId || !codeHash) return;
  const journal = readJournal();
  journal.codeHashes[receiverId] = codeHash;
  writeJournal(journal);
}

export function recordSpend(receiverId, amountYocto, txHash = null) {
  const journal = readJournal();
  const cur = journal.interactions[receiverId] || { count: 0, totalYocto: '0', txs: [] };
  cur.count += 1;
  cur.totalYocto = (BigInt(cur.totalYocto) + BigInt(amountYocto)).toString();
  if (txHash) {
    cur.txs = cur.txs || [];
    cur.txs.push(txHash);
    if (cur.txs.length > 20) cur.txs = cur.txs.slice(-20);
  }
  journal.interactions[receiverId] = cur;
  writeJournal(journal);
}
