# AgentGuard — spending-limited wallet for AI agents on NEAR

**Track:** `security` (also fits `agents`)  
**Built at:** NEAR HACKATHON 2026  
**Live testnet vault:** [`nightscoutguard808620.testnet`](https://explorer.testnet.near.org/accounts/nightscoutguard808620.testnet)

## Problem

AI agents that hold keys get prompt-injected and drain treasuries. A full-access key is an all-or-nothing trust decision.

## What we built

AgentGuard gives an agent **money without the keys to everything**:

1. **PolicyVault (NEAR contract)** — on-chain `max_per_tx`, `max_daily`, allowlist, blocklist, pause.
2. **Function-call access key** — agent key can call only `spend` on the vault. The NEAR protocol rejects `Transfer`, `AddKey`, `DeleteAccount` for that key.
3. **Counterparty checker** — before signing, scores the receiver (`allow` / `warn` / `block`) from shared blocklist, on-chain blocklist, account/contract signals, prior interactions; optional LLM review on warns.
4. **Agent wrapper** — refuses `block`, escalates `warn` to a human (or auto-denies in demos).

## How NEAR fits

NEAR access keys are the hard boundary. Even if the agent process is fully compromised, a function-call key **cannot** move NEAR except through `PolicyVault.spend`, which re-checks limits and lists. That is protocol enforcement, not app-layer hope.

### Limits of a function-call key (read this)

- Can call only the configured contract + method names (`spend` here).
- Cannot `Transfer` native NEAR, cannot add/delete keys, cannot deploy code.
- Has a gas/allowance budget; if allowance hits zero the key stops working (owner must top up or rotate).
- An account that keeps **only** FC keys and loses the full-access key can lock itself out — owner full-access key stays offline.

## Do X → see Y (for judges / Claude Code / Codex)

```bash
npm install
npm test              # Rust policy unit tests + JS checker tests
npm run verify:live   # read-only: vault policy, blocklist, code present
```

With secrets configured (see below):

```bash
npm run demo          # attack → over-limit → happy path
```

| Do | See |
| --- | --- |
| `npm run demo:attack` | Injected pay to scam → checker `block`; raw Transfer → protocol reject; forced `spend` → `Receiver blocked` |
| `npm run demo:limit` | 0.6 NEAR spend → `Exceeds max_per_tx` |
| `npm run demo:happy` | 0.05 NEAR to allowlisted merchant → `SPEND ok` + tx hash |
| `npm run verify:live` | `allowlist_enabled: true`, scam blocked, merchant allowed |

Recorded evidence: [`docs/DEMO_LOG.md`](docs/DEMO_LOG.md).

## Architecture

```
Owner (full-access key, offline)
   │ deploys / sets policy / adds FC key
   ▼
PolicyVault contract  ◄── agent FC key (method: spend only)
   │
   ├─ spend() checks: paused, max_per_tx, max_daily, allowlist, blocklist, balance
   └─ Promise.transfer(receiver)

Agent process
   checker(receiver) → allow|warn|block
        │
        └─ AgentGuard.pay() → functionCall(spend) with FC key
```

## Counterparty signals

| Signal | Source |
| --- | --- |
| Shared blocklist | `data/blocklist.json` (agents can extend / report) |
| On-chain blocklist | `is_blocked` view on vault |
| Account exists / storage | `view_account` RPC |
| Is contract + code change | `code_hash` vs local journal |
| Prior interactions | `data/journal.json` |
| Ambiguous WARN | optional `gpt-6-luna` via `/workspace/shared/llm.py` |

## Testnet deployment (this submission)

| Item | Value |
| --- | --- |
| Vault / owner | `nightscoutguard808620.testnet` |
| Merchant (allowlisted) | `nightscoutpay808620.testnet` |
| Scam (blocklisted) | `nightscoutscam808620.testnet` |
| Limits | max 0.5 NEAR / tx, 2 NEAR / day |
| Deploy tx | `7jpuBXRQKVd2F6VPvCeBYx8vq32pL5CQH5XfnpnAyAxE` |
| FC key tx | `GgTqg9zT6M3HTEc5DbdEwitPSZuv3asLF3dBjEkP3YnN` |
| Happy-path spend | `6mexgJa4zM3wcwXh5tsERu6u3LS2PqRXudDz6JsgM9Um` |

Config: `deployments/testnet.json`. WASM: `artifacts/policy_vault.wasm`.

## Reproduce from scratch

```bash
# 1) Build contract (Rust 1.85+, wasm32 target)
cargo build --manifest-path contracts/policy_vault/Cargo.toml \
  --target wasm32-unknown-unknown --release

# 2) Create & fund a testnet account (near-cli-rs)
near account create-account sponsor-by-faucet-service <you>.testnet \
  autogenerate-new-keypair save-to-legacy-keychain network-config testnet create

# 3) Deploy + init
near contract deploy <you>.testnet use-file artifacts/policy_vault.wasm \
  with-init-call new \
  json-args '{"owner":"<you>.testnet","max_per_tx":"500000000000000000000000","max_daily":"2000000000000000000000000"}' \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send

# 4) Add agent FC key (spend only)
near account add-key <you>.testnet grant-function-call-access \
  --allowance '1 NEAR' --contract-account-id <you>.testnet --function-names spend \
  autogenerate-new-keypair save-to-legacy-keychain \
  network-config testnet sign-with-legacy-keychain send

# 5) Point deployments/testnet.json + credentials, then npm run demo
```

Credentials for our burner demo live outside the repo (`/workspace/.secrets/near/`, chmod 600) and are **not** published.

## Project layout

```
contracts/policy_vault/   # Rust NEAR contract
src/                      # checker, agent wrapper, near helpers
demos/                    # attack / happy / over-limit
scripts/demo.sh           # one-command demo
artifacts/policy_vault.wasm
deployments/testnet.json
data/blocklist.json
docs/DEMO_LOG.md
docs/PRIZE_ACCOUNT.md
```

## Baseline / prior work

- Idea shaped from the official track prompt: [06-security.md](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/06-security.md).
- Related prior experiment (different chain): [Night-Etrenal/agent-escrow-arc](https://github.com/Night-Etrenal/agent-escrow-arc) — escrow pattern inspiration only; no Arc/Solidity code reused here.
- No code from `AT-polymarket-kalshi-arbitrage-bot`.

## License

MIT
