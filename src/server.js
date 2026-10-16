import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { ZipArchive } from 'archiver';

import { config } from './config.js';
import { BatchStore, UploadIndex } from './store.js';
import { notifyBatch, notifyFull } from './notify.js';
import { cleanFilename, contentDisposition, parseRange, uniqueNames, spaceVerdict, RateLimiter, humanSize } from './util.js';
import { ownerPage, messagePage } from './pages.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const batches = new BatchStore(config.batchesDir);
const uploads = new UploadIndex(config.uploadsDir);

const batchLimiter = new RateLimiter(30, 3600_000);
const uploadLimiter = new RateLimiter(500, 3600_000);

// ---------------------------------------------------------------- volume & space

// Async on purpose: the volume is NFS with `hard`, so a sync call against a dead
// server would freeze the whole process instead of just this request.
async function volumeReady() {
  if (!config.requireMarker) return true;
  try {
    await withTimeout(fsp.access(config.markerFile), 5000);
    return true;
  } catch {
    return false;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

async function freeBytes() {
  const s = await fsp.statfs(config.dataDir);
  return s.bavail * s.bsize;
}

async function accepting() {
  if (!(await volumeReady())) return false;
  const v = spaceVerdict(
    { size: 0, free: await freeBytes(), committed: uploads.committed(), pending: uploads.pending() },
    config,
  );
  return v.ok;
}

// The space check and the reservation it leads to must not interleave between two
// concurrent uploads, or both could squeeze into the same last gigabytes.
let guardChain = Promise.resolve();
function serialized(fn) {
  const run = guardChain.then(fn, fn);
  guardChain = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------- tus

function clientIp(headers) {
  const get = (h) => (typeof headers.get === 'function' ? headers.get(h) : headers[h]);
  return get('cf-connecting-ip') || (get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

const tus = new TusServer({
  path: '/files',
  datastore: new FileStore({ directory: config.uploadsDir }),
  maxSize: config.maxFileSize,
  relativeLocation: true,
  disableTerminationForFinishedUploads: true,

  async onUploadCreate(req, upload) {
    const ip = clientIp(req.headers);
    if (!uploadLimiter.allow(ip)) throw { status_code: 429, body: 'Too many uploads, try again later.\n' };
    if (upload.sizeIsDeferred) throw { status_code: 400, body: 'Upload length must be known.\n' };

    const batch = batches.get(upload.metadata?.batchId ?? '');
    if (!batch || batch.deletedAt) throw { status_code: 400, body: 'Unknown batch. Reload the page.\n' };

    return serialized(async () => {
      if (batch.files.length + uploads.inFlight(batch.id).length >= config.maxFilesPerBatch) {
        throw { status_code: 400, body: `At most ${config.maxFilesPerBatch} files at once.\n` };
      }
      if (!(await volumeReady())) throw { status_code: 503, body: 'Not accepting uploads right now.\n' };
      const facts = { size: upload.size, free: await freeBytes(), committed: uploads.committed(), pending: uploads.pending() };
      const v = spaceVerdict(facts, config);
      if (!v.ok) {
        if (v.reason === 'file-too-large') {
          throw { status_code: 413, body: `Files can be at most ${humanSize(config.maxFileSize)}.\n` };
        }
        console.warn(`refused ${upload.size} bytes from ${ip}: ${v.reason}`, facts);
        notifyFull(v.reason, JSON.stringify({ ...facts, ...pick(config, 'maxTotal', 'minFree') }, null, 2));
        throw { status_code: 507, body: 'Out of space right now, sorry. Try again later.\n' };
      }
      uploads.add(upload.id, upload.size, batch.id);
      batches.update(batch, {});
      return { metadata: { ...upload.metadata, filename: cleanFilename(upload.metadata?.filename) } };
    });
  },

  async onUploadFinish(req, upload) {
    uploads.finish(upload.id);
    const batch = batches.get(upload.metadata?.batchId ?? '');
    if (!batch || batch.deletedAt) {
      uploads.remove(upload.id);
      return {};
    }
    if (!batch.files.some((f) => f.id === upload.id)) {
      batch.files.push({
        id: upload.id,
        name: cleanFilename(upload.metadata?.filename),
        size: upload.size,
        type: upload.metadata?.filetype || null,
        finishedAt: new Date().toISOString(),
      });
    }
    batches.update(batch, {});
    console.log(`batch ${batch.id}: received ${upload.metadata?.filename} (${humanSize(upload.size)})`);
    return {};
  },
});

function pick(o, ...keys) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}

// ---------------------------------------------------------------- notification

function ownerLink(batch) {
  return `${config.publicUrl}/b/${batch.token}`;
}

const notifying = new Set();

// Sends the email for a batch if one is due: there are files the last email did not
// cover, and the uploader either said they are done or has gone quiet.
async function maybeNotify(batch, now = Date.now()) {
  if (batch.deletedAt || batch.files.length <= batch.notifiedFiles || notifying.has(batch.id)) return;
  const inFlight = uploads.inFlight(batch.id);
  const lastActivity = Math.max(Date.parse(batch.updatedAt), ...inFlight.map((id) => uploads.lastWrite(id)));
  const done = batch.completedAt && inFlight.length === 0;
  if (!done && now - lastActivity < config.idleNotifyMs) return;
  if (batch.lastNotifyAttempt && now - Date.parse(batch.lastNotifyAttempt) < 10 * 60_000) return;

  notifying.add(batch.id);
  const count = batch.files.length;
  try {
    batches.update(batch, { lastNotifyAttempt: new Date(now).toISOString() });
    await notifyBatch(batch, { link: ownerLink(batch), partial: !done });
    batches.update(batch, { notifiedFiles: count });
    console.log(`batch ${batch.id}: notified (${count} files)`);
  } catch (err) {
    console.error(`batch ${batch.id}: notification failed, will retry: ${err.message}`);
  } finally {
    notifying.delete(batch.id);
  }
}

async function sweep() {
  const now = Date.now();
  for (const b of batches.all()) {
    if (b.deletedAt) {
      if (now - Date.parse(b.deletedAt) > 90 * 86_400_000) batches.remove(b);
      continue;
    }
    if (b.files.length === 0 && uploads.inFlight(b.id).length === 0 && now - Date.parse(b.updatedAt) > 86_400_000) {
      batches.remove(b);
      continue;
    }
    await maybeNotify(b, now);
  }
  for (const [id, u] of uploads.map) {
    if (u.done) continue;
    const last = uploads.lastWrite(id);
    if (now - last > config.staleUploadMs && (last > 0 || now - u.addedAt > 3600_000)) {
      console.log(`removing abandoned partial upload ${id}`);
      uploads.remove(id);
    }
  }
}

// ---------------------------------------------------------------- http helpers

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders, 'cache-control': 'no-store', ...headers });
  res.end(body);
}

const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json' });
const html = (res, status, body) => send(res, status, body, { 'content-type': 'text/html; charset=utf-8' });

const staticFiles = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/owner.js': ['public/owner.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['public/favicon.svg', 'image/svg+xml'],
  '/vendor/uppy.min.mjs': ['node_modules/uppy/dist/uppy.min.mjs', 'text/javascript; charset=utf-8'],
  '/vendor/uppy.min.css': ['node_modules/uppy/dist/uppy.min.css', 'text/css; charset=utf-8'],
};

function serveStatic(res, pathname) {
  const [file, type] = staticFiles[pathname];
  const body = fs.readFileSync(path.join(root, file));
  // Vendor files change only with a new image; pages and app code revalidate.
  const cache = pathname.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache';
  res.writeHead(200, { ...securityHeaders, 'content-type': type, 'cache-control': cache });
  res.end(body);
}

function streamFile(req, res, file) {
  const full = uploads.path(file.id);
  let size;
  try {
    size = fs.statSync(full).size;
  } catch {
    return html(res, 404, messagePage('Gone', 'That file is no longer here.'));
  }
  const range = parseRange(req.headers.range, size);
  const headers = {
    ...securityHeaders,
    'content-type': 'application/octet-stream',
    'content-disposition': contentDisposition(file.name),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  };
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` });
    return res.end();
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
  headers['content-length'] = String(size === 0 ? 0 : end - start + 1);
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD' || size === 0) return res.end();
  fs.createReadStream(full, { start, end }).on('error', () => res.destroy()).pipe(res);
}

function streamZip(res, batch) {
  const names = uniqueNames(batch.files.map((f) => f.name));
  const stamp = batch.createdAt.slice(0, 10);
  res.writeHead(200, {
    ...securityHeaders,
    'content-type': 'application/zip',
    'content-disposition': contentDisposition(`drop-${stamp}.zip`),
    'cache-control': 'no-store',
  });
  // store: no compression. Most uploads are already compressed, and this keeps the
  // zip a plain concatenation that streams at disk speed.
  const zip = new ZipArchive({ store: true, forceZip64: batch.files.some((f) => f.size > 0xfffffff0) });
  zip.on('error', (err) => {
    console.error(`zip for batch ${batch.id} failed: ${err.message}`);
    res.destroy();
  });
  zip.pipe(res);
  batch.files.forEach((f, i) => zip.file(uploads.path(f.id), { name: names[i] }));
  zip.finalize();
}

function deleteBatch(batch) {
  for (const f of batch.files) uploads.remove(f.id);
  for (const id of uploads.inFlight(batch.id)) uploads.remove(id);
  const summary = { count: batch.files.length, bytes: batch.files.reduce((n, f) => n + f.size, 0) };
  batches.update(batch, { deletedAt: new Date().toISOString(), files: [], deleted: summary });
  console.log(`batch ${batch.id}: deleted ${summary.count} files`);
}

async function readBody(req, limit = 4096) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error('body too large');
  }
  return body;
}

// ---------------------------------------------------------------- routing

async function route(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  const m = req.method;

  if (p === '/files' || p.startsWith('/files/')) {
    // tus would happily serve finished uploads back on GET; the uploader must not
    // be able to read anything, so only the upload verbs get through.
    if (m === 'GET') return send(res, 404, 'Not found\n');
    return tus.handle(req, res);
  }

  if (m === 'GET' && staticFiles[p]) return serveStatic(res, p);

  if (m === 'GET' && p === '/healthz') {
    return (await volumeReady()) ? send(res, 200, 'ok\n') : send(res, 503, 'volume not ready\n');
  }

  if (m === 'GET' && p === '/api/config') {
    return json(res, 200, {
      maxFileSize: config.maxFileSize,
      maxFiles: config.maxFilesPerBatch,
      accepting: await accepting(),
      owner: config.ownerName,
    });
  }

  if (m === 'POST' && p === '/api/batches') {
    const ip = clientIp(req.headers);
    if (!batchLimiter.allow(ip)) return json(res, 429, { error: 'Too many requests, try again later.' });
    if (!(await accepting())) return json(res, 503, { error: 'Not accepting uploads right now.' });
    const b = batches.create({ ip, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) });
    return json(res, 201, { id: b.id });
  }

  let r = /^\/api\/batches\/([0-9a-f-]{36})\/complete$/.exec(p);
  if (m === 'POST' && r) {
    const b = batches.get(r[1]);
    if (!b || b.deletedAt) return json(res, 404, { error: 'Unknown batch.' });
    if (b.files.length > 0) {
      batches.update(b, { completedAt: new Date().toISOString() });
      maybeNotify(b);
    }
    return json(res, 200, { ok: true, files: b.files.length });
  }

  r = /^\/b\/([A-Za-z0-9_-]{32})(?:\/(zip|delete|f\/([0-9a-f]{32})))?$/.exec(p);
  if (r) {
    const b = batches.byOwnerToken(r[1]);
    if (!b) return html(res, 404, messagePage('Not found', 'There is nothing at this address.'));
    const action = r[2];
    if (!action && m === 'GET') return html(res, 200, ownerPage(b));
    if (b.deletedAt) return html(res, 410, messagePage('Deleted', 'These files have already been deleted.'));
    if (action === 'delete' && m === 'POST') {
      await readBody(req).catch(() => {});
      deleteBatch(b);
      res.writeHead(303, { ...securityHeaders, location: `/b/${b.token}` });
      return res.end();
    }
    if (action === 'zip' && m === 'GET') {
      batches.update(b, { downloadedAt: new Date().toISOString() });
      return streamZip(res, b);
    }
    const file = r[3] && b.files.find((f) => f.id === r[3]);
    if (file && (m === 'GET' || m === 'HEAD')) {
      if (m === 'GET' && !req.headers.range) batches.update(b, { downloadedAt: new Date().toISOString() });
      return streamFile(req, res, file);
    }
  }

  return html(res, 404, messagePage('Not found', 'There is nothing at this address.'));
}

// ---------------------------------------------------------------- start

fs.mkdirSync(config.uploadsDir, { recursive: true });
batches.load();
uploads.load();

if (!config.publicUrl) console.warn('PUBLIC_URL is not set; emailed links will be relative.');
if (!config.appriseUrl) console.warn('APPRISE_URL is not set; notifications are only logged.');

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error(`${req.method} ${req.url}: ${err.stack || err}`);
    if (!res.headersSent) send(res, 500, 'Internal error\n');
    else res.destroy();
  });
});
// Big uploads are long-lived PATCH requests; Node's default 5-minute request
// timeout would cut a slow 50 MB chunk off mid-way.
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.listen(config.port, () => {
  console.log(
    `drop listening on :${config.port} — data ${config.dataDir}, max file ${humanSize(config.maxFileSize)}, ` +
      `quota ${humanSize(config.maxTotal)}, keep free ${humanSize(config.minFree)}`,
  );
});

setInterval(() => sweep().catch((err) => console.error(`sweep failed: ${err.stack || err}`)), config.sweepIntervalMs);
sweep().catch((err) => console.error(`sweep failed: ${err.stack || err}`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    // Open upload connections would hold close() forever; tus resumes them anyway.
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
