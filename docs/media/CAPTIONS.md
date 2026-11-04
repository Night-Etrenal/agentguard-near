# Demo screenshot captions

| File | Caption |
| --- | --- |
| `01-attack-blocked.png` | Prompt-injection drain attempt blocked by intent firewall, FC-key protocol, and on-chain blocklist |
| `02-unauthorized-rejected.png` | Unrelated account calling `spend` → `Unauthorized agent` |
| `03-over-limit-rejected.png` | 0.6 NEAR spend rejected: `Exceeds max_per_tx` |
| `04-happy-path-settled.png` | Allowlisted 0.05 NEAR spend settled — tx `6K4fJkfARRbbHdXq414yYCzi5KfNaL1Cxo1PrHaApcfA` |

Sources: live `npm run demo` / `npm run smoke:unauthorized` on testnet vault `nightscoutguard808620.testnet`. Happy-path panel uses the recorded settlement that produced tx `6K4fJkf…`. No private keys in these images.
