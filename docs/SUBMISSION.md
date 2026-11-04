# Submission packet (READY — do not send until human confirms)

API: `POST https://nearhackathon.com/api/applications`

## Field values

| Field | Value |
| --- | --- |
| requestId | _(generate once with `uuidgen \| tr A-Z a-z` before send; reuse on retry)_ |
| projectName | AgentGuard |
| leadName | NightScout |
| email | **PLACEHOLDER — human fills** |
| size | `1` |
| tracks | `["security","agents"]` |
| nearAddress | `6f789225cb0d3bab145e59ff72c9fdef24d5d492fa5bebaabaedf992f00f7511` _(mainnet implicit; activate per docs/PRIZE_ACCOUNT.md)_ |
| projectUrl | `https://github.com/Night-Etrenal/agentguard-near` _(after push)_ |
| demoUrl | _(X post URL after @Dark_ernity publishes)_ |
| idea | see below |
| consent | `true` only after human agrees to: "I agree that the organizers may use these details to review our submission and contact us about this hackathon." |

## idea (draft)

AI agents that hold full-access keys get prompt-injected and drain treasuries. AgentGuard is a spending-limited wallet for agents on NEAR: a PolicyVault contract enforces max-per-tx, daily caps, allowlists and blocklists; the agent only receives a function-call access key scoped to `spend`, so the protocol itself rejects raw Transfer/AddKey even if the agent process is compromised; a counterparty checker scores receivers (shared + on-chain blocklist, account/contract signals, prior interactions) and refuses to sign on block. Live on testnet at nightscoutguard808620.testnet with an attack demo that stops a phishing pay three ways — checker, protocol, and contract.

## X demo post draft (<280 chars) for @Dark_ernity

```
AI agents shouldn't get the keys to everything.

AgentGuard: NEAR function-call keys + on-chain spend limits stop prompt-injection drains.

Built at NEAR HACKATHON.
@NEARProtocol #NEARHackathon @NearBuilders

Repo: https://github.com/Night-Etrenal/agentguard-near
```

(Attach screenshot of attack demo log + explorer happy-path tx.)

## Exact remaining steps
1. Create public repo `Night-Etrenal/agentguard-near` via `user-GitHub-xai/create_repository` (private=false) — **needs human OK to create/push**.
2. Push `/workspace/near_hackathon` (no secrets).
3. Fund prize implicit account with ~0.1 NEAR mainnet (or confirm address).
4. Human posts the X draft from @Dark_ernity with demo media; paste status URL.
5. Human fills email + consent; we print final JSON and submit only after explicit yes.
