// Small pure helpers, kept apart so they can be unit-tested without a server.

export function humanSize(n) {
  if (!Number.isFinite(n)) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 || n >= 100 ? 0 : 1)} ${units[i]}`;
}

// Uploaders choose the name, so it is untrusted: no path parts, no control
// characters, bounded length. Never used as a path on disk, only for display and
// Content-Disposition.
export function cleanFilename(raw) {
  let name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .split(/[\\/]/)
    .pop()
    .trim();
  if (!name || name === '.' || name === '..') name = 'file';
  if (name.length > 200) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
    name = name.slice(0, 200 - ext.length) + ext;
  }
  return name;
}

export function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Single-range "bytes=a-b" only; anything else is served whole, which is what the
// spec allows. Returns null for "serve everything", or {start, end} inclusive, or
// 'unsatisfiable'.
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

// Names inside a zip must be unique, or extractors silently overwrite.
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} (${n + 1})${name.slice(dot)}` : `${name} (${n + 1})`;
  });
}

// Decides whether a new upload of `size` bytes may start.
//   free       bytes free on the volume now
//   committed  declared size of every upload stored or in flight
//   pending    bytes still to arrive for uploads in flight (already promised)
export function spaceVerdict({ size, free, committed, pending }, limits) {
  if (!Number.isFinite(size) || size < 0) return { ok: false, reason: 'size-unknown' };
  if (size > limits.maxFileSize) return { ok: false, reason: 'file-too-large' };
  if (committed + size > limits.maxTotal) return { ok: false, reason: 'quota' };
  if (free - pending - size < limits.minFree) return { ok: false, reason: 'disk' };
  return { ok: true };
}

export function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// Fixed-window counter per key. In memory: a restart forgets it, which is fine for
// keeping a casual flood off the disk; Cloudflare's rule is the outer limit.
export class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  allow(key, now = Date.now()) {
    const e = this.hits.get(key);
    if (!e || now - e.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      if (this.hits.size > 10_000) this.prune(now);
      return true;
    }
    e.count++;
    return e.count <= this.limit;
  }
  prune(now) {
    for (const [k, e] of this.hits) if (now - e.start >= this.windowMs) this.hits.delete(k);
  }
}
