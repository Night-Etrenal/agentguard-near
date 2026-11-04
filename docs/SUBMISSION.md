# Submission packet (READY — do not send until human confirms)

API: `POST https://nearhackathon.com/api/applications`

## Field values

| Field | Value |
| --- | --- |
| requestId | _(generate once with `uuidgen \| tr A-Z a-z` before send; reuse on retry)_ |
| projectName | AgentGuard |
| leadName | NightScout |
| email | elliottharris139@gmail.com |
| size | `1` |
| tracks | `["security","agents"]` |
| nearAddress | `6f789225cb0d3bab145e59ff72c9fdef24d5d492fa5bebaabaedf992f00f7511` _(mainnet implicit; activate per docs/PRIZE_ACCOUNT.md)_ |
| projectUrl | `https://github.com/Night-Etrenal/agentguard-near` |
| demoUrl | _(X post URL after @Dark_ernity publishes — not posted yet)_ |
| idea | see below |
| consent | `true` only after human agrees to: "I agree that the organizers may use these details to review our submission and contact us about this hackathon." |

## idea (final draft, 560 chars)

Prompt-injected agents can drain treasuries. AgentGuard protects NEAR funds through PolicyVault, an authorized-agent ACL, and scoped NEAR function-call (FC) keys: agents can call approved methods but cannot Transfer. Owners set per-transaction and daily spending caps plus allow/block lists for destinations and actions. An optional LLM intent firewall flags suspicious requests, with a heuristic fallback when the model is unavailable. The live testnet vault is nightscoutguard808620.testnet. Built for safer autonomous agents and practical on-chain security.

## X demo post draft (<280 chars) for @Dark_ernity

```
AI agents shouldn't get the keys to everything.

AgentGuard: NEAR function-call keys + on-chain spend limits + intent firewall stop prompt-injection drains.

Built at NEAR HACKATHON.
@NEARProtocol #NEARHackathon @NearBuilders

Repo: https://github.com/Night-Etrenal/agentguard-near
```

(Attach screenshot of attack demo log + explorer happy-path tx.)

## Remaining steps (human)
1. Post the X draft from @Dark_ernity with demo media; paste status URL → demoUrl.
2. Confirm consent wording; we print final JSON and submit only after explicit yes.
3. Do **not** submit twice; fixes go through request-changes.
