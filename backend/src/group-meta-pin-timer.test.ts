import { Database } from 'bun:sqlite';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Server as Engine } from '@socket.io/bun-engine';
import pino from 'pino';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';

import { AccountStore } from './account-store';
import { DmSettingsStore } from './dm-settings-store';
import { GroupStore } from './group-store';
import { KickVoteStore } from './kick-vote-store';
import { TombstoneStore } from './tombstone-store';
import { MediaAuth } from './media-auth';
import { ProfileStore } from './profile-store';
import { RateLimiterRegistry } from './rate-limiter';
import { createServer } from './server';
import type {
  ClientToServerEvents,
  DisappearingChangedPayload,
  ErrorPayload,
  GroupInfo,
  GroupUpdatedPayload,
  MessagePinnedPayload,
  MessageRejectedPayload,
  ServerToClientEvents,
  UserInfo,
  UserLeftPayload,
} from './types';
import { CONSTANTS, EVENTS, UserId } from './types';
import { UserDirectory } from './user-directory';
import { UserRegistry } from './user-registry';
import { validateDisappearingSetPayload } from './validators';

type TestClient = ReturnType<typeof Client>;

function makeUrl(port: number): string {
  return `http://localhost:${port}`;
}

function createClient(port: number) {
  return Client(makeUrl(port), {
    path: '/socket.io/',
    autoConnect: false,
    reconnection: false,
    timeout: 5000,
    forceNew: true,
  });
}

async function connect(client: TestClient): Promise<void> {
  const promise = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
    client.once('connect', () => {
      clearTimeout(t);
      resolve();
    });
    client.once('connect_error', (err: Error) => {
      clearTimeout(t);
      reject(err);
    });
  });
  client.connect();
  await promise;
}

function waitEvent<T>(client: TestClient, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`event "${event}" timeout`)), 5000);
    client.once(event, (data: T) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function join(
  client: TestClient,
  username: string,
): Promise<{ users: readonly UserInfo[]; groups: readonly GroupInfo[] }> {
  const usersPromise = waitEvent<readonly UserInfo[]>(client, EVENTS.SERVER.ACTIVE_USERS);
  const groupsPromise = waitEvent<readonly GroupInfo[]>(client, EVENTS.SERVER.ACTIVE_GROUPS);
  client.emit(EVENTS.CLIENT.USER_JOIN, { username });
  const [users, groups] = await Promise.all([usersPromise, groupsPromise]);
  return { users, groups };
}

async function createGroup(
  creator: TestClient,
  name: string,
  members: readonly string[],
  description?: string,
): Promise<GroupInfo> {
  const groupPromise = waitEvent<GroupInfo>(creator, EVENTS.SERVER.GROUP_CREATED);
  creator.emit(EVENTS.CLIENT.GROUP_CREATE, {
    name,
    members: [...members],
    ...(description !== undefined ? { description } : {}),
  });
  return groupPromise;
}

// Valid sender-generated UUID used as a relay target/message id.
const TARGET_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const UNKNOWN_GROUP_ID = '11111111-2222-4333-8444-555555555555';

describe('Tier-3 group metadata, pins, and disappearing timers', () => {
  let io: Server<ClientToServerEvents, ServerToClientEvents>;
  let engine: Engine;
  let userRegistry: UserRegistry;
  let rateLimiters: RateLimiterRegistry;
  let db: Database;
  let accountStore: AccountStore;
  let groupStore: GroupStore;
  let userDirectory: UserDirectory;
  let kickVoteStore: KickVoteStore;
  let mediaAuth: MediaAuth;
  let profileStore: ProfileStore;
  let dmSettingsStore: DmSettingsStore;
  let bunServer: ReturnType<typeof Bun.serve>;
  let port: number;
  const clients: TestClient[] = [];

  // Three joined members in one fresh group: an admin creator plus two
  // plain members, used by the fan-out and permission tests.
  async function trio(
    prefix: string,
  ): Promise<readonly [TestClient, TestClient, TestClient, GroupInfo]> {
    const a = createClient(port);
    const b = createClient(port);
    const c = createClient(port);
    clients.push(a, b, c);
    await Promise.all([connect(a), connect(b), connect(c)]);
    await join(a, `${prefix}a`);
    await join(b, `${prefix}b`);
    await join(c, `${prefix}c`);
    const group = await createGroup(a, `${prefix} group`, [`${prefix}b`, `${prefix}c`]);
    return [a, b, c, group];
  }

  // A clean namespace disconnect frees the username, so a fresh socket can
  // join under the same name and pull a fresh snapshot. DM timers replayed
  // during that join are collected alongside it.
  async function leaveAndRejoin(
    old: TestClient,
    username: string,
    observer: TestClient,
  ): Promise<{
    client: TestClient;
    users: readonly UserInfo[];
    groups: readonly GroupInfo[];
    heals: DisappearingChangedPayload[];
  }> {
    const left = waitEvent<UserLeftPayload>(observer, EVENTS.SERVER.USER_LEFT);
    old.disconnect();
    await left;

    const fresh = createClient(port);
    clients.push(fresh);
    await connect(fresh);
    const usersPromise = waitEvent<readonly UserInfo[]>(fresh, EVENTS.SERVER.ACTIVE_USERS);
    const groupsPromise = waitEvent<readonly GroupInfo[]>(fresh, EVENTS.SERVER.ACTIVE_GROUPS);
    const heals: DisappearingChangedPayload[] = [];
    fresh.on(EVENTS.SERVER.DISAPPEARING_CHANGED, (payload: DisappearingChangedPayload) => {
      heals.push(payload);
    });
    fresh.emit(EVENTS.CLIENT.USER_JOIN, { username });
    const [users, groups] = await Promise.all([usersPromise, groupsPromise]);
    await delay(200);
    return { client: fresh, users, groups, heals };
  }

  beforeAll(() => {
    io = new Server<ClientToServerEvents, ServerToClientEvents>();
    engine = new Engine({ path: '/socket.io/' });
    io.bind(engine);
    userRegistry = new UserRegistry();
    rateLimiters = new RateLimiterRegistry();
    db = new Database(':memory:');
    accountStore = new AccountStore(db);
    groupStore = new GroupStore();
    userDirectory = new UserDirectory(db);
    kickVoteStore = new KickVoteStore();
    mediaAuth = new MediaAuth();
    profileStore = new ProfileStore();
    dmSettingsStore = new DmSettingsStore();
    const tombstoneStore = new TombstoneStore();
    createServer(
      io,
      userRegistry,
      rateLimiters,
      accountStore,
      groupStore,
      userDirectory,
      kickVoteStore,
      mediaAuth,
      profileStore,
      dmSettingsStore,
      tombstoneStore,
      pino({ level: 'silent' }),
    );

    const handler = engine.handler();
    bunServer = Bun.serve({
      port: 0,
      idleTimeout: 30,
      fetch: handler.fetch,
      websocket: handler.websocket,
    });
    const assignedPort = bunServer.port;
    if (assignedPort === undefined) {
      throw new Error('no port assigned');
    }
    port = assignedPort;
  });

  afterAll(() => {
    for (const c of clients) {
      if (c.connected) {
        c.disconnect();
      }
    }
    clients.length = 0;
    io.close();
    bunServer.stop();
    userRegistry.destroy();
    kickVoteStore.destroy();
    mediaAuth.destroy();
    profileStore.destroy();
    dmSettingsStore.destroy();
    rateLimiters.destroy();
    accountStore.destroy();
    groupStore.destroy();
  });

  afterEach(() => {
    for (const c of clients) {
      if (c.connected) {
        c.disconnect();
      }
    }
    clients.length = 0;
  });

  // ── group:update / group:updated ─────────────────────────────────────

  test('GU1: an admin update reaches every member, actor included', async () => {
    const [a, b, c, group] = await trio('gu1_');

    const forA = waitEvent<GroupUpdatedPayload>(a, EVENTS.SERVER.GROUP_UPDATED);
    const forB = waitEvent<GroupUpdatedPayload>(b, EVENTS.SERVER.GROUP_UPDATED);
    const forC = waitEvent<GroupUpdatedPayload>(c, EVENTS.SERVER.GROUP_UPDATED);
    a.emit(EVENTS.CLIENT.GROUP_UPDATE, {
      groupId: group.groupId,
      name: 'Renamed crew',
      description: 'We plan trips',
    });

    const payloads = await Promise.all([forA, forB, forC]);
    for (const payload of payloads) {
      expect(Object.keys(payload).sort()).toEqual([
        'description',
        'groupId',
        'name',
        'timestamp',
        'u',
      ]);
      expect(payload.groupId).toBe(group.groupId);
      expect(payload.name).toBe('Renamed crew');
      expect(payload.description).toBe('We plan trips');
      expect(payload.u).toBe('gu1_a');
      expect(Number.isInteger(payload.timestamp)).toBe(true);
    }
  });

  test('GU2: the updated values show up in the next active_groups snapshot', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'gu2_a');
    await join(b, 'gu2_b');
    const group = await createGroup(a, 'Gu2 group', ['gu2_b']);

    const updated = waitEvent<GroupUpdatedPayload>(a, EVENTS.SERVER.GROUP_UPDATED);
    a.emit(EVENTS.CLIENT.GROUP_UPDATE, {
      groupId: group.groupId,
      name: 'Gu2 renamed',
      description: 'Gu2 description',
    });
    await updated;

    const { groups } = await leaveAndRejoin(b, 'gu2_b', a);
    const snapshot = groups.find((g) => g.groupId === group.groupId);
    expect(snapshot?.name).toBe('Gu2 renamed');
    expect(snapshot?.description).toBe('Gu2 description');
    expect(snapshot?.disappearing).toBe(0);
  });

  test('GU3: a name-only update keeps the description', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'gu3_a');
    await join(b, 'gu3_b');
    const group = await createGroup(a, 'Gu3 group', ['gu3_b'], 'Original blurb');

    const forA = waitEvent<GroupUpdatedPayload>(a, EVENTS.SERVER.GROUP_UPDATED);
    const forB = waitEvent<GroupUpdatedPayload>(b, EVENTS.SERVER.GROUP_UPDATED);
    a.emit(EVENTS.CLIENT.GROUP_UPDATE, { groupId: group.groupId, name: 'Gu3 renamed' });

    const [payloadA, payloadB] = await Promise.all([forA, forB]);
    for (const payload of [payloadA, payloadB]) {
      expect(payload.name).toBe('Gu3 renamed');
      expect(payload.description).toBe('Original blurb');
    }
  });

  test('GU4: a description-only update keeps the name', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'gu4_a');
    await join(b, 'gu4_b');
    const group = await createGroup(a, 'Gu4 group', ['gu4_b'], 'Original blurb');

    const forA = waitEvent<GroupUpdatedPayload>(a, EVENTS.SERVER.GROUP_UPDATED);
    const forB = waitEvent<GroupUpdatedPayload>(b, EVENTS.SERVER.GROUP_UPDATED);
    a.emit(EVENTS.CLIENT.GROUP_UPDATE, {
      groupId: group.groupId,
      description: 'Fresh blurb',
    });

    const [payloadA, payloadB] = await Promise.all([forA, forB]);
    for (const payload of [payloadA, payloadB]) {
      expect(payload.name).toBe('Gu4 group');
      expect(payload.description).toBe('Fresh blurb');
    }
  });

  test('GU5: a member without admin rights gets the exact admin error', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'gu5_a');
    await join(b, 'gu5_b');
    const group = await createGroup(a, 'Gu5 group', ['gu5_b']);

    const rejected = waitEvent<ErrorPayload>(b, EVENTS.SERVER.ERROR);
    b.emit(EVENTS.CLIENT.GROUP_UPDATE, { groupId: group.groupId, name: 'Hijacked' });
    const payload = await rejected;
    expect(payload.message).toBe('Only admins can update group info');
  });

  test('GU6: a non-member update is rejected', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'gu6_a');
    await join(b, 'gu6_b');
    const group = await createGroup(a, 'Gu6 group', []);

    const rejected = waitEvent<MessageRejectedPayload>(b, EVENTS.SERVER.MESSAGE_REJECTED);
    b.emit(EVENTS.CLIENT.GROUP_UPDATE, { groupId: group.groupId, name: 'Sneaky edit' });
    const payload = await rejected;
    expect(payload.reason).toBe('Not a group member');
  });

  test('GU7: an unknown group reports Group not found', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'gu7_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.GROUP_UPDATE, { groupId: UNKNOWN_GROUP_ID, name: 'Ghost name' });
    const payload = await rejected;
    expect(payload.reason).toBe('Group not found');
  });

  test('GU8: an update with neither name nor description is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'gu8_a');
    const group = await createGroup(a, 'Gu8 group', []);

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.GROUP_UPDATE, { groupId: group.groupId });
    const payload = await rejected;
    expect(payload.reason).toContain('at least one');
  });

  test('GU9: an empty group name is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'gu9_a');
    const group = await createGroup(a, 'Gu9 group', []);

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.GROUP_UPDATE, { groupId: group.groupId, name: '' });
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('GU10: a name longer than 50 characters is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'gu10_a');
    const group = await createGroup(a, 'Gu10 group', []);

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.GROUP_UPDATE, { groupId: group.groupId, name: 'x'.repeat(51) });
    const payload = await rejected;
    expect(payload.reason).toContain('50');
  });

  test('GU11: a description longer than 256 characters is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'gu11_a');
    const group = await createGroup(a, 'Gu11 group', []);

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.GROUP_UPDATE, {
      groupId: group.groupId,
      description: 'x'.repeat(257),
    });
    const payload = await rejected;
    expect(payload.reason).toContain('256');
  });

  test('GU12: unknown keys in the update payload are rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'gu12_a');
    const group = await createGroup(a, 'Gu12 group', []);

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.GROUP_UPDATE, {
      groupId: group.groupId,
      name: 'Gu12',
      bogus: true,
    });
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('GU13: a burst of group:update trips the rate limit', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'gu13_a');
    const group = await createGroup(a, 'Gu13 group', []);

    const reasons: string[] = [];
    a.on(EVENTS.SERVER.MESSAGE_REJECTED, (payload: MessageRejectedPayload) => {
      reasons.push(payload.reason);
    });
    for (let i = 0; i < CONSTANTS.RATE_LIMIT_MAX + 5; i++) {
      a.emit(EVENTS.CLIENT.GROUP_UPDATE, { groupId: group.groupId, name: `Gu13 ${i}` });
    }
    await delay(400);
    expect(reasons).toContain('Rate limit exceeded');
  });

  // ── group:create description ─────────────────────────────────────────

  test('GC1: group:create carries the description to members and snapshots', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'gc1_a');
    await join(b, 'gc1_b');

    const forA = waitEvent<GroupInfo>(a, EVENTS.SERVER.GROUP_CREATED);
    const forB = waitEvent<GroupInfo>(b, EVENTS.SERVER.GROUP_CREATED);
    a.emit(EVENTS.CLIENT.GROUP_CREATE, {
      name: 'Gu GC1',
      members: ['gc1_b'],
      description: 'Trip planning',
    });
    const [createdA, createdB] = await Promise.all([forA, forB]);
    expect(createdA.description).toBe('Trip planning');
    expect(createdB.description).toBe('Trip planning');
    expect(createdA.disappearing).toBe(0);

    const { groups } = await leaveAndRejoin(b, 'gc1_b', a);
    const snapshot = groups.find((g) => g.groupId === createdA.groupId);
    expect(snapshot?.description).toBe('Trip planning');
  });

  test('GC2: group:create defaults the description to an empty string', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'gc2_a');
    await join(b, 'gc2_b');

    const forA = waitEvent<GroupInfo>(a, EVENTS.SERVER.GROUP_CREATED);
    const forB = waitEvent<GroupInfo>(b, EVENTS.SERVER.GROUP_CREATED);
    a.emit(EVENTS.CLIENT.GROUP_CREATE, { name: 'Gu GC2', members: ['gc2_b'] });
    const [createdA, createdB] = await Promise.all([forA, forB]);
    expect(createdA.description).toBe('');
    expect(createdB.description).toBe('');
    expect(createdA.disappearing).toBe(0);

    const { groups, heals } = await leaveAndRejoin(b, 'gc2_b', a);
    const snapshot = groups.find((g) => g.groupId === createdA.groupId);
    expect(snapshot?.description).toBe('');
    expect(snapshot?.disappearing).toBe(0);
    expect(heals).toEqual([]);
  });

  // ── message:pin / message:pinned ─────────────────────────────────────

  test('PIN1: a DM pin relays to the peer with the exact payload, no echo', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'pin1_a');
    await join(b, 'pin1_b');

    const got = waitEvent<MessagePinnedPayload>(b, EVENTS.SERVER.MESSAGE_PINNED);
    a.emit(EVENTS.CLIENT.MESSAGE_PIN, {
      to: 'pin1_b',
      targetId: TARGET_ID,
      pinned: true,
    });
    const payload = await got;

    expect(Object.keys(payload).sort()).toEqual(['pinned', 'targetId', 'to', 'u']);
    expect(payload.targetId).toBe(TARGET_ID);
    expect(payload.pinned).toBe(true);
    expect(payload.u).toBe('pin1_a');
    expect(payload.to).toBe('pin1_b');

    let echoed = false;
    a.on(EVENTS.SERVER.MESSAGE_PINNED, () => {
      echoed = true;
    });
    await delay(200);
    expect(echoed).toBe(false);
  });

  test('PIN2: a pin from the other DM direction relays pinned=false', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'pin2_a');
    await join(b, 'pin2_b');

    const got = waitEvent<MessagePinnedPayload>(a, EVENTS.SERVER.MESSAGE_PINNED);
    b.emit(EVENTS.CLIENT.MESSAGE_PIN, {
      to: 'pin2_a',
      targetId: TARGET_ID,
      pinned: false,
    });
    const payload = await got;

    expect(payload.targetId).toBe(TARGET_ID);
    expect(payload.pinned).toBe(false);
    expect(payload.u).toBe('pin2_b');
    expect(payload.to).toBe('pin2_a');

    let echoed = false;
    b.on(EVENTS.SERVER.MESSAGE_PINNED, () => {
      echoed = true;
    });
    await delay(200);
    expect(echoed).toBe(false);
  });

  test('PIN3: an admin pin fans out to the group except the sender', async () => {
    const [a, b, c, group] = await trio('pin3_');

    const forB = waitEvent<MessagePinnedPayload>(b, EVENTS.SERVER.MESSAGE_PINNED);
    const forC = waitEvent<MessagePinnedPayload>(c, EVENTS.SERVER.MESSAGE_PINNED);
    let senderSaw = false;
    a.on(EVENTS.SERVER.MESSAGE_PINNED, () => {
      senderSaw = true;
    });
    a.emit(EVENTS.CLIENT.MESSAGE_PIN, {
      groupId: group.groupId,
      targetId: TARGET_ID,
      pinned: true,
    });

    const [payloadB, payloadC] = await Promise.all([forB, forC]);
    for (const payload of [payloadB, payloadC]) {
      expect(Object.keys(payload).sort()).toEqual(['groupId', 'pinned', 'targetId', 'u']);
      expect(payload.groupId).toBe(group.groupId);
      expect(payload.targetId).toBe(TARGET_ID);
      expect(payload.pinned).toBe(true);
      expect(payload.u).toBe('pin3_a');
    }
    await delay(200);
    expect(senderSaw).toBe(false);
  });

  test('PIN4: a non-admin member pin gets the exact admin error', async () => {
    const [, b, , group] = await trio('pin4_');

    const rejected = waitEvent<MessageRejectedPayload>(b, EVENTS.SERVER.MESSAGE_REJECTED);
    b.emit(EVENTS.CLIENT.MESSAGE_PIN, {
      groupId: group.groupId,
      targetId: TARGET_ID,
      pinned: true,
    });
    const payload = await rejected;
    expect(payload.reason).toBe('Only admins can pin messages');
  });

  test('PIN5: a non-UUID targetId is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pin5_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.MESSAGE_PIN, {
      to: 'pin5_b',
      targetId: 'not-a-uuid',
      pinned: true,
    });
    const payload = await rejected;
    expect(payload.reason).toContain('UUID');
  });

  test('PIN6: a missing pinned flag is rejected', async () => {
    const a = createClient(port);
    clients.push(a);
    await connect(a);
    await join(a, 'pin6_a');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.MESSAGE_PIN, { to: 'pin6_b', targetId: TARGET_ID } as never);
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  // ── disappearing:set / disappearing:changed ──────────────────────────

  test('DS1: a DM timer relays to the peer with the exact payload, no echo', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'ds1_a');
    await join(b, 'ds1_b');

    const got = waitEvent<DisappearingChangedPayload>(b, EVENTS.SERVER.DISAPPEARING_CHANGED);
    a.emit(EVENTS.CLIENT.DISAPPEARING_SET, { to: 'ds1_b', seconds: 86400 });
    const payload = await got;

    expect(Object.keys(payload).sort()).toEqual(['seconds', 'to', 'u']);
    expect(payload.seconds).toBe(86400);
    expect(payload.u).toBe('ds1_a');
    expect(payload.to).toBe('ds1_b');

    let echoed = false;
    a.on(EVENTS.SERVER.DISAPPEARING_CHANGED, () => {
      echoed = true;
    });
    await delay(200);
    expect(echoed).toBe(false);
  });

  test('DS2: a 300-second timer is rejected', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'ds2_a');
    await join(b, 'ds2_b');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.DISAPPEARING_SET, { to: 'ds2_b', seconds: 300 });
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('DS3: a negative timer is rejected', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'ds3_a');
    await join(b, 'ds3_b');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.DISAPPEARING_SET, { to: 'ds3_b', seconds: -1 });
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('DS4: a string preset is rejected', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'ds4_a');
    await join(b, 'ds4_b');

    const rejected = waitEvent<MessageRejectedPayload>(a, EVENTS.SERVER.MESSAGE_REJECTED);
    a.emit(EVENTS.CLIENT.DISAPPEARING_SET, { to: 'ds4_b', seconds: '24h' } as never);
    const payload = await rejected;
    expect(payload.reason.length).toBeGreaterThan(0);
  });

  test('DS5: an admin group set fans out except the sender and lands in snapshots', async () => {
    const [a, b, c, group] = await trio('ds5_');

    const forB = waitEvent<DisappearingChangedPayload>(b, EVENTS.SERVER.DISAPPEARING_CHANGED);
    const forC = waitEvent<DisappearingChangedPayload>(c, EVENTS.SERVER.DISAPPEARING_CHANGED);
    let senderSaw = false;
    a.on(EVENTS.SERVER.DISAPPEARING_CHANGED, () => {
      senderSaw = true;
    });
    a.emit(EVENTS.CLIENT.DISAPPEARING_SET, { groupId: group.groupId, seconds: 86400 });

    const [payloadB, payloadC] = await Promise.all([forB, forC]);
    for (const payload of [payloadB, payloadC]) {
      expect(Object.keys(payload).sort()).toEqual(['groupId', 'seconds', 'u']);
      expect(payload.seconds).toBe(86400);
      expect(payload.u).toBe('ds5_a');
      expect(payload.groupId).toBe(group.groupId);
    }
    await delay(200);
    expect(senderSaw).toBe(false);

    const { groups, heals } = await leaveAndRejoin(a, 'ds5_a', b);
    const snapshot = groups.find((g) => g.groupId === group.groupId);
    expect(snapshot?.disappearing).toBe(86400);
    expect(heals).toEqual([]);
  });

  test('DS6: a non-admin group set gets the exact admin error', async () => {
    const [, b, , group] = await trio('ds6_');

    const rejected = waitEvent<MessageRejectedPayload>(b, EVENTS.SERVER.MESSAGE_REJECTED);
    b.emit(EVENTS.CLIENT.DISAPPEARING_SET, { groupId: group.groupId, seconds: 604800 });
    const payload = await rejected;
    expect(payload.reason).toBe('Only admins can change disappearing messages');
  });

  test('DS7: setting the timer to 0 clears the DM entry', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await Promise.all([connect(a), connect(b)]);
    await join(a, 'ds7_a');
    await join(b, 'ds7_b');

    const first = waitEvent<DisappearingChangedPayload>(b, EVENTS.SERVER.DISAPPEARING_CHANGED);
    a.emit(EVENTS.CLIENT.DISAPPEARING_SET, { to: 'ds7_b', seconds: 86400 });
    expect((await first).seconds).toBe(86400);

    const second = waitEvent<DisappearingChangedPayload>(b, EVENTS.SERVER.DISAPPEARING_CHANGED);
    a.emit(EVENTS.CLIENT.DISAPPEARING_SET, { to: 'ds7_b', seconds: 0 });
    expect((await second).seconds).toBe(0);

    const { heals } = await leaveAndRejoin(a, 'ds7_a', b);
    expect(heals).toEqual([]);
  });

  test('DS8: joining replays only the joining user’s DM timers to their socket', async () => {
    const a = createClient(port);
    const b = createClient(port);
    const c = createClient(port);
    clients.push(a, b, c);
    await Promise.all([connect(a), connect(b), connect(c)]);
    await join(a, 'ds8_a');
    await join(b, 'ds8_b');
    await join(c, 'ds8_c');

    // alice <-> bob at 24 hours, bob <-> carol at 7 days.
    const firstSet = waitEvent<DisappearingChangedPayload>(b, EVENTS.SERVER.DISAPPEARING_CHANGED);
    a.emit(EVENTS.CLIENT.DISAPPEARING_SET, { to: 'ds8_b', seconds: 86400 });
    await firstSet;
    const secondSet = waitEvent<DisappearingChangedPayload>(c, EVENTS.SERVER.DISAPPEARING_CHANGED);
    b.emit(EVENTS.CLIENT.DISAPPEARING_SET, { to: 'ds8_c', seconds: 604800 });
    await secondSet;

    // Nothing replays to bystanders while alice reconnects.
    const bobHeals: DisappearingChangedPayload[] = [];
    b.on(EVENTS.SERVER.DISAPPEARING_CHANGED, (payload: DisappearingChangedPayload) => {
      bobHeals.push(payload);
    });

    const rejoinedA = await leaveAndRejoin(a, 'ds8_a', b);
    expect(rejoinedA.heals).toEqual([{ seconds: 86400, to: 'ds8_b' }]);

    // Bob's own reconnect replays both of his timers, nothing of carol's alone.
    const { heals: bobReplays } = await leaveAndRejoin(b, 'ds8_b', rejoinedA.client);
    expect(bobReplays).toEqual([
      { seconds: 86400, to: 'ds8_a' },
      { seconds: 604800, to: 'ds8_c' },
    ]);
    expect(bobHeals).toEqual([]);
  });

  test('DS9: every DISAPPEARING_PRESETS value validates and off-preset values do not', () => {
    for (const seconds of CONSTANTS.DISAPPEARING_PRESETS) {
      expect(validateDisappearingSetPayload({ to: 'peer', seconds }).success).toBe(true);
    }
    for (const seconds of [300, -1, 1000, 86399]) {
      expect(validateDisappearingSetPayload({ to: 'peer', seconds }).success).toBe(false);
    }
    expect(validateDisappearingSetPayload({ to: 'peer', seconds: '24h' }).success).toBe(false);
  });
});

describe('DmSettingsStore', () => {
  const alice = { id: UserId('alice'), name: 'alice' };
  const bob = { id: UserId('bob'), name: 'bob' };

  test('entries are keyed by the sorted pair no matter who sets them', () => {
    const store = new DmSettingsStore();
    store.set(alice, bob, 86400);
    expect(store.get(UserId('alice'), UserId('bob'))?.seconds).toBe(86400);

    store.set(bob, alice, 604800);
    expect(store.get(UserId('bob'), UserId('alice'))?.seconds).toBe(604800);
    expect(store.forUser(UserId('alice'))).toHaveLength(1);
    store.destroy();
  });

  test('seconds 0 removes the entry', () => {
    const store = new DmSettingsStore();
    store.set(alice, bob, 86400);
    store.set(alice, bob, 0);
    expect(store.get(UserId('alice'), UserId('bob'))).toBeUndefined();
    expect(store.forUser(UserId('alice'))).toHaveLength(0);
    store.destroy();
  });

  test('forUser returns only the entries involving that user', () => {
    const store = new DmSettingsStore();
    const carol = { id: UserId('carol'), name: 'carol' };
    store.set(alice, bob, 86400);
    store.set(bob, carol, 604800);

    expect(store.forUser(UserId('alice'))).toHaveLength(1);
    expect(store.forUser(UserId('bob'))).toHaveLength(2);
    expect(store.forUser(UserId('carol'))).toHaveLength(1);
    expect(store.forUser(UserId('dave'))).toHaveLength(0);
    store.destroy();
  });
});
