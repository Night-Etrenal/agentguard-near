import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const SECRETS_DIR = '/workspace/.secrets/near';

export function loadDeploy() {
  return JSON.parse(fs.readFileSync(path.join(root, 'deployments/testnet.json'), 'utf8'));
}

export function loadCred(name) {
  // Secrets live OUTSIDE the repo. Never commit them.
  // Reject path traversal — only bare filenames under SECRETS_DIR.
  if (typeof name !== 'string' || name !== path.basename(name) || name.includes('\0')) {
    throw new Error(`Invalid credential name: ${name}`);
  }
  const p = path.join(SECRETS_DIR, name);
  if (!p.startsWith(SECRETS_DIR + path.sep)) throw new Error('credential path escape');
  if (!fs.existsSync(p)) throw new Error(`Missing credential file: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function loadBlocklist() {
  return JSON.parse(fs.readFileSync(path.join(root, 'data/blocklist.json'), 'utf8'));
}

export const YOCTO = 10n ** 24n;

/** Strict nonnegative decimal NEAR → yocto. Rejects signs, exponents, extra dots. */
export function nearToYocto(near) {
  const s = String(near).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid NEAR amount (need nonnegative decimal): ${near}`);
  }
  const [i, f = ''] = s.split('.');
  if (f.length > 24) throw new Error('NEAR amount has more than 24 fractional digits');
  const frac = (f + '000000000000000000000000').slice(0, 24);
  return BigInt(i) * YOCTO + BigInt(frac);
}

export function yoctoToNear(y) {
  const s = BigInt(y).toString().padStart(25, '0');
  return `${s.slice(0, -24)}.${s.slice(-24)}`.replace(/\.?0+$/, match => (match.startsWith('.') ? '.0' : ''));
}
