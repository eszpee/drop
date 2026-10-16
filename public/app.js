import { Uppy, Dashboard, DropTarget, Tus, GoldenRetriever } from '/vendor/uppy.min.mjs';

// Under Cloudflare's 100 MB request-body cap, with room to spare.
const CHUNK = 50 * 1024 * 1024;
const BATCH_KEY = 'drop.batchId';

const $ = (id) => document.getElementById(id);
const storage = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {}
  },
};

function humanSize(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 || n >= 100 ? 0 : 1)} ${u[i]}`;
}

const cfg = await fetch('/api/config')
  .then((r) => r.json())
  .catch(() => ({ accepting: false }));

if (cfg.owner) $('owner').textContent = cfg.owner;

if (!cfg.accepting) {
  $('uploader').hidden = true;
  $('closed').hidden = false;
} else {
  start(cfg);
}

function start(cfg) {
  $('limits').textContent = `MAX ${humanSize(cfg.maxFileSize)} PER FILE · ${cfg.maxFiles} FILES PER SEND · NO LOGIN NEEDED`;

  const uppy = new Uppy({
    autoProceed: false,
    restrictions: { maxFileSize: cfg.maxFileSize, maxNumberOfFiles: cfg.maxFiles },
  })
    .use(Dashboard, {
      target: '#uploader',
      inline: true,
      width: '100%',
      height: 420,
      theme: 'dark',
      locale: {
        strings: {
          dropPasteBoth: 'Drop files here — or %{browseFiles} / %{browseFolders}',
          dropPasteFiles: 'Drop files here — or %{browseFiles}',
          browseFiles: 'browse files',
          browseFolders: 'browse folders',
          dropHint: 'Release to transmit',
          uploadXFiles: { 0: 'Send %{smart_count} file', 1: 'Send %{smart_count} files' },
          xFilesSelected: { 0: '%{smart_count} file queued', 1: '%{smart_count} files queued' },
          uploading: 'Transmitting',
          complete: 'Complete',
        },
      },
      proudlyDisplayPoweredByUppy: false,
      fileManagerSelectionType: 'both',
      showRemoveButtonAfterComplete: false,
      doneButtonHandler: null,
      note: null,
    })
    // The whole page is a drop zone, not only the box.
    .use(DropTarget, { target: document.body })
    .use(Tus, {
      endpoint: '/files/',
      chunkSize: CHUNK,
      limit: 3,
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000, 60000],
      allowedMetaFields: ['batchId', 'name', 'type'],
      removeFingerprintOnSuccess: true,
      // These answers will not change by retrying: too big, out of room, bad batch.
      onShouldRetry(err, attempt, opts, next) {
        const status = err?.originalResponse?.getStatus?.();
        if ([400, 413, 507].includes(status)) return false;
        return next(err);
      },
    })
    // Survives a reload or a crashed tab: the selection and progress come back and
    // tus resumes from the last chunk the server has.
    .use(GoldenRetriever, { expires: 7 * 24 * 3600 * 1000 });

  // Every file of one send belongs to one batch, created on the first upload and
  // remembered across reloads until the send completes.
  uppy.addPreProcessor(async (fileIDs) => {
    let batchId = storage.get(BATCH_KEY);
    if (!batchId) {
      const res = await fetch('/api/batches', { method: 'POST' });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).error || 'Upload is not possible right now.';
        uppy.info(msg, 'error', 8000);
        throw new Error(msg);
      }
      batchId = (await res.json()).id;
      storage.set(BATCH_KEY, batchId);
    }
    for (const id of fileIDs) {
      if (!uppy.getFile(id).meta.batchId) uppy.setFileMeta(id, { batchId });
    }
  });

  uppy.on('complete', async (result) => {
    if (!result.successful?.length || result.failed?.length) return;
    const batchId = result.successful[0].meta.batchId;
    // Even if this call is lost, the server announces the batch on its own once
    // it has been quiet for a while.
    await fetch(`/api/batches/${batchId}/complete`, { method: 'POST' }).catch(() => {});
    storage.set(BATCH_KEY, null);
    const n = result.successful.length;
    $('done-text').textContent = `${n} file${n === 1 ? '' : 's'} received intact. Nothing else to do. You can close this window.`;
    $('uploader').hidden = true;
    $('done').hidden = false;
  });

  $('again').addEventListener('click', () => {
    uppy.clear();
    $('done').hidden = true;
    $('uploader').hidden = false;
  });

  // A page closed mid-upload would lose the rest; ask first.
  window.addEventListener('beforeunload', (ev) => {
    const busy = uppy.getFiles().some((f) => f.progress.uploadStarted && !f.progress.uploadComplete);
    if (busy) ev.preventDefault();
  });
}
