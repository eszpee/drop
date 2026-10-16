import { escapeHtml as e, humanSize } from './util.js';

function layout(title, body, { script } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${e(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main class="shell">
${body}
</main>
${script ? `<script type="module" src="${script}"></script>` : ''}
</body>
</html>`;
}

const fmtDate = (iso) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function messagePage(title, text) {
  return layout(
    title,
    `<section class="card center">
  <div class="mark" aria-hidden="true">↓</div>
  <h1>${e(title)}</h1>
  <p class="muted">${e(text)}</p>
</section>`,
  );
}

export function ownerPage(b) {
  if (b.deletedAt) {
    const d = b.deleted ?? { count: 0, bytes: 0 };
    return layout(
      'Deleted',
      `<section class="card center">
  <div class="mark ok" aria-hidden="true">✓</div>
  <h1>Deleted</h1>
  <p class="muted">${d.count} file${d.count === 1 ? '' : 's'} (${humanSize(d.bytes)}) removed from the server on ${e(fmtDate(b.deletedAt))}.</p>
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
    <a class="btn ghost js-download" href="/b/${b.token}/f/${f.id}" download>Download</a>
  </li>`,
    )
    .join('');

  const downloaded = Boolean(b.downloadedAt);
  return layout(
    'Your drop',
    `<header class="hero">
  <p class="eyebrow">Received ${e(fmtDate(b.createdAt))}</p>
  <h1>${b.files.length} file${b.files.length === 1 ? '' : 's'} <span class="muted">· ${humanSize(total)}</span></h1>
  <p class="muted small">From ${e(b.ip ?? 'unknown')}</p>
</header>

<section class="card">
  ${b.files.length > 1 ? `<a class="btn primary wide js-download" href="/b/${b.token}/zip">Download all as .zip</a>` : ''}
  <ul class="files">${rows || '<li class="muted">No finished files.</li>'}</ul>
</section>

<section class="card delete${downloaded ? ' ready' : ''}" id="delete">
  <div>
    <h2>${downloaded ? 'Got everything?' : 'Done with these?'}</h2>
    <p class="muted small">Deleting removes every file in this drop from the server. This link then stops working.</p>
  </div>
  <form method="post" action="/b/${b.token}/delete" id="delete-form">
    <button class="btn danger" type="submit" id="delete-btn">Delete from server</button>
  </form>
</section>`,
    { script: '/owner.js' },
  );
}
