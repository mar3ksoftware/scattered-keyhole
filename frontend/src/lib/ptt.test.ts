import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPttController, isTypingTarget } from './ptt';

test('push-to-talk starts muted and opens only while the key is held', () => {
  const muted: boolean[] = [];
  const controller = createPttController({
    pttKey: 'Space',
    ptmKey: '',
    onChange: (snapshot) => muted.push(snapshot.muted),
  });

  assert.equal(controller.snapshot().mode, 'ptt');
  assert.equal(controller.snapshot().muted, true);

  assert.equal(controller.keyDown('Space'), true);
  assert.equal(controller.snapshot().muted, false);

  assert.equal(controller.keyUp('Space'), true);
  assert.equal(controller.snapshot().muted, true);
  assert.deepEqual(muted, [false, true]);
});

test('push-to-mute starts open and mutes only while the key is held', () => {
  const controller = createPttController({ pttKey: '', ptmKey: 'KeyM' });

  assert.equal(controller.snapshot().mode, 'ptm');
  assert.equal(controller.snapshot().muted, false);

  assert.equal(controller.keyDown('KeyM'), true);
  assert.equal(controller.snapshot().muted, true);

  assert.equal(controller.keyUp('KeyM'), true);
  assert.equal(controller.snapshot().muted, false);
});

test('key repeat and unrelated keys never change the mute state', () => {
  const controller = createPttController({ pttKey: 'Space', ptmKey: '' });

  assert.equal(controller.keyDown('Space', true), false);
  assert.equal(controller.snapshot().muted, true);
  assert.equal(controller.keyDown('KeyQ'), false);
  assert.equal(controller.snapshot().muted, true);
  assert.equal(controller.keyUp('KeyQ'), false);
  assert.equal(controller.snapshot().muted, true);
});

test('unbound keys leave the mic under manual control', () => {
  const controller = createPttController({ pttKey: '', ptmKey: '' });

  assert.equal(controller.snapshot().mode, 'off');
  assert.equal(controller.snapshot().muted, false);
  assert.equal(controller.keyDown('Space'), false);

  controller.toggleManualMuted();
  assert.equal(controller.snapshot().muted, true);
  controller.toggleManualMuted();
  assert.equal(controller.snapshot().muted, false);
});

test('manual mute is a baseline that push-to-talk cannot override', () => {
  const controller = createPttController({ pttKey: 'Space', ptmKey: '', manualMuted: true });

  assert.equal(controller.snapshot().muted, true);
  controller.keyDown('Space');
  assert.equal(controller.snapshot().muted, true, 'manual mute wins over a held key');

  controller.setManualMuted(false);
  assert.equal(controller.snapshot().muted, false, 'still held, now audible');

  controller.keyUp('Space');
  assert.equal(controller.snapshot().muted, true);
});

test('releaseAll closes the mic after a window blur', () => {
  const controller = createPttController({ pttKey: 'Space', ptmKey: '' });
  controller.keyDown('Space');
  assert.equal(controller.snapshot().muted, false);

  controller.releaseAll();
  assert.equal(controller.snapshot().muted, true);
  assert.equal(controller.snapshot().held, false);
});

test('rebinding switches modes and drops the held state', () => {
  const controller = createPttController({ pttKey: 'Space', ptmKey: '' });
  controller.keyDown('Space');

  controller.setBindings('', 'KeyM');
  assert.equal(controller.snapshot().mode, 'ptm');
  assert.equal(controller.snapshot().held, false);
  assert.equal(controller.snapshot().muted, false);
});

test('typing targets are recognised without a DOM', () => {
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: 'textarea' } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: 'DIV' } as unknown as EventTarget), false);
  assert.equal(
    isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget),
    true,
  );
});
