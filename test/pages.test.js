import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate } from '../src/pages.js';

test('fmtDate follows TZ', () => {
  const orig = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Tokyo';
    assert.match(fmtDate('2026-01-01T00:00:00Z'), /09:00/);
    process.env.TZ = 'UTC';
    assert.match(fmtDate('2026-01-01T00:00:00Z'), /00:00/);
  } finally {
    if (orig === undefined) delete process.env.TZ;
    else process.env.TZ = orig;
  }
});
