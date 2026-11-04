/**
 * AgentGuard wallet wrapper.
 * - Signs ONLY with a function-call access key scoped to PolicyVault.spend
 * - Refuses to sign when counterparty checker returns block
 * - Asks a human (or --auto-deny-warn) when decision is warn
 * - Protocol-enforced: FC key cannot Transfer / AddKey / DeleteAccount
 */
import { checkCounterparty, recordSpend } from './checker.js';
import { accountFromCred, viewPolicy } from './near.js';
import { loadDeploy, nearToYocto } from './config.js';

export class AgentGuard {
  constructor({ credName = 'agent_fc.json', autoDenyWarn = true, useLlm = false } = {}) {
    this.credName = credName;
    this.autoDenyWarn = autoDenyWarn;
    this.useLlm = useLlm;
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

  async pay(receiverId, amountNear, { force = false } = {}) {
    const amount = nearToYocto(amountNear).toString();
    this._emit('pay_requested', { receiverId, amountNear, amount });

    const check = await checkCounterparty(receiverId, { useLlm: this.useLlm });
    this._emit('counterparty_check', check);

    if (check.decision === 'block') {
      this._emit('refused_block', { receiverId, reasons: check.reasons });
      return { ok: false, stage: 'checker', check };
    }
    if (check.decision === 'warn') {
      this._emit('human_required', { receiverId, reasons: check.reasons, autoDenyWarn: this.autoDenyWarn });
      if (this.autoDenyWarn && !force) {
        this._emit('refused_warn', { receiverId });
        return { ok: false, stage: 'human', check };
      }
    }

    // Attempt spend via FC key. Even if checker is bypassed, vault + key enforce policy.
    try {
      const result = await this.account.functionCall({
        contractId: this.deploy.vault,
        methodName: 'spend',
        args: { receiver_id: receiverId, amount },
        gas: 30000000000000n,
        attachedDeposit: 0n,
      });
      recordSpend(receiverId, amount);
      this._emit('spend_ok', {
        receiverId,
        amountNear,
        txHash: result?.transaction_outcome?.id || result?.transaction?.hash || null,
      });
      return { ok: true, stage: 'chain', check, result };
    } catch (e) {
      const msg = e?.message || String(e);
      this._emit('spend_rejected_onchain', { receiverId, error: msg.slice(0, 400) });
      return { ok: false, stage: 'chain', check, error: msg };
    }
  }

  /** Demonstrate that the agent FC key cannot Transfer NEAR directly. */
  async tryRawTransfer(receiverId, amountNear) {
    const amount = nearToYocto(amountNear);
    this._emit('raw_transfer_attempt', { receiverId, amountNear });
    try {
      const { actionCreators } = await import('@near-js/transactions');
      // Protocol must reject: FunctionCall keys cannot include Transfer actions.
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
