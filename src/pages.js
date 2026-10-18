import { escapeHtml as e, humanSize, senderLabel } from './util.js';
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
<link rel="stylesheet" href="/style.css?v=${VERSION}">
</head>
<body>
<main class="shell">
${body}
</main>
<script type="module" src="/rain.js?v=${VERSION}"></script>
${script ? `<script type="module" src="${script}?v=${VERSION}"></script>` : ''}
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

// Expiry choices as a row of buttons (radios underneath, so the form works
// without JavaScript). The middle one is preselected.
const dayChoices = () => {
  const pick = config.shareDays[Math.floor(config.shareDays.length / 2)];
  const opts = config.shareDays
    .map(
      (d) =>
        `<label><input type="radio" name="days" value="${d}"${d === pick ? ' checked' : ''}><span>${d} day${d === 1 ? '' : 's'}</span></label>`,
    )
    .join('');
  return `<div class="days" role="radiogroup" aria-label="Link expires after">${opts}</div>`;
};

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
    ? 'Download-only links. Uploaded from home, so the files are deleted once the links run out, or a day after upload if there never was one.'
    : 'Download-only links: no delete, no sender details. Revoke one any time.';
  return `<section class="term" id="share" data-label="SHARE">
  <p class="muted small">${note}</p>
  <ul class="shares">${rows}</ul>
  <form class="share-new" method="post" action="/b/${b.token}/share">
    ${dayChoices()}
    <button class="btn" type="submit">New link</button>
  </form>
</section>`;
}

export function sharePage(b, s) {
  const total = b.files.reduce((n, f) => n + f.size, 0);
  return layout(
    'files for you',
    `<header class="hero">
  <p class="banner">DROP ${VERSION} // INCOMING TRANSMISSION</p>
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
  <p class="banner">DROP ${VERSION} // RECEIVED ${e(fmtDate(b.createdAt))}</p>
  <h1><span class="prompt">INCOMING: ${plural(b.files.length, 'FILE')}</span><span class="cursor" aria-hidden="true"></span></h1>
  <p class="muted">${humanSize(total)} total · from ${e(senderLabel(b))}${b.home ? ' (home)' : ''}</p>
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

// ---------------------------------------------------------------- admin

const DAY = 86_400_000;
const sizeOf = (b) => b.files.reduce((n, f) => n + f.size, 0);
const firstName = (names, count) =>
  names ? `${e(names)}${count > 1 ? ` <span class="muted">+${count - 1}</span>` : ''}` : '<span class="muted">(no name)</span>';

function row({ title, meta, href, label }) {
  return `<li class="file">
    <div class="file-main">
      <span class="file-name">${title}</span>
      <span class="file-size">${meta}</span>
    </div>
    ${href ? `<a class="btn" href="${href}">${label}</a>` : ''}
  </li>`;
}

function stat(value, label) {
  return `<div class="stat"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
}

const reasons = { owner: 'deleted by you', expired: 'links expired', unshared: 'never shared' };

export function adminPage({ batches, inFlight, space, now = Date.now() }) {
  const live = batches.filter((b) => !b.deletedAt);
  const gone = batches.filter((b) => b.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const newest = (a, b) => b.createdAt.localeCompare(a.createdAt);

  const receiving = live.filter((b) => inFlight.has(b.id)).sort(newest);
  const inbox = live.filter((b) => !b.home && b.files.length > 0).sort(newest);
  const outbox = live.filter((b) => b.home && b.files.length > 0).sort(newest);

  // History: tombstones are kept for 90 days, so everything here is that window.
  const all = [...live.filter((b) => b.files.length > 0), ...gone];
  const inAll = all.filter((b) => !b.home);
  const outAll = all.filter((b) => b.home);
  const bytesOf = (b) => (b.deletedAt ? b.deleted?.bytes ?? 0 : sizeOf(b));
  const sum = (xs) => xs.reduce((n, b) => n + bytesOf(b), 0);
  const links = outAll.flatMap((b) => b.shares ?? []);
  const fetched = links.filter((x) => x.downloadedAt).length;
  const outFetched = outAll.filter((b) => (b.shares ?? []).some((x) => x.downloadedAt)).length;
  const liveLinks = live.flatMap((b) => b.shares ?? []).filter((x) => shareActive(x, now)).length;
  const inRead = inAll.filter((b) => b.downloadedAt).length;

  const pct = space.maxTotal ? Math.min(100, Math.round((space.stored / space.maxTotal) * 100)) : 0;

  const inboxRows = inbox
    .map((b) =>
      row({
        title: firstName(b.files[0]?.name, b.files.length),
        meta: `${e(fmtDate(b.createdAt))} · ${humanSize(sizeOf(b))} · from ${e(senderLabel(b))} · ${
          b.downloadedAt ? 'downloaded' : '<b class="flag">new</b>'
        }${b.completedAt ? '' : ' · <span class="flag">unfinished</span>'}`,
        href: `/b/${b.token}`,
        label: 'Open',
      }),
    )
    .join('');

  const outboxRows = outbox
    .map((b) => {
      const shares = b.shares ?? [];
      const active = shares.filter((x) => shareActive(x, now));
      const soonest = active.map((x) => x.expiresAt).sort()[0];
      const got = shares.some((x) => x.downloadedAt);
      const state = active.length
        ? `${plural(active.length, 'LINK').toLowerCase()} · until ${e(fmtDate(soonest))}`
        : shares.length
          ? 'no live link'
          : `<span class="flag">no link</span> · goes ${e(fmtDate(new Date(Date.parse(b.updatedAt) + DAY).toISOString()))}`;
      return row({
        title: firstName(b.files[0]?.name, b.files.length),
        meta: `${e(fmtDate(b.createdAt))} · ${humanSize(sizeOf(b))} · ${state} · ${got ? 'fetched' : 'not fetched'}`,
        href: `/b/${b.token}`,
        label: 'Manage',
      });
    })
    .join('');

  const receivingRows = receiving
    .map((b) => {
      const t = inFlight.get(b.id);
      const p = t.total ? Math.floor((t.received / t.total) * 100) : 0;
      return row({
        title: `${plural(t.files, 'FILE')} in flight${b.home ? ' (yours)' : ''}`,
        meta: `${humanSize(t.received)} of ${humanSize(t.total)} · ${p}% · from ${e(senderLabel(b))} · started ${e(fmtDate(b.createdAt))}`,
      });
    })
    .join('');

  const historyRows = gone
    .slice(0, 30)
    .map((b) => {
      const d = b.deleted ?? { count: 0, bytes: 0 };
      const got = b.home ? (b.shares ?? []).some((x) => x.downloadedAt) : Boolean(b.downloadedAt);
      return row({
        title: `<span class="dir">${b.home ? 'OUT' : 'IN'}</span> ${firstName(d.first, d.count)}`,
        meta: `${e(fmtDate(b.createdAt))} · ${plural(d.count, 'FILE').toLowerCase()} · ${humanSize(d.bytes)} · ${
          got ? 'downloaded' : 'never downloaded'
        } · ${reasons[d.reason] ?? 'deleted'} ${e(fmtDate(b.deletedAt))}`,
      });
    })
    .join('');

  const section = (label, rows, empty) =>
    `<section class="term" data-label="${label}"><ul class="files">${rows || `<li class="muted">${empty}</li>`}</ul></section>`;

  return layout(
    'admin',
    `<header class="hero">
  <p class="banner">DROP ${VERSION} // <span class="home-flag">HOME MODE</span> // ADMIN</p>
  <h1><span class="prompt">CONTROL ROOM</span><span class="cursor" aria-hidden="true"></span></h1>
  <p class="muted"><a href="/">&lt; back to upload</a></p>
</header>

<section class="term" data-label="DISK">
  <div class="meter" role="img" aria-label="${pct}% of the quota used"><span style="width:${pct}%"></span></div>
  <p class="small">${humanSize(space.stored)} stored of ${humanSize(space.maxTotal)} quota · ${
    space.free == null ? 'free space unknown' : `${humanSize(space.free)} free on the volume, ${humanSize(space.minFree)} kept back`
  }</p>
</section>

<section class="term" data-label="LAST 90 DAYS">
  <div class="stats">
    ${stat(inAll.length, `received · ${humanSize(sum(inAll))}`)}
    ${stat(`${inRead}/${inAll.length}`, 'received, downloaded')}
    ${stat(outAll.length, `sent · ${humanSize(sum(outAll))}`)}
    ${stat(`${outFetched}/${outAll.length}`, 'sent, fetched by recipient')}
    ${stat(links.length, `${links.length === 1 ? 'link' : 'links'} made · ${fetched} used`)}
    ${stat(liveLinks, `${liveLinks === 1 ? 'link' : 'links'} live now`)}
  </div>
</section>

${receiving.length ? section('IN FLIGHT', receivingRows, '') : ''}
${section(`INBOX · ${inbox.length}`, inboxRows, 'Nothing waiting.')}
${section(`OUTBOX · ${outbox.length}`, outboxRows, 'Nothing shared right now.')}
${section('HISTORY', historyRows, 'Nothing deleted yet.')}
<p class="foot">Deleted sends are remembered for 90 days.</p>`,
  );
}
