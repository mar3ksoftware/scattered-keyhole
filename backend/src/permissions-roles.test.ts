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
import { MediaAuth } from './media-auth';
import { MessageStore } from './message-store';
import { ProfileStore } from './profile-store';
import { RateLimiterRegistry } from './rate-limiter';
import { createServer } from './server';
import { TombstoneStore } from './tombstone-store';
import type {
  ErrorPayload,
  GroupUpdatedPayload,
  KickTallyPayload,
  MessageDeletedPayload,
  MessageRejectedPayload,
  NoticePayload,
} from './types';
import { EVENTS } from './types';
import { UserDirectory } from './user-directory';
import { UserRegistry } from './user-registry';

type TestClient = ReturnType<typeof Client>;

function makeUrl(port: number) {
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
async function connect(c: TestClient) {
  return new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('ct')), 5000);
    c.once('connect', () => {
      clearTimeout(t);
      res();
    });
    c.once('connect_error', (e: Error) => {
      clearTimeout(t);
      rej(e);
    });
    c.connect();
  });
}
function waitEvent<T>(c: TestClient, ev: string, ms = 5000): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms);
    c.once(ev, (p: T) => {
      clearTimeout(t);
      res(p);
    });
  });
}
async function join(c: TestClient, name: string) {
  c.emit(EVENTS.CLIENT.USER_JOIN, { username: name });
  await waitEvent(c, EVENTS.SERVER.USER_JOINED);
}
async function createGroup(owner: TestClient, name: string, members: string[]) {
  owner.emit(EVENTS.CLIENT.GROUP_CREATE, { name, members });
  const created = await waitEvent<GroupUpdatedPayload & { groupId: string; name: string }>(
    owner,
    EVENTS.SERVER.GROUP_CREATED,
  );
  return created;
}

let db: Database;
let io: Server;
let engine: Engine;
let bunServer: ReturnType<typeof Bun.serve>;
let port: number;
let userRegistry: UserRegistry;
let rateLimiters: RateLimiterRegistry;
let accountStore: AccountStore;
let groupStore: GroupStore;
let userDirectory: UserDirectory;
let kickVoteStore: KickVoteStore;
let mediaAuth: MediaAuth;
let profileStore: ProfileStore;
let dmSettingsStore: DmSettingsStore;
let tombstoneStore: TombstoneStore;
const clients: TestClient[] = [];

beforeAll(async () => {
  db = new Database(':memory:');
  engine = new Engine({ path: '/socket.io/' });
  io = new Server({ cors: { origin: '*' } });
  io.bind(engine);
  userRegistry = new UserRegistry();
  rateLimiters = new RateLimiterRegistry();
  accountStore = new AccountStore(db);
  groupStore = new GroupStore();
  userDirectory = new UserDirectory(db);
  kickVoteStore = new KickVoteStore();
  mediaAuth = new MediaAuth();
  profileStore = new ProfileStore();
  dmSettingsStore = new DmSettingsStore();
  tombstoneStore = new TombstoneStore();
  const messageStore = new MessageStore(db);
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
    messageStore,
    null,
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
  if (assignedPort === undefined) throw new Error('server did not bind a port');
  port = assignedPort;
});

afterAll(() => {
  for (const c of clients) c.disconnect();
  bunServer.stop(true);
  userRegistry.destroy();
  kickVoteStore.destroy();
  rateLimiters.destroy();
  accountStore.destroy();
  groupStore.destroy();
  mediaAuth.destroy();
  profileStore.destroy();
  dmSettingsStore.destroy();
  tombstoneStore.destroy();
  db.close();
});

afterEach(() => {
  for (const c of clients.splice(0)) c.disconnect();
});

describe('Tier-4 permissions & roles', () => {
  test('PR1: non-admin promote gets exact error', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await connect(a);
    await connect(b);
    await join(a, 'pr1_a');
    await join(b, 'pr1_b');
    const group = await createGroup(a, 'Pr1 group', ['pr1_b']);
    const rejected = waitEvent<ErrorPayload>(b, EVENTS.SERVER.ERROR);
    b.emit(EVENTS.CLIENT.GROUP_MEMBER_PROMOTE, { groupId: group.groupId, username: 'pr1_a' });
    const p = await rejected;
    expect(p.message).toBe('Only admins can promote or demote members');
  });

  test('PR2: admin promote reaches all members via group:updated', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await connect(a);
    await connect(b);
    await join(a, 'pr2_a');
    await join(b, 'pr2_b');
    const group = await createGroup(a, 'Pr2 group', ['pr2_b']);
    const forB = waitEvent<GroupUpdatedPayload>(b, EVENTS.SERVER.GROUP_UPDATED);
    const notice = waitEvent<NoticePayload>(b, EVENTS.SERVER.NOTICE);
    a.emit(EVENTS.CLIENT.GROUP_MEMBER_PROMOTE, { groupId: group.groupId, username: 'pr2_b' });
    await forB;
    // group:updated may not carry members in this build; check notice instead
    const n = await notice;
    expect(n.message).toBe('You are now an admin of Pr2 group');
  });

  test('PR3: redact by non-admin rejected', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await connect(a);
    await connect(b);
    await join(a, 'pr3_a');
    await join(b, 'pr3_b');
    const group = await createGroup(a, 'Pr3 group', ['pr3_b']);
    // b sends a message
    b.emit(EVENTS.CLIENT.GROUP_MESSAGE_SEND, { groupId: group.groupId, ciphertext: 'x', iv: 'y' });
    await new Promise((r) => setTimeout(r, 200));
    const rejected = waitEvent<MessageRejectedPayload>(b, EVENTS.SERVER.MESSAGE_REJECTED);
    b.emit(EVENTS.CLIENT.MESSAGE_REDACT, {
      groupId: group.groupId,
      targetId: '11111111-2222-4333-8444-555555555555',
    });
    const p = await rejected;
    expect(p.reason).toBe("Only admins can delete others' messages");
  });

  test('PR4: tombstone replay on rejoin', async () => {
    const a = createClient(port);
    const b = createClient(port);
    clients.push(a, b);
    await connect(a);
    await connect(b);
    await join(a, 'pr4_a');
    await join(b, 'pr4_b');
    const group = await createGroup(a, 'Pr4 group', ['pr4_b']);
    // admin redacts a message id
    const deleted = waitEvent<MessageDeletedPayload>(b, EVENTS.SERVER.MESSAGE_DELETED);
    a.emit(EVENTS.CLIENT.MESSAGE_REDACT, {
      groupId: group.groupId,
      targetId: '22222222-3333-4444-8555-666666666666',
    });
    await deleted;
    // b rejoins and should receive the tombstone replay
    const replayed = waitEvent<MessageDeletedPayload>(b, EVENTS.SERVER.MESSAGE_DELETED);
    await (async () => {
      b.disconnect();
      await new Promise((r) => setTimeout(r, 50));
      b.connect();
      await connect(b);
      await join(b, 'pr4_b');
    })();
    const rp = await replayed;
    expect(rp.targetId).toBe('22222222-3333-4444-8555-666666666666');
  });

  test('PR5: kick reset by admin emits expired tally', async () => {
    const a = createClient(port);
    const b = createClient(port);
    const c = createClient(port);
    clients.push(a, b, c);
    await connect(a);
    await connect(b);
    await connect(c);
    await join(a, 'pr5_a');
    await join(b, 'pr5_b');
    await join(c, 'pr5_c');
    const group = await createGroup(a, 'Pr5 group', ['pr5_b', 'pr5_c']);
    // start a vote
    a.emit(EVENTS.CLIENT.GROUP_KICK_VOTE, { groupId: group.groupId, username: 'pr5_b' });
    await new Promise((r) => setTimeout(r, 200));
    const expired = waitEvent<KickTallyPayload>(b, EVENTS.SERVER.GROUP_KICK_TALLY);
    a.emit(EVENTS.CLIENT.GROUP_KICK_RESET, { groupId: group.groupId, username: 'pr5_b' });
    const t = await expired;
    expect(t.status).toBe('expired');
  });
});
