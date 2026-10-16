// The version shown on every page: v1.0.<first 8 of the git commit>.
// In the image, the Dockerfile writes the commit to BUILD; running from a checkout,
// git answers directly. Anything else is "dev".

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const isSha = (s) => /^[0-9a-f]{7,40}$/.test(s);

function commit() {
  try {
    const s = fs.readFileSync(path.join(root, 'BUILD'), 'utf8').trim();
    if (isSha(s)) return s.slice(0, 8);
  } catch {}
  try {
    const s = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (isSha(s)) return s.slice(0, 8);
  } catch {}
  return 'dev';
}

export const VERSION = `v1.0.${commit()}`;
