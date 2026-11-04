# Prize payout account (mainnet)

## Status
- Generated locally on 2026-11-04 (America/Los_Angeles): **implicit account keypair only**.
- **Not yet created on-chain** (no mainnet transaction was sent).
- Implicit account id (public): `6f789225cb0d3bab145e59ff72c9fdef24d5d492fa5bebaabaedf992f00f7511`
- Private key / seed phrase: stored at `/workspace/.secrets/near/prize_mainnet.json` (chmod 600). Never commit.

## Cost to activate
- Creating an implicit account on mainnet requires a small inbound transfer (even 0 NEAR works for creation; ~0.05–0.1 NEAR recommended so the account can later sign a receive/swap).
- Named accounts like `team.near` cost more (name auction / purchase) — we avoid that.

## How to activate (human)
1. Send ~0.1 NEAR on **mainnet** to `6f789225cb0d3bab145e59ff72c9fdef24d5d492fa5bebaabaedf992f00f7511` from any wallet (or from Binance withdraw to NEAR if supported).
2. Import the seed phrase from the secrets file into [MyNearWallet](https://app.mynearwallet.com/) or `near-cli` for mainnet.
3. Use this account id in the hackathon submission `nearAddress` field.
4. After payout, swap NEAR → USDC via Rhea / Ref / Intents and withdraw to Binance.

## Why not created automatically
Hackathon rules (HACKATHON.md): do not sign mainnet transactions or invent the payout account without the human. This file is the ready-to-use plan.
