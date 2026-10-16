// Batches: one per "drop" — the files someone sent in one go. Kept in memory and
// written through to one JSON file each, so a restart loses nothing.
//
// A batch has two identifiers on purpose:
//   id     known to the uploader's browser (tus metadata carries it)
//   token  known only to the owner (it is in the email link and nowhere else)
// so the uploader can add files to their batch but never download or delete them.
// Share links add a third kind: download-only tokens with an expiry, which the
// owner hands to someone else (batch.shares).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class BatchStore {
  constructor(dir) {
    this.dir = dir;
    this.byId = new Map();
    this.byToken = new Map();
    this.shares = new Map();
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const b = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
        this.index(b);
      } catch (err) {
        console.error(`skipping unreadable batch ${f}: ${err.message}`);
      }
    }
    return this;
  }

  create(meta) {
    const now = new Date().toISOString();
    const b = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(24).toString('base64url'),
      createdAt: now,
      updatedAt: now,
      ip: meta.ip ?? null,
      // Uploaded in home mode, i.e. by the owner: only these can be shared from the
      // upload page, and their files go when their share links expire.
      home: Boolean(meta.home),
      userAgent: meta.userAgent ?? null,
      files: [],
      completedAt: null,
      // How many files the last email covered; more than that means another is due.
      notifiedFiles: 0,
      lastNotifyAttempt: null,
      downloadedAt: null,
      deletedAt: null,
      shares: [],
    };
    this.save(b);
    return b;
  }

  get(id) {
    return this.byId.get(id);
  }

  byOwnerToken(token) {
    return this.byToken.get(token);
  }

  // The batch and share behind a share token, or nothing.
  byShareToken(token) {
    return this.shares.get(token);
  }

  all() {
    return [...this.byId.values()];
  }

  update(b, changes) {
    Object.assign(b, changes, { updatedAt: new Date().toISOString() });
    this.save(b);
    return b;
  }

  index(b) {
    this.byId.set(b.id, b);
    this.byToken.set(b.token, b);
    for (const s of b.shares ?? []) this.shares.set(s.token, { batch: b, share: s });
  }

  save(b) {
    this.index(b);
    const file = path.join(this.dir, `${b.id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(b, null, 2));
    fs.renameSync(tmp, file);
  }

  remove(b) {
    this.byId.delete(b.id);
    this.byToken.delete(b.token);
    for (const s of b.shares ?? []) this.shares.delete(s.token);
    fs.rmSync(path.join(this.dir, `${b.id}.json`), { force: true });
  }
}

export function newShare(days, now = Date.now()) {
  return {
    id: crypto.randomBytes(6).toString('hex'),
    token: crypto.randomBytes(24).toString('base64url'),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + days * 86_400_000).toISOString(),
    revokedAt: null,
    downloadedAt: null,
  };
}

export const shareActive = (s, now = Date.now()) => !s.revokedAt && Date.parse(s.expiresAt) > now;

// A home batch is shared to be fetched, not to be kept: once every link that was
// not revoked by hand has run out, its files go. A batch whose links were all
// revoked stays, for the owner to delete or share again.
export function sharesExpired(b, now = Date.now()) {
  if (!b.home || b.deletedAt) return false;
  const live = (b.shares ?? []).filter((s) => !s.revokedAt);
  return live.length > 0 && live.every((s) => Date.parse(s.expiresAt) <= now);
}

// Every upload tus knows about, finished or not, read from FileStore's sidecar
// <id>.json files. This is what the space guard counts.
export class UploadIndex {
  constructor(dir) {
    this.dir = dir;
    this.map = new Map();
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      try {
        const u = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
        const size = Number(u.size);
        const done = this.bytesOnDisk(id) >= size;
        this.map.set(id, { size, batchId: u.metadata?.batchId ?? null, done, addedAt: Date.now() });
      } catch (err) {
        console.error(`skipping unreadable upload ${f}: ${err.message}`);
      }
    }
    return this;
  }

  bytesOnDisk(id) {
    try {
      return fs.statSync(path.join(this.dir, id)).size;
    } catch {
      return 0;
    }
  }

  lastWrite(id) {
    try {
      return fs.statSync(path.join(this.dir, id)).mtimeMs;
    } catch {
      return 0;
    }
  }

  add(id, size, batchId) {
    this.map.set(id, { size, batchId, done: false, addedAt: Date.now() });
  }

  finish(id) {
    const u = this.map.get(id);
    if (u) u.done = true;
  }

  committed() {
    let n = 0;
    for (const u of this.map.values()) n += u.size;
    return n;
  }

  pending() {
    let n = 0;
    for (const [id, u] of this.map) if (!u.done) n += Math.max(0, u.size - this.bytesOnDisk(id));
    return n;
  }

  inFlight(batchId) {
    return [...this.map].filter(([, u]) => !u.done && u.batchId === batchId).map(([id]) => id);
  }

  path(id) {
    return path.join(this.dir, id);
  }

  remove(id) {
    this.map.delete(id);
    fs.rmSync(path.join(this.dir, id), { force: true });
    fs.rmSync(path.join(this.dir, `${id}.json`), { force: true });
  }
}
