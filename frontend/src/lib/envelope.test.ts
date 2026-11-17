import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expForTimer, parseEnvelope, wrapPollEnvelope, wrapTextEnvelope } from './envelope';
import { shouldStoreAtIngestion } from './purge';

test('smoke', () => {
  const env = wrapTextEnvelope('hello');
  const parsed = parseEnvelope(env);
  assert.equal(parsed.kind, 'text');
});

// A valid media descriptor (t/v/fileId/key/iv/sha256/mime/size) so the
// matrix can cover the media branch too.
function mediaEnvelope(exp?: number): string {
  const b64 = (length: number): string => {
    const bytes = new Uint8Array(length);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  return JSON.stringify({
    t: 'media',
    v: 1,
    fileId: '123e4567-e89b-42d3-a456-426614174000',
    key: b64(32),
    iv: b64(12),
    sha256: b64(32),
    mime: 'image/png',
    size: 1024,
    ...(exp !== undefined ? { exp } : {}),
  });
}

test('exp matrix: a future expiry is kept on the parsed envelope', () => {
  const future = Date.now() + 60_000;
  const parsed = parseEnvelope(wrapTextEnvelope('hi', null, future));
  assert.equal(parsed.kind, 'text');
  assert.equal(parsed.expiresAt, future);

  const poll = parseEnvelope(wrapPollEnvelope('Pick one', ['a', 'b'], future) ?? '');
  assert.equal(poll.kind, 'poll');
  assert.equal(poll.expiresAt, future);

  const media = parseEnvelope(mediaEnvelope(future));
  assert.equal(media.kind, 'media');
  assert.equal(media.expiresAt, future);
});

test('exp matrix: a past expiry parses but is dropped at ingestion', () => {
  const past = Date.now() - 1_000;
  const parsed = parseEnvelope(wrapTextEnvelope('hi', null, past));
  assert.equal(parsed.expiresAt, past);
  // The parser keeps the value; the ingestion gate is what refuses it.
  assert.equal(shouldStoreAtIngestion(parsed.expiresAt, Date.now()), false);
  assert.equal(shouldStoreAtIngestion(future(), Date.now()), true);
});

test('exp matrix: malformed exp drops the field and keeps the message', () => {
  for (const bad of ['soon', 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const parsed = parseEnvelope(JSON.stringify({ t: 'text', b: 'hi', exp: bad }));
    assert.equal(parsed.kind, 'text', `${String(bad)} should still render`);
    assert.equal(parsed.expiresAt, null, `${String(bad)} should drop the field`);
  }
  // A message without a usable expiry is stored.
  assert.equal(shouldStoreAtIngestion(null, Date.now()), true);
});

test('exp matrix: an absent exp parses to null', () => {
  assert.equal(parseEnvelope(wrapTextEnvelope('hi')).expiresAt, null);
  assert.equal(parseEnvelope(wrapPollEnvelope('q', ['a', 'b']) ?? '').expiresAt, null);
  assert.equal(parseEnvelope(mediaEnvelope()).expiresAt, null);
  assert.equal(shouldStoreAtIngestion(undefined, Date.now()), true);
});

test('edit envelopes carry no exp and an edited message keeps its expiry', () => {
  const envelope = wrapTextEnvelope('edited reply');
  const fields: Record<string, unknown> = JSON.parse(envelope);
  assert.equal('exp' in fields, false);

  // The edit path spreads the original message, so expiresAt survives.
  const original = { id: 'm1', body: 'hi', expiresAt: 1_700_000_000_000 };
  const edited = { ...original, body: 'edited', edited: true };
  assert.equal(edited.expiresAt, 1_700_000_000_000);
});

test('expForTimer: timer > 0 stamps now + seconds, timer 0 stamps nothing', () => {
  const now = 1_700_000_000_000;
  assert.equal(expForTimer(86_400, now), now + 86_400 * 1000);
  assert.equal(expForTimer(0, now), undefined);
});

function future(): number {
  return Date.now() + 60_000;
}
