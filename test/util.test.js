import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanFilename,
  contentDisposition,
  parseRange,
  uniqueNames,
  spaceVerdict,
  humanSize,
  RateLimiter,
  geoFromHeaders,
  placeName,
  senderLabel,
} from '../src/util.js';

test('cleanFilename strips paths and control characters', () => {
  assert.equal(cleanFilename('../../etc/passwd'), 'passwd');
  assert.equal(cleanFilename('C:\\Users\\x\\report.pdf'), 'report.pdf');
  assert.equal(cleanFilename('a\u0000b\nc.txt'), 'abc.txt');
  assert.equal(cleanFilename(''), 'file');
  assert.equal(cleanFilename('..'), 'file');
  assert.equal(cleanFilename(undefined), 'file');
  const long = cleanFilename('x'.repeat(300) + '.jpeg');
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('.jpeg'));
});

test('contentDisposition keeps unicode in filename*', () => {
  const h = contentDisposition('árvíztűrő "tükör".pdf');
  assert.match(h, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  assert.ok(h.includes(encodeURIComponent('árvíztűrő')));
});

test('parseRange', () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=50-1000', 100), { start: 50, end: 99 });
  assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-1,5-6', 100), null);
});

test('uniqueNames dedupes case-insensitively', () => {
  assert.deepEqual(uniqueNames(['a.txt', 'A.txt', 'a.txt', 'b']), ['a.txt', 'A (2).txt', 'a (3).txt', 'b']);
});

test('spaceVerdict', () => {
  const G = 1024 ** 3;
  const limits = { maxFileSize: 10 * G, maxTotal: 100 * G, minFree: 50 * G };
  const ok = { size: G, free: 500 * G, committed: 0, pending: 0 };
  assert.deepEqual(spaceVerdict(ok, limits), { ok: true });
  assert.equal(spaceVerdict({ ...ok, size: 11 * G }, limits).reason, 'file-too-large');
  assert.equal(spaceVerdict({ ...ok, committed: 99.5 * G }, limits).reason, 'quota');
  assert.equal(spaceVerdict({ ...ok, free: 50.5 * G }, limits).reason, 'disk');
  // Bytes already promised to uploads in flight count against free space.
  assert.equal(spaceVerdict({ ...ok, free: 60 * G, pending: 10 * G }, limits).reason, 'disk');
  assert.equal(spaceVerdict({ ...ok, size: NaN }, limits).reason, 'size-unknown');
});

test('humanSize', () => {
  assert.equal(humanSize(0), '0 B');
  assert.equal(humanSize(1536), '1.5 KB');
  assert.equal(humanSize(10 * 1024 ** 3), '10.0 GB');
});

test('RateLimiter', () => {
  const rl = new RateLimiter(2, 1000);
  assert.ok(rl.allow('ip', 0));
  assert.ok(rl.allow('ip', 1));
  assert.ok(!rl.allow('ip', 2));
  assert.ok(rl.allow('other', 2));
  assert.ok(rl.allow('ip', 1000));
});

test('geoFromHeaders reads Cloudflare location headers', () => {
  assert.deepEqual(geoFromHeaders({ 'cf-ipcountry': 'HU' }), { city: null, region: null, country: 'HU' });
  assert.deepEqual(geoFromHeaders({ 'cf-ipcountry': 'hu', 'cf-ipcity': 'Budapest', 'cf-region': 'Budapest' }), {
    city: 'Budapest',
    region: 'Budapest',
    country: 'HU',
  });
  assert.equal(geoFromHeaders({}), null);
  assert.equal(geoFromHeaders({ 'cf-ipcountry': 'XX' }), null);
  assert.equal(geoFromHeaders({ 'cf-ipcountry': '<script>' }), null);
  // UTF-8 bytes as Node hands them over (latin1-decoded).
  const raw = Buffer.from('São Paulo', 'utf8').toString('latin1');
  assert.equal(geoFromHeaders({ 'cf-ipcity': raw }).city, 'São Paulo');
});

test('placeName and senderLabel', () => {
  assert.equal(placeName({ city: 'Budapest', region: 'Budapest', country: 'HU' }), 'Budapest, Hungary');
  assert.equal(placeName({ city: 'Graz', region: 'Styria', country: 'AT' }), 'Graz, Styria, Austria');
  assert.equal(placeName({ city: null, region: null, country: 'T1' }), 'Tor');
  assert.equal(placeName(null), null);
  assert.equal(senderLabel({ ip: '1.2.3.4', geo: { city: null, region: null, country: 'DE' } }), '1.2.3.4 (Germany)');
  assert.equal(senderLabel({ ip: '1.2.3.4' }), '1.2.3.4');
  assert.equal(senderLabel({}), 'unknown');
});
