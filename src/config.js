import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

export function loadDeploy() {
  return JSON.parse(fs.readFileSync(path.join(root, 'deployments/testnet.json'), 'utf8'));
}

export function loadCred(name) {
  // Secrets live OUTSIDE the repo. Never commit them.
  const p = path.join('/workspace/.secrets/near', name);
  if (!fs.existsSync(p)) throw new Error(`Missing credential file: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function loadBlocklist() {
  return JSON.parse(fs.readFileSync(path.join(root, 'data/blocklist.json'), 'utf8'));
}

export const YOCTO = 10n ** 24n;
export function nearToYocto(near) {
  const [i, f = ''] = String(near).split('.');
  const frac = (f + '000000000000000000000000').slice(0, 24);
  return BigInt(i) * YOCTO + BigInt(frac);
}
export function yoctoToNear(y) {
  const s = BigInt(y).toString().padStart(25, '0');
  return `${s.slice(0, -24)}.${s.slice(-24)}`.replace(/\.?0+$/, match => match.startsWith('.') ? '.0' : '');
}
