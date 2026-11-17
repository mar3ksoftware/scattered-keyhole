import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSocket } from './socket';

test('socket module loads under node', () => {
  const s = getSocket();
  assert.equal(s.connected, false);
  s.io.engine?.close();
});
