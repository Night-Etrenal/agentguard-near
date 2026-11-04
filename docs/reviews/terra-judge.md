## Track fit (security / agents) — score 1–10 each with rationale

- **Security: 8/10 for fit.** This directly addresses the track’s agent-wallet and counterparty-checking brief. Function-call keys, on-chain limits, a checker, and an attack script are all relevant. Fit is stronger than the current implementation’s security: in particular, `spend` is callable by anyone, and the human-warning gate is incomplete. TEE attestation is a suggested direction, not a stated requirement.
- **Agents: 2/10.** This is wallet infrastructure for an agent, not the requested agent economy workflow. It demonstrates spending, but not earning, hiring, negotiating, checking purchased work, or producing task receipts.

## Reproducibility score 1–10

**4/10, preliminary.** The README has useful “do X → see Y” commands and testnet identifiers. But I cannot verify the deployment, transaction outcomes, test results, or recorded log from the supplied material.

The from-scratch path also has gaps:

- The build command does not show how the resulting WASM gets to `artifacts/policy_vault.wasm`, which the deploy command uses.
- It omits the commands to set the allowlist and blocklist, and to prepare the merchant and scam accounts.
- Credentials are hard-coded to `/workspace/.secrets/near/agent_fc.json`; the CLI instructions do not explain how to put the generated key there in the expected format.
- The checker tests depend on live RPC and local files; they are not isolated deterministic unit tests.
- The repository and demo URL are still described as pending, and judges do not have the burner key.

## NEAR-specific leverage score 1–10

**7/10.** The function-call key is a meaningful NEAR-native capability: the protocol can restrict this key to a contract and method, with a gas allowance and no attached deposit. The contract, not the key permission, enforces recipient and amount limits. The owner’s full-access key remains a separate, powerful trust dependency.

**Novelty versus multisig: incremental.** This offers unattended, policy-bounded payments rather than requiring a human threshold for every payment. That is useful, but policy wallets and counterparty checks are established ideas; the distinctive piece is their use of NEAR’s scoped access keys. The unrestricted contract caller currently weakens that design substantially.

## Demo / evidence score 1–10

**5/10 for the proposed demo; not independently verified.** The structure is easy for a jury to understand: checker refusal, protocol rejection of a raw transfer, and contract refusal of `spend`.

Important qualifications:

- These are **three tests of different paths**, not three independent checks on one transaction. The protocol rejects the action type; it does not identify the scam recipient.
- The “injection” is a printed simulated instruction, not an observed model following hostile content.
- The script treats **any** raw-transfer exception as a protocol block and **any** forced-call exception as contract rejection. It does not assert the expected error or final receipt. Even the first success condition checks `res.ok === false`, rather than specifically requiring a checker `block`.
- Transaction IDs are useful leads, but the provided excerpt does not establish their final outcomes, deployed code hash, or actual key permissions.

## Weaknesses that hurt scoring (ordered)

1. **Critical: anyone can call `spend`.** There is no caller authorization. With the default allowlist disabled, an unrelated account can direct the vault to pay a non-blocked receiver, subject to the caps, without stealing the agent key. With the claimed live allowlist enabled, an outsider can still initiate unwanted payments to allowed receivers and consume the budget. `agent_spent` also creates state for arbitrary callers, potentially enabling storage-pressure griefing.

2. **Warn does not actually require human approval.** The default auto-denies, which is safe, but `autoDenyWarn: false` proceeds after logging `human_required`; `force: true` also bypasses the warning gate. There is no approval interaction or approval record. The wrapper is bypassable by anyone holding the FC key in any case.

3. **Payment accounting is ahead of settlement.** The contract increments spending and logs `SPEND ok` before the asynchronous transfer settles, with no callback to reconcile a failed transfer. Its fixed 0.05 NEAR reserve is not calculated from storage usage. In the stated deployment, owner and vault are the same account, so `withdraw` targets the vault itself rather than a separate recovery account.

4. **Counterparty claims exceed the implementation.** Minimal storage is not account age or activity history. The “shared” blocklist is a local JSON file, with no demonstrated evidence-reporting service. A changed code hash can score **35 and be allowed** when there is a prior interaction; the checker also overwrites the old hash during the check, so the next check may no longer see the change. RPC failures are not consistently distinguished from negative signals.

5. **Tests and evidence leave core guarantees unproven.** The supplied Rust tests cover three rejection cases, not caller authorization, daily reset, pause, transfer settlement, or storage. The checker test does not require the merchant to be `allow`, only “not block.” The demo’s broad exception handling can produce false-positive attack results.

6. **Operational and submission gaps.** The live state and offline-key claim remain unverified, the replay requires unpublished credentials, and the public repository and demo post are still pending. The absolute-path optional LLM dependency is not portable.

## Concrete improvements that would raise score most (top 5, actionable)

1. **Authorize contract callers.** For the stated single-account setup, restrict `spend` to the intended predecessor account; for multiple agents, maintain an owner-managed authorized-account registry. Add tests proving an unrelated account cannot spend even when the receiver is allowed. Verify the actual FC key’s receiver, method list, and allowance on testnet.

2. **Make warnings fail closed.** Replace the boolean/`force` bypass with an explicit, auditable human approval flow; otherwise deny. Treat unavailable security signals as unknown rather than silently safe. An LLM must not downgrade a deterministic block or substitute for approval.

3. **Handle settlement and reserves correctly.** Add a callback and explicit pending/succeeded/failed accounting; test failed transfers and daily-budget reconciliation. Calculate storage and operating reserves, document the calendar-day limit, and provide a recovery destination distinct from the vault.

4. **Make checker signals honest and testable.** Either implement evidence-backed shared reports and real history sources, or label the current data local heuristics. Preserve a known-good code hash until reviewed, ensure a detected change cannot score `allow`, and mock RPC failures and journal state in tests.

5. **Ship a clean-room, verifiable demo.** Include exact account, policy, credential, and WASM-copy commands; publish the repo; run CI and sandbox integration tests. Assert the specific checker decision, protocol error, and contract receipt outcome. Publish explorer links and final outcomes for the positive and negative controls, plus the deployed code hash and key permissions.

## Suggested 1–2 LLM-powered runtime features that still demo without an API key (deterministic fallback)

1. **Injection-risk escalation:** optionally inspect the agent’s proposed payment rationale and untrusted source text for instructions to override policy. The model may raise risk to warn/block, never lower an existing result. Without an API key, use a deterministic fixture/rule that flags the demo phrase, and clearly label it a limited heuristic—not comprehensive injection detection.

2. **Human-readable warning brief:** summarize receiver, amount, policy limits, and risk signals for approval. Without an API key, generate the same fields from a fixed template. The explanation has no signing authority, and unknown or malformed model output cannot approve a payment.

## Preliminary overall (security track) 1–10

**4/10.** Strong track alignment and a credible NEAR-specific architecture, but the publicly callable spend path is a serious custody flaw. Fixing caller authorization and the warn gate, then proving the three demo outcomes with reproducible tests and live receipts, would materially improve this score.