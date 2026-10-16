import { escapeHtml as e, humanSize } from './util.js';
import { VERSION } from './build.js';
import { config } from './config.js';
import { shareActive } from './store.js';

function layout(title, body, { script } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#000000">
<title>DROP :: ${e(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/vendor/vt323-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main class="shell">
${body}
</main>
<script type="module" src="/rain.js"></script>
${script ? `<script type="module" src="${script}"></script>` : ''}
</body>
</html>`;
}

const fmtDate = (iso) =>
  new Date(iso)
    .toLocaleString('en-GB', {
      timeZone: 'Europe/Budapest',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    .toUpperCase();

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 'S'}`;

export function messagePage(title, text) {
  return layout(
    title,
    `<section class="term center" data-label="ERROR">
  <h1>${e(title)}</h1>
  <p class="muted">${e(text)}</p>
</section>`,
  );
}

// One row per file, linking under base: /b/<owner token> or /s/<share token>.
function fileList(b, base) {
  const rows = b.files
    .map(
      (f) => `<li class="file">
    <div class="file-main">
      <span class="file-name">${e(f.name)}</span>
      <span class="file-size">${humanSize(f.size)}</span>
    </div>
    <a class="btn js-download" href="${base}/f/${f.id}" download>Download</a>
  </li>`,
    )
    .join('');
  return `${b.files.length > 1 ? `<a class="btn primary wide js-download" href="${base}/zip">Download all as .zip</a>` : ''}
  <ul class="files">${rows || '<li class="muted">No finished files.</li>'}</ul>`;
}

const dayChoices = () =>
  config.shareDays
    .map((d, i) => `<option value="${d}"${d === 7 || (i === 0 && !config.shareDays.includes(7)) ? ' selected' : ''}>${plural(d, 'DAY')}</option>`)
    .join('');

function shareSection(b) {
  const shares = (b.shares ?? []).slice().reverse();
  const rows = shares
    .map((s) => {
      const active = shareActive(s);
      const state = s.revokedAt
        ? `revoked ${e(fmtDate(s.revokedAt))}`
        : active
          ? `expires ${e(fmtDate(s.expiresAt))}`
          : `expired ${e(fmtDate(s.expiresAt))}`;
      const seen = s.downloadedAt ? ` · downloaded ${e(fmtDate(s.downloadedAt))}` : ' · not downloaded yet';
      return `<li class="share${active ? '' : ' dead'}">
    <input class="link" type="text" readonly value="${e(`${config.publicUrl}/s/${s.token}`)}" aria-label="Share link">
    <span class="muted small">${state}${seen}</span>
    ${
      active
        ? `<form method="post" action="/b/${b.token}/share/${s.id}/revoke"><button class="btn" type="submit">Revoke</button></form>`
        : ''
    }
  </li>`;
    })
    .join('');
  const note = b.home
    ? 'Download-only links. Uploaded from home, so the files are deleted once the links run out.'
    : 'Download-only links: no delete, no sender details. Revoke one any time.';
  return `<section class="term" id="share" data-label="SHARE">
  <p class="muted small">${note}</p>
  <ul class="shares">${rows}</ul>
  <form class="share-new" method="post" action="/b/${b.token}/share">
    <select name="days" aria-label="Link expires after">${dayChoices()}</select>
    <button class="btn" type="submit">New link</button>
  </form>
</section>`;
}

export function sharePage(b, s) {
  const total = b.files.reduce((n, f) => n + f.size, 0);
  return layout(
    'files for you',
    `<header class="hero">
  <p class="banner">PETERSZASZ.COM // DROP ${VERSION} // INCOMING TRANSMISSION</p>
  <h1><span class="prompt">${plural(b.files.length, 'FILE')} FOR YOU</span><span class="cursor" aria-hidden="true"></span></h1>
  <p class="muted">${humanSize(total)} total · link works until ${e(fmtDate(s.expiresAt))}</p>
</header>

<section class="term" data-label="PAYLOAD">
  ${fileList(b, `/s/${s.token}`)}
</section>`,
  );
}

export function ownerPage(b) {
  if (b.deletedAt) {
    const d = b.deleted ?? { count: 0, bytes: 0 };
    return layout(
      'purged',
      `<section class="term center" data-label="STATUS">
  <h1>Files purged</h1>
  <p class="muted">${plural(d.count, 'FILE')} (${humanSize(d.bytes)}) wiped from the server on ${e(fmtDate(b.deletedAt))}.</p>
</section>`,
    );
  }

  const total = b.files.reduce((n, f) => n + f.size, 0);
  const downloaded = Boolean(b.downloadedAt);
  return layout(
    'incoming',
    `<header class="hero">
  <p class="banner">PETERSZASZ.COM // DROP ${VERSION} // RECEIVED ${e(fmtDate(b.createdAt))}</p>
  <h1><span class="prompt">INCOMING: ${plural(b.files.length, 'FILE')}</span><span class="cursor" aria-hidden="true"></span></h1>
  <p class="muted">${humanSize(total)} total · from ${e(b.ip ?? 'unknown')}${b.home ? ' (home)' : ''}</p>
</header>

<section class="term" data-label="PAYLOAD">
  ${fileList(b, `/b/${b.token}`)}
</section>

${b.files.length > 0 ? shareSection(b) : ''}

<section class="term delete${downloaded ? ' ready' : ''}" id="delete" data-label="PURGE">
  <div>
    <h2>${downloaded ? 'Got everything?' : 'Done with these?'}</h2>
    <p class="muted small">Wipes every file in this drop from the server. This link and any share links die with them.</p>
  </div>
  <form method="post" action="/b/${b.token}/delete" id="delete-form">
    <button class="btn" type="submit" id="delete-btn">Delete</button>
  </form>
</section>`,
    { script: '/owner.js' },
  );
}
