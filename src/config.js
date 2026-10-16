import path from 'node:path';

const GB = 1024 ** 3;

function bytes(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const m = /^(\d+(?:\.\d+)?)\s*([KMGT]?)B?$/i.exec(raw.trim());
  if (!m) throw new Error(`${name}: cannot parse "${raw}" as a size (e.g. 10G)`);
  const unit = { '': 1, K: 1024, M: 1024 ** 2, G: GB, T: 1024 ** 4 }[m[2].toUpperCase()];
  return Math.floor(Number(m[1]) * unit);
}

const dataDir = process.env.DATA_DIR || '/data';

export const config = {
  port: Number(process.env.PORT || 3000),
  dataDir,
  uploadsDir: path.join(dataDir, 'uploads'),
  batchesDir: path.join(dataDir, 'batches'),
  // A file that must exist in DATA_DIR. If the volume behind it is not mounted, the
  // marker is missing and the app refuses uploads instead of filling whatever disk
  // happens to sit under the mount point.
  markerFile: path.join(dataDir, '.drop-volume'),
  requireMarker: process.env.REQUIRE_MARKER !== '0',
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  // Who the upload page says it is for.
  ownerName: process.env.OWNER_NAME || 'me',
  appriseUrl: process.env.APPRISE_URL || '',
  appriseTag: process.env.APPRISE_TAG || 'email',
  maxFileSize: bytes('MAX_FILE_SIZE', 50 * GB),
  // Upper bound for everything stored here, finished or in flight.
  maxTotal: bytes('MAX_TOTAL', 500 * GB),
  // Uploads are refused if accepting one would leave less than this free on the volume.
  minFree: bytes('MIN_FREE', 300 * GB),
  maxFilesPerBatch: Number(process.env.MAX_FILES_PER_BATCH || 200),
  // A batch whose uploader never pressed "done" (closed the tab) is announced after
  // this much silence, so nothing that finished goes unnoticed.
  idleNotifyMs: Number(process.env.IDLE_NOTIFY_MINUTES || 30) * 60_000,
  // Half-finished uploads nobody resumed are removed after this long.
  staleUploadMs: Number(process.env.STALE_UPLOAD_DAYS || 7) * 86_400_000,
  sweepIntervalMs: 5 * 60_000,
};
