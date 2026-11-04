## Critical

### C1 — `spend` is public: anyone can spend the vault’s funds

**Location:** `contracts/policy_vault/src/lib.rs` — `PolicyVault::spend`

There is no caller authorization. A function-call key restricts transactions **signed by that key**; it does not restrict other accounts from calling the same contract method.

An attacker needs no agent credential:

```text
attacker → vault.spend(receiver_id = attacker, amount = permitted_amount)
```

With the default `allowlist_enabled = false`, this transfers vault funds to the attacker, subject only to the transaction limit, daily limit, blocklist, and available balance. The attacker can repeat each day until the liquid treasury is exhausted.

Enabling the allowlist restricts destinations but still does not authorize callers. Outsiders can trigger payments to allowed destinations and consume the shared daily budget.

`agent_spent` does not prevent this: it records a lifetime aggregate and is never checked.

**Required fix:** Explicitly authorize spending accounts on-chain. Provisioning an FC key is not an on-chain ACL.

## High

### H1 — Uninitialized deployments can be taken over

**Location:** `lib.rs` — `new`

`#[init]` prevents initialization once state exists, but does not authorize the first caller.

If deployment and initialization are separate transactions, an attacker can initialize first with:

- themselves as `owner`;
- permissive limits;
- the default disabled allowlist.

They can then use owner withdrawals, change policy, or disrupt the intended deployment.

**Condition:** This is exploitable only if an uninitialized deployed contract is exposed. An atomic deploy-and-initialize flow avoids that exposure; no deployment code was supplied to verify this.

### H2 — The advertised human approval gate does not exist

**Location:** `src/agent.js` — `AgentGuard.pay`

For a `warn` decision:

```js
if (this.autoDenyWarn && !force) {
  return ...;
}
```

There is no human interaction or authenticated approval:

- `autoDenyWarn: false` automatically sends warned payments.
- `force: true` automatically sends warned payments.
- An agent permitted to select `force` can approve its own exception.

**Exploit:** A warned recipient is absent from the contract blocklist and permitted by the on-chain policy. A compromised agent calls:

```js
agent.pay(receiver, amount, { force: true })
```

The wrapper signs without human approval.

`force` **does not bypass a checker `block`**. However, the signing account is exposed as `agent.account`, and a holder of the FC private key can call `spend` directly, bypassing the entire checker. Consequently, local-only blocklists and human-approval requirements are not enforceable against an agent that possesses the signing key.

## Medium

### M1 — Failed transfers permanently consume the current day’s budget

**Location:** `lib.rs` — `spend`

The contract increments `daily_spent` and `agent_spent` before returning a transfer promise. There is no result callback.

If the transfer fails—for example, to a nonexistent ordinary named account—the transfer amount is refunded by the protocol, but the earlier contract state changes are not automatically reversed.

**Exploit:** With the allowlist disabled, an attacker calls `spend` toward nonexistent named accounts, using amounts that fill the daily limit. No recipient receives the money, but legitimate spending is denied for the remainder of the bucket. Refund delivery also introduces temporary balance unavailability.

This remains relevant after adding caller authorization: a compromised authorized agent can perform the same griefing.

The `SPEND ok` log is also premature: it records scheduling, not successful payment.

**Fix:** Reserve the budget before dispatch and settle it in a private callback. Failed transfers should release their reservation. Associate reservations with their original day so a late callback cannot modify the wrong day’s budget.

### M2 — The reserve ignores storage backing; public accounting permits storage griefing

**Location:** `lib.rs` — `spend`, `withdraw`, `agent_spent`

The balance check uses:

```rust
bal >= amount + 0.05 NEAR
```

`env::account_balance()` is not equivalent to freely spendable balance. It includes funds needed to back account storage. A fixed 0.05 NEAR does not account for contract code, collection data, access keys, or subsequent growth.

The immediately exploitable storage-growth path is **`agent_spent`, not the owner-controlled sets**:

1. An attacker calls `spend` from many different predecessor accounts.
2. Each first call creates a permanent `LookupMap` entry.
3. The amount can be one yoctoNEAR, so almost no daily budget is consumed.
4. Vault funds become storage backing, reducing usable treasury liquidity.

Even with an allowlist enabled, attackers can direct those tiny transfers to an allowed account. There is no entry cleanup or caller-funded storage registration.

At the current standard storage price of \(10^{19}\) yoctoNEAR/byte, 0.05 NEAR backs only about 5 KB.

**Important limitation:** NEAR enforces storage backing. This does not let an attacker commit an undercollateralized account; operations can instead fail and roll back. Similarly, `withdraw` cannot reliably withdraw storage-backed funds merely because its raw-balance check passes.

`agent_spent` provides no corresponding enforcement benefit: it is neither a per-agent limit nor a daily counter. Multiple keys on one signing account also share the same predecessor identity.

### M3 — Checking a code change silently approves its baseline; scoring often suppresses the warning

**Location:** `src/checker.js` — `checkCounterparty`

The checker persists the newly observed code hash immediately:

```js
journal.codeHashes[receiverId] = acct.code_hash;
writeJournal(journal);
```

This happens before payment approval and even if the payment is subsequently refused.

**Bypass sequence:**

1. A known contract changes code.
2. A check detects the change and returns `warn`.
3. The wrapper refuses payment.
4. A second check sees the new hash as the baseline and drops the change signal.

There is also a deterministic scoring problem for previously paid contracts:

```text
contract:        +5
code changed:  +40
prior payment: -10
------------------
total:          35 → allow
```

Thus a previously paid contract’s code change usually does not trigger a warning at all.

The journal has additional integrity weaknesses:

- It is shared across agents, vaults, and networks rather than namespaced.
- Multiple processes can lose updates or expose partially written JSON because read/modify/write is neither locked nor atomic.
- Checks and payments are separate operations; observed receiver state is not pinned to execution.

These do **not** bypass the contract’s global daily limit. They weaken reputation decisions and can cause availability failures.

Also, this payment path performs a native transfer, not a receiver function call: changed receiver code is not automatically executed by the payment.

### M4 — A completed payment can be reported as an on-chain rejection

**Location:** `src/agent.js` — `pay`, after `account.functionCall`

The same `try/catch` covers both payment execution and local bookkeeping:

```js
const result = await this.account.functionCall(...);
recordSpend(receiverId, amount);
```

If the transfer succeeds but `recordSpend` fails—for example, because the journal is read-only or the filesystem fills—the catch emits `spend_rejected_onchain` and returns `ok: false`.

**Exploit/failure scenario:** An automation system retries “failed” payments. Each retry sends another real payment, up to the contract limits.

This is a concrete local failure misclassification, separate from the usual ambiguity of a network timeout after transaction submission.

### M5 — The LLM may erase deterministic warnings

**Location:** `src/checker.js` — LLM escalation; `src/llm_bridge.js` — `askLlm`

For scores from 40 through 79, any parsed response with:

```json
{"decision":"allow"}
```

reduces the score below the warning threshold. No human approval is then required.

The prompt interpolates the receiver and textual reasons into instructions, and the response is extracted using a greedy JSON regex without a strict response schema. A misleading or prompt-influenced model response therefore has authority to remove deterministic warnings.

**Scope of this finding:**

- It can downgrade warnings, including code-change and medium-severity reputation signals.
- It cannot directly override an already computed score of at least 80; those cases never reach the LLM.
- It cannot override an actual contract blocklist entry during execution.
- The supplied source does **not** fetch arbitrary receiver webpages or contract metadata into the prompt. Receiver-controlled text is mostly limited to the account name; curated blocklist reasons are another input only if their provenance is untrusted.
- `JSON.parse` is not code execution, and `spawnSync` uses an argument array without a shell. There is no demonstrated shell-injection vulnerability here.

For a security gate, model output should escalate risk or provide explanations, not remove mandatory approval requirements.

### M6 — Negative decimal amounts can become positive payments

**Location:** `src/config.js` — `nearToYocto`

The integer and fractional components are parsed separately and added:

```js
BigInt(i) * YOCTO + BigInt(frac)
```

For example:

```js
nearToYocto('-0.2') === 200000000000000000000000n
```

`BigInt('-0')` is zero, so a negative input becomes a positive 0.2 NEAR payment.

Other malformed inputs are also accepted:

```text
"1.2.3" → parsed as "1.2"
```

More than 24 fractional digits are silently truncated.

The contract’s caps still apply, but the wrapper can send a payment that the caller supplied as negative or malformed.

### M7 — A spend-only key can exhaust gas funds outside all spending limits

**Location:** Protocol/key provisioning; `src/near.js` — `accountFromCred`

A compromised FC key can repeatedly submit permitted calls that fail inside `spend`, including calls rejected because the vault is paused or the amount is invalid. Accepted transactions still consume gas, without increasing `daily_spent`.

The account that issued the access key pays those transaction fees:

- **Key installed on the vault:** gas exhaustion can consume the vault’s liquid operating balance, outside the spending caps.
- **Key installed on a separate agent account:** that agent account’s gas balance is exposed instead.

A finite key allowance limits gas exposure, but no provisioning configuration was supplied to establish one. An unlimited or excessive allowance defeats the intended operational bound.

An FC-key allowance is **not a cap on transfers created by the contract**. A small gas allowance can authorize much larger outgoing transfers through `spend`.

## Low / nit

### L1 — Credential names and key scope are trusted without validation

**Locations:** `src/config.js` — `loadCred`; `src/near.js` — `accountFromCred`

`credName` permits `../` traversal outside the intended credential directory. The loader also never verifies that the resulting key is actually restricted to the expected vault and exactly `spend`.

If a caller can select another readable credential, including a full-access credential, the wrapper silently uses it. `agent_fc.json` is only a filename, not proof of permission.

This is **not** an escalation when the environment genuinely exposes only the intended FC credential. Likewise, storing secrets outside the repository does not isolate them from another process running under the same OS identity.

The bridge inherits the entire environment. No NEAR private key is explicitly placed in its prompt, but the Python helper is part of the trusted computing base and should not receive unrelated secrets.

### L2 — Policy views can report yesterday’s consumption

**Location:** `lib.rs` — `get_policy`

`daily_spent` is reset only during a successful spending execution. After midnight, `get_policy` can therefore return the previous day’s count indefinitely. It does not return `day_bucket`, so clients cannot identify that the value is stale.

### L3 — Tests and demo do not establish the claimed security boundaries

**Locations:** `tests/checker.test.js`, contract tests, `demos/attack-injection.js`

The contract tests cover only three rejection cases, not caller authorization, settlement failure, storage backing, or rollover behavior.

The demo treats arbitrary transaction failures as proof of protocol or policy rejection. Wrong credentials, insufficient gas funds, or RPC failures can therefore look like successful defense demonstrations. It should assert the specific failure category.

## What is solid

- **No classic reentrancy bug is shown.** `spend` schedules a native transfer, which does not invoke the receiver’s contract code. State is updated before dispatch.
- **No daily-reset race is shown.** Receipts execute against sequentially committed state. The timestamp divisor correctly represents a UTC day in nanoseconds.
- **The daily limit is a fixed-calendar-window limit**, not a rolling 24-hour limit. Spending near midnight can legitimately reach almost twice the daily cap across a short interval.
- **No pending-transfer double-spend is demonstrated.** NEAR accounts for outgoing transfer funds through its receipt machinery. Do not add a second balance reservation that double-counts them.
- **Administrative setters and withdrawals check the owner.** Owner bypass of spending limits through `withdraw` is an explicit privilege, not an unauthorized-access bug.
- **The sets are not publicly writable.** Unbounded `UnorderedSet` growth requires owner authority; the public storage-griefing path is the predecessor accounting map.
- **Blocklist precedence is correct.** A blocked receiver is denied even if also allowlisted. Matching is exact, not inherited by subaccounts.
- **Storage backing is protocol-enforced.** The withdrawal check is inadequate for predicting success and preserving liquidity, but it does not prove an irreversible withdrawal of required storage stake.
- **Deposits are treasury contributions, not depositor balances.** No depositor accounting or redemption right is implemented. The missing deposit event is an auditability issue, not evidence of deposit theft.
- **Initialization cannot normally be repeated once state exists.** There is no public upgrade method. A vault full-access key can still redeploy code or bypass the contract entirely; that authority is outside the “only a spend FC key” threat model.
- A correctly scoped FC key cannot directly issue `Transfer`, `AddKey`, `DeleteKey`, `DeleteAccount`, or `DeployContract`. It **can** repeatedly call `spend`, choose its arguments, bypass local checks, consume gas, and cause whatever outgoing receipts that method authorizes.

## Recommended fixes (concrete, file+function level)

1. **`lib.rs::spend` — add caller authorization first.**
   - Maintain an owner-managed authorized spender set.
   - Require an authorized predecessor before doing work.
   - Use distinct signing accounts if agents require separate identities or limits. Different keys on one account are not distinct predecessors.
   - If per-agent limits are intended, actually enforce them; the existing map does not.

2. **`lib.rs::new` — secure initialization.**
   - Deploy and initialize in one transaction.
   - For direct deployment, restrict initialization to the deployment account, for example with an appropriate private initializer.
   - For factory deployment, explicitly authorize the factory instead.

3. **`lib.rs::spend` — implement day-aware settlement accounting.**
   - Reserve budget using a unique operation ID and original day.
   - Add a private, fixed-gas callback that distinguishes transfer success and failure.
   - Release failed reservations without modifying another day’s counters.
   - Emit separate scheduled/succeeded/failed events.

4. **`lib.rs::{spend, withdraw}` — calculate usable balance consistently.**
   - Account for actual storage backing, projected storage growth, and an explicit operating reserve.
   - Use checked arithmetic.
   - Bound or remove lifetime `agent_spent` growth. Prefer pre-provisioned agents over public, automatically created accounting entries.
   - Preserve deliberate operating liquidity in owner withdrawals.

5. **`agent.js::pay` — separate payment status from bookkeeping status.**
   - Once chain success is established, never return an on-chain failure because journaling failed.
   - Return the transaction identifier and a separate bookkeeping warning.
   - Support an operation ID/idempotency mechanism for safe retries.
   - Replace `force` with authenticated approval outside the agent’s authority.

6. **`checker.js::{checkCounterparty, recordSpend}` — stop approving observations implicitly.**
   - Separate observed hashes from human-approved baselines.
   - Make code changes an explicit warning independent of prior-payment discounts.
   - Namespace history by network, vault, and agent.
   - Use transactional storage or locking plus atomic replacement.
   - Store confirmed transaction IDs, not just unauditable counters.

7. **`checker.js` / `llm_bridge.js` — keep the model advisory.**
   - Do not let an LLM downgrade deterministic approval requirements.
   - Validate an exact response schema and parse the entire response.
   - Treat interpolated text as untrusted data.
   - Pass only required environment variables to the helper.

8. **`config.js::nearToYocto` — use strict decimal parsing.**
   - Accept canonical nonnegative decimal strings only.
   - Reject signs, exponent notation, extra separators, and more than 24 fractional digits.
   - Reject invalid amounts before logging them as payment requests.

9. **`near.js::accountFromCred` / `config.js::loadCred` — verify the actual signing boundary.**
   - Restrict credential selection and reject directory traversal.
   - Query the public key’s on-chain permission at startup.
   - Require the expected receiver, exactly `spend`, and an intentional finite allowance. An empty method-name list permits all methods on the receiver.
   - Keep full-access credentials outside the agent’s OS security domain.
   - If checker or human approval must survive agent compromise, keep the signing key in a separate enforcement service or enforce those decisions on-chain.

10. **`lib.rs::get_policy` and tests — expose effective state and test real receipts.**
    - Return the current bucket and effective daily usage.
    - Add sandbox tests for unauthorized callers, failed-transfer refunds, callback rollover, storage growth, owner withdrawal floors, and FC-key gas exposure.