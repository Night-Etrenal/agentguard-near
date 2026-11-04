# Recorded testnet demo (2026-11-04, America/Los_Angeles)

Network: NEAR testnet. Vault: `nightscoutguard808620.testnet`.

## Evidence transactions
| Step | Result | Tx / note |
| --- | --- | --- |
| Deploy + init PolicyVault | success | https://explorer.testnet.near.org/transactions/7jpuBXRQKVd2F6VPvCeBYx8vq32pL5CQH5XfnpnAyAxE |
| Add function-call key (`spend` only, 1 NEAR allowance) | success | https://explorer.testnet.near.org/transactions/GgTqg9zT6M3HTEc5DbdEwitPSZuv3asLF3dBjEkP3YnN |
| Attack: checker BLOCK on `nightscoutscam808620.testnet` | refused off-chain | see `npm run demo:attack` log |
| Attack: FC key raw Transfer | protocol reject | "access key which allows transaction to apply only one specific action" |
| Attack: direct `spend` bypass | contract panic | `Receiver blocked` |
| Over limit 0.6 NEAR (max 0.5) | contract panic | `Exceeds max_per_tx` |
| Happy path 0.05 NEAR → merchant | success | https://explorer.testnet.near.org/transactions/6mexgJa4zM3wcwXh5tsERu6u3LS2PqRXudDz6JsgM9Um |

## Reproduce without our keys
```bash
npm install
npm test                 # unit + checker (checker needs RPC)
npm run verify:live      # read-only policy/blocklist checks
```
Full signing demos need a funded testnet account + FC key (see README "Reproduce from scratch").
