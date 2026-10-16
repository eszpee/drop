// Email goes out through an Apprise API server (POST /notify/<key>), so this app
// holds no SMTP credentials. Without APPRISE_URL it only logs.

import { config } from './config.js';
import { escapeHtml, humanSize } from './util.js';

async function send(title, html) {
  if (!config.appriseUrl) {
    console.log(`[notify:dry-run] ${title}\n${html}`);
    return true;
  }
  const res = await fetch(config.appriseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, body: html, format: 'html', tag: config.appriseTag }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`apprise answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

export async function notifyBatch(batch, { link, partial }) {
  const files = batch.files;
  const total = files.reduce((n, f) => n + f.size, 0);
  const isFollowUp = batch.notifiedFiles > 0;
  const what = `${files.length} file${files.length === 1 ? '' : 's'} (${humanSize(total)})`;
  const title = isFollowUp ? `drop: more files arrived — now ${what}` : `drop: ${what} received`;
  const rows = files
    .map((f) => `<li>${escapeHtml(f.name)} <span style="color:#888">— ${humanSize(f.size)}</span></li>`)
    .join('');
  const html = `
<p><b>${what}</b> dropped${partial ? ' — the sender left before marking it done, so it may be incomplete' : ''}.</p>
<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
<ul>${rows}</ul>
<p style="color:#888">From ${escapeHtml(batch.ip ?? 'unknown')} · ${escapeHtml(batch.userAgent ?? '')}</p>`;
  return send(title, html);
}

let lastFullNotice = 0;

// Told at most twice a day; every refused upload would be a flood otherwise.
export async function notifyFull(reason, details) {
  if (Date.now() - lastFullNotice < 12 * 3600_000) return;
  lastFullNotice = Date.now();
  await send(
    'drop: refusing uploads — out of room',
    `<p>An upload was refused (<b>${escapeHtml(reason)}</b>).</p><pre>${escapeHtml(details)}</pre>
<p>Download and delete older drops, or raise MAX_TOTAL / lower MIN_FREE.</p>`,
  ).catch((err) => console.error(`full-notice failed: ${err.message}`));
}
