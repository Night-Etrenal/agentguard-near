/**
 * AgentGuard wallet wrapper.
 * - Signs ONLY with a function-call access key scoped to PolicyVault.spend
 * - Refuses to sign when counterparty checker OR intent firewall returns block
 * - Warns fail closed by default (autoDenyWarn=true); no force-bypass of warn
 * - Protocol-enforced: FC key cannot Transfer / AddKey / DeleteAccount
 */
import { checkCounterparty, recordSpend, approveCodeHash } from './checker.js';
import { classifyIntent } from './intent_firewall.js';
import { accountFromCred, viewPolicy } from './near.js';
import { loadDeploy, nearToYocto } from './config.js';

export class AgentGuard {
  constructor({
    credName = 'agent_fc.json',
    autoDenyWarn = true,
    useLlm = false,
  } = {}) {
    this.credName = credName;
    this.autoDenyWarn = autoDenyWarn;
    this.useLlm = useLlm || process.env.AGENTGUARD_LLM === '1';
    this.deploy = loadDeploy();
    this.account = accountFromCred(credName);
    this.log = [];
  }

  _emit(event, detail) {
    const row = { ts: new Date().toISOString(), event, ...detail };
    this.log.push(row);
    console.log(`[AgentGuard] ${event}`, JSON.stringify(detail));
    return row;
  }

  async policy() {
    return viewPolicy(this.deploy.vault);
  }

  /**
   * @param {string} receiverId
   * @param {string|number} amountNear
   * @param {object} [opts]
   * @param {string} [opts.rationale]
   * @param {string} [opts.sourceText]  untrusted prompt / tool text that asked for this pay
   * @param {boolean} [opts.humanApproved]  explicit out-of-band approval for warn
   */
  async pay(receiverId, amountNear, opts = {}) {
    const { rationale = '', sourceText = '', humanApproved = false } = opts;
    const amount = nearToYocto(amountNear).toString();
    this._emit('pay_requested', { receiverId, amountNear, amount, rationale: rationale.slice(0, 120) });

    // Intent firewall first (may use LLM; heuristic fallback without key)
    const intent = await classifyIntent(
      { receiverId, amountNear, rationale, sourceText },
      { useLlm: this.useLlm },
    );
    this._emit('intent_firewall', {
      decision: intent.decision,
      reason: intent.reason,
      engine: intent.engine,
    });
    if (intent.decision === 'block') {
      this._emit('refused_intent', { receiverId, reasons: intent.reasons });
      return { ok: false, stage: 'intent', intent };
    }

    const check = await checkCounterparty(receiverId, { useLlm: this.useLlm });
    this._emit('counterparty_check', check);

    // Combine: intent warn escalates checker allow → warn
    let decision = check.decision;
    if (intent.decision === 'warn' && decision === 'allow') decision = 'warn';

    if (decision === 'block' || check.decision === 'block') {
      this._emit('refused_block', { receiverId, reasons: check.reasons });
      return { ok: false, stage: 'checker', check, intent };
    }
    if (decision === 'warn') {
      this._emit('human_required', {
        receiverId,
        reasons: [...(check.reasons || []), ...(intent.reasons || [])],
        autoDenyWarn: this.autoDenyWarn,
        humanApproved,
      });
      if (this.autoDenyWarn && !humanApproved) {
        this._emit('refused_warn', { receiverId });
        return { ok: false, stage: 'human', check, intent };
      }
      if (!this.autoDenyWarn && !humanApproved) {
        // Fail closed: even if autoDenyWarn is false, require explicit humanApproved.
        this._emit('refused_warn_no_approval', { receiverId });
        return { ok: false, stage: 'human', check, intent };
      }
    }

    try {
      const result = await this.account.functionCall({
        contractId: this.deploy.vault,
        methodName: 'spend',
        args: { receiver_id: receiverId, amount },
        gas: 50000000000000n, // headroom for transfer + callback
        attachedDeposit: 0n,
      });
      const txHash =
        result?.transaction_outcome?.id || result?.transaction?.hash || null;
      this._emit('spend_ok', { receiverId, amountNear, txHash });

      // Bookkeeping is best-effort and must NOT flip ok→false after chain success.
      let bookkeepingError = null;
      try {
        recordSpend(receiverId, amount, txHash);
        if (check.signals?.codeHash) {
          approveCodeHash(receiverId, check.signals.codeHash);
        }
      } catch (be) {
        bookkeepingError = String(be.message || be).slice(0, 200);
        this._emit('bookkeeping_warning', { error: bookkeepingError });
      }
      return { ok: true, stage: 'chain', check, intent, result, txHash, bookkeepingError };
    } catch (e) {
      const msg = e?.message || String(e);
      this._emit('spend_rejected_onchain', { receiverId, error: msg.slice(0, 400) });
      return { ok: false, stage: 'chain', check, intent, error: msg };
    }
  }

  /** Demonstrate that the agent FC key cannot Transfer NEAR directly. */
  async tryRawTransfer(receiverId, amountNear) {
    const amount = nearToYocto(amountNear);
    this._emit('raw_transfer_attempt', { receiverId, amountNear });
    try {
      const { actionCreators } = await import('@near-js/transactions');
      await this.account.signAndSendTransaction({
        receiverId,
        actions: [actionCreators.transfer(amount)],
      });
      this._emit('raw_transfer_UNEXPECTED_SUCCESS', { receiverId });
      return { ok: true };
    } catch (e) {
      const msg = String(e?.message || e);
      this._emit('raw_transfer_blocked_by_protocol', { error: msg.slice(0, 500) });
      return { ok: false, error: msg };
    }
  }
}
