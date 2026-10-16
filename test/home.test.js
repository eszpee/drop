import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HomeDetector, parseTrace } from '../src/home.js';

function setup(answers) {
  let t = 0;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return { ok: true, text: async () => `fl=1\nh=1.1.1.1\nip=${a}\nts=1\n` };
  };
  const d = new HomeDetector({ lookupUrl: 'https://trace', recheckMs: 60_000, fetchImpl, now: () => t });
  return { d, calls, advance: (ms) => (t += ms) };
}

test('parseTrace reads the ip= line', () => {
  assert.equal(parseTrace('fl=x\nip=86.59.163.158\nts=1'), '86.59.163.158');
  assert.equal(parseTrace('ip=2a00::1\n'), '2a00::1');
  assert.equal(parseTrace('nothing here'), null);
});

test('a matching visitor needs no lookup after the first', async () => {
  const { d, calls } = setup(['1.2.3.4']);
  assert.equal(await d.isHome('1.2.3.4'), true);
  assert.equal(await d.isHome('1.2.3.4'), true);
  assert.equal(calls.length, 1);
});

test('strangers trigger at most one lookup per interval', async () => {
  const { d, calls, advance } = setup(['1.2.3.4', '1.2.3.4']);
  assert.equal(await d.isHome('9.9.9.9'), false);
  assert.equal(await d.isHome('8.8.8.8'), false);
  advance(30_000);
  assert.equal(await d.isHome('7.7.7.7'), false);
  assert.equal(calls.length, 1);
  advance(31_000);
  assert.equal(await d.isHome('7.7.7.7'), false);
  assert.equal(calls.length, 2);
});

test('a changed home address is picked up on the next mismatch', async () => {
  const { d, advance } = setup(['1.2.3.4', '5.6.7.8']);
  assert.equal(await d.isHome('1.2.3.4'), true);
  advance(61_000);
  assert.equal(await d.isHome('5.6.7.8'), true);
  assert.equal(await d.isHome('1.2.3.4'), false);
});

test('a failed lookup keeps the last address, and none known means nobody is home', async () => {
  const { d, advance } = setup([new Error('down'), '1.2.3.4', new Error('down')]);
  assert.equal(await d.isHome('1.2.3.4'), false);
  advance(61_000);
  assert.equal(await d.isHome('1.2.3.4'), true);
  advance(61_000);
  assert.equal(await d.isHome('9.9.9.9'), false);
  assert.equal(await d.isHome('1.2.3.4'), true);
});

test('concurrent mismatches share one lookup', async () => {
  const { d, calls } = setup(['1.2.3.4']);
  const r = await Promise.all([d.isHome('1.2.3.4'), d.isHome('9.9.9.9'), d.isHome('1.2.3.4')]);
  assert.deepEqual(r, [true, false, true]);
  assert.equal(calls.length, 1);
});

test('disabled without a lookup URL', async () => {
  const d = new HomeDetector({ lookupUrl: '', recheckMs: 1 });
  assert.equal(await d.isHome('1.2.3.4'), false);
});

test('home batches go when every unrevoked share link has run out', async () => {
  const { sharesExpired } = await import('../src/store.js');
  const past = '2026-01-01T00:00:00Z';
  const future = '2999-01-01T00:00:00Z';
  const now = Date.parse('2026-06-01T00:00:00Z');
  const b = (home, shares) => ({ home, deletedAt: null, shares });
  assert.equal(sharesExpired(b(true, []), now), false);
  assert.equal(sharesExpired(b(true, [{ expiresAt: past }]), now), true);
  assert.equal(sharesExpired(b(true, [{ expiresAt: past }, { expiresAt: future }]), now), false);
  assert.equal(sharesExpired(b(true, [{ expiresAt: future, revokedAt: past }]), now), false);
  assert.equal(sharesExpired(b(true, [{ expiresAt: past }, { expiresAt: future, revokedAt: past }]), now), true);
  assert.equal(sharesExpired(b(false, [{ expiresAt: past }]), now), false);
});
