/**
 * Counterparty checker for AI agents that pay on NEAR.
 * Returns { decision: 'allow'|'warn'|'block', score, reasons[], signals{} }.
 *
 * Signals (and how we get them):
 * 1. Shared blocklist — local curated JSON + on-chain is_blocked view
 * 2. Account existence / age proxy — view_account; storage_usage + code_hash
 * 3. Is contract? — code_hash != "1111...1111" empty hash
 * 4. Recent code change — best-effort: if contract and not previously seen hash (local journal)
 * 5. Prior interactions — local journal of agent→receiver spends
 * 6. Optional LLM reasoner (gpt-6-luna) for ambiguous WARN cases
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadBlocklist, loadDeploy } from './config.js';
import { provider, viewAccount } from './near.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOURNAL = path.join(__dirname, '..', 'data', 'journal.json');

function readJournal() {
  if (!fs.existsSync(JOURNAL)) return { interactions: {}, codeHashes: {} };
  return JSON.parse(fs.readFileSync(JOURNAL, 'utf8'));
}
function writeJournal(j) {
  fs.writeFileSync(JOURNAL, JSON.stringify(j, null, 2));
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
    // Brand-new empty EOAs with tiny storage are slightly riskier for first payment
    if (!isContract && Number(acct.storage_usage) <= 182) {
      score += 10;
      reasons.push('receiver looks like a fresh EOA (minimal storage)');
    }
    if (isContract) {
      score += 5;
      reasons.push('receiver is a contract — verify method + upgrade history');
      const journal = readJournal();
      const prev = journal.codeHashes[receiverId];
      signals.priorCodeHash = prev || null;
      if (prev && prev !== acct.code_hash) {
        score += 40;
        reasons.push('contract code_hash changed since last observation');
      }
      journal.codeHashes[receiverId] = acct.code_hash;
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

  // Optional LLM escalation for mid scores
  if (opts.useLlm && score >= 40 && score < 80) {
    try {
      const { askLlm } = await import('./llm_bridge.js');
      const verdict = await askLlm(receiverId, { score, reasons, signals });
      signals.llm = verdict;
      if (verdict?.decision === 'block') {
        score = Math.max(score, 80);
        reasons.push(`llm: ${verdict.reason || 'block'}`);
      } else if (verdict?.decision === 'allow') {
        score = Math.min(score, 39);
        reasons.push(`llm: ${verdict.reason || 'allow'}`);
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

export function recordSpend(receiverId, amountYocto) {
  const journal = readJournal();
  const cur = journal.interactions[receiverId] || { count: 0, totalYocto: '0' };
  cur.count += 1;
  cur.totalYocto = (BigInt(cur.totalYocto) + BigInt(amountYocto)).toString();
  journal.interactions[receiverId] = cur;
  writeJournal(journal);
}
