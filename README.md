# drop

A public "send me files" page. Anyone can drag files onto it; nobody but the
owner can get them back out.

- Drag-and-drop upload ([Uppy](https://uppy.io)) over [tus](https://tus.io): 50 MB
  chunks, automatic retries, resume after a dropped connection or a reloaded tab.
- The uploader gets nothing back: no list, no links, no delete.
- When a send finishes, the owner gets an email with a link to a private page for
  that send: download each file or all of them as a .zip, then delete them from the
  server.
- The link is the only credential (a random 192-bit token). There is no login.

## Guards

Because the page is open to anyone, the app protects the disk it writes to:

| Setting | Default | Meaning |
|---|---|---|
| `MAX_FILE_SIZE` | `50G` | Largest single file |
| `MAX_TOTAL` | `500G` | Everything stored, including uploads in progress |
| `MIN_FREE` | `300G` | Refuse any upload that would leave less than this free on the volume |

Space is reserved at the moment an upload is *created*, from its declared length,
so several concurrent uploads cannot jointly overrun the limits. When an upload is
refused for space, the owner is emailed (at most twice a day).

`DATA_DIR` must contain a `.drop-volume` marker file. If the volume is not mounted,
the marker is missing, so the app refuses uploads and `/healthz` returns 503,
rather than filling the disk underneath the mount point.

Also: 30 new sends and 500 new files per hour per client IP (`CF-Connecting-IP`),
at most 200 files per send. Partial uploads that are not resumed within 7 days are
removed.

## Notifications

The email goes out through an [Apprise API](https://github.com/caronc/apprise-api)
server: `APPRISE_URL` is its `/notify/<key>` endpoint, and `APPRISE_TAG` selects the
target (default `email`). Without `APPRISE_URL`, notifications are only logged.

A send is announced when the uploader's page reports it finished. If the page never
does (the tab was closed), it is announced after 30 quiet minutes
(`IDLE_NOTIFY_MINUTES`). If more files arrive later, another email follows.

## Running

```bash
npm ci
mkdir -p data && touch data/.drop-volume
DATA_DIR=./data PUBLIC_URL=http://localhost:3000 npm start
npm test
```

In Docker, see `compose.yaml`. It expects a reverse proxy on an existing network
(`DROP_NETWORK`) and an absolute host path for the data (`DROP_DATA_DIR`). The proxy
must allow request bodies of at least 50 MB, and should not buffer them.

## Storage layout

```
DATA_DIR/
  .drop-volume          marker; required
  uploads/<id>          file contents (tus FileStore)
  uploads/<id>.json     tus metadata: size, filename, batch
  batches/<batch>.json  one per send: owner token, file list, notification state
```
