import { escapeHtml as e, humanSize } from './util.js';

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
  const rows = b.files
    .map(
      (f) => `<li class="file">
    <div class="file-main">
      <span class="file-name">${e(f.name)}</span>
      <span class="file-size">${humanSize(f.size)}</span>
    </div>
    <a class="btn js-download" href="/b/${b.token}/f/${f.id}" download>Download</a>
  </li>`,
    )
    .join('');

  const downloaded = Boolean(b.downloadedAt);
  return layout(
    'incoming',
    `<header class="hero">
  <p class="banner">PETERSZASZ.COM // DROP // RECEIVED ${e(fmtDate(b.createdAt))}</p>
  <h1><span class="prompt">INCOMING: ${plural(b.files.length, 'FILE')}</span><span class="cursor" aria-hidden="true"></span></h1>
  <p class="muted">${humanSize(total)} total · from ${e(b.ip ?? 'unknown')}</p>
</header>

<section class="term" data-label="PAYLOAD">
  ${b.files.length > 1 ? `<a class="btn primary wide js-download" href="/b/${b.token}/zip">Download all as .zip</a>` : ''}
  <ul class="files">${rows || '<li class="muted">No finished files.</li>'}</ul>
</section>

<section class="term delete${downloaded ? ' ready' : ''}" id="delete" data-label="PURGE">
  <div>
    <h2>${downloaded ? 'Got everything?' : 'Done with these?'}</h2>
    <p class="muted small">Wipes every file in this drop from the server. This link dies with them.</p>
  </div>
  <form method="post" action="/b/${b.token}/delete" id="delete-form">
    <button class="btn" type="submit" id="delete-btn">Delete</button>
  </form>
</section>`,
    { script: '/owner.js' },
  );
}
