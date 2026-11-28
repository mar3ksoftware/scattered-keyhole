import { Database } from 'bun:sqlite';
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { Server as Engine } from '@socket.io/bun-engine';
import pino from 'pino';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';

import { AccountStore } from './account-store';
import type { LivekitConfig } from './config';
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
  ClientToServerEvents,
  ErrorPayload,
  GroupCallAnswerRelay,
  GroupCallIceRelay,
  GroupCallJoinedPayload,
  GroupCallLeftPayload,
  GroupCallOfferRelay,
  GroupCallRosterPayload,
  GroupInfo,
  GroupUpdatedPayload,
  NoticePayload,
  ServerToClientEvents,
  SfuCredentialsPayload,
  UserInfo,
  UserLeftPayload,
} from './types';
import { EVENTS } from './types';
import { UserDirectory } from './user-directory';
import { UserRegistry } from './user-registry';

type TestClient = ReturnType<typeof Client>;

const SFU_NOTICE =
  'Call topology switched to SFU: the server now forwards audio and video between participants (less secure than mesh).';
const MESH_NOTICE =
  'Call topology switched to mesh: calls are now direct and end-to-end encrypted (an upgrade from SFU).';
const MESH_FULL_ERROR =
  'This mesh call is full (6 participants max). Ask a group admin to switch this room to SFU for larger calls.';

function createClient(port: number) {
  return Client(`http://localhost:${port}`, {
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
  topology?: 'mesh' | 'sfu',
): Promise<GroupInfo> {
  const groupPromise = waitEvent<GroupInfo>(creator, EVENTS.SERVER.GROUP_CREATED);
  creator.emit(EVENTS.CLIENT.GROUP_CREATE, {
    name,
    members: [...members],
    ...(topology !== undefined ? { topology } : {}),
  });
  return groupPromise;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (part === undefined) throw new Error('malformed jwt');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

type Harness = {
  readonly port: number;
  readonly stop: () => void;
};

function startHarness(livekit?: LivekitConfig): Harness {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>();
  const engine = new Engine({ path: '/socket.io/' });
  io.bind(engine);

  const userRegistry = new UserRegistry();
  const rateLimiters = new RateLimiterRegistry();
  const db = new Database(':memory:');
  const accountStore = new AccountStore(db);
  const groupStore = new GroupStore();
  const userDirectory = new UserDirectory(db);
  const kickVoteStore = new KickVoteStore();
  const mediaAuth = new MediaAuth();
  const profileStore = new ProfileStore();
  const dmSettingsStore = new DmSettingsStore();
  const messageStore = new MessageStore(db);
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
    messageStore,
    null,
    pino({ level: 'silent' }),
    livekit,
  );

  const handler = engine.handler();
  const bunServer = Bun.serve({
    port: 0,
    idleTimeout: 30,
    fetch: handler.fetch,
    websocket: handler.websocket,
  });
  const port = bunServer.port;
  if (port === undefined) throw new Error('no port assigned');

  return {
    port,
    stop: () => {
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
    },
  };
}

// The mesh/topology suites do not mint tokens; the happy-path token test gets
// its own server with LiveKit configured so the missing-config case stays real.
const harness = startHarness();
const sfuHarness = startHarness({
  livekitUrl: 'wss://livekit.test',
  livekitApiKey: 'test-key',
  livekitApiSecret: 'test-secret',
});
const clients: TestClient[] = [];

afterAll(() => {
  harness.stop();
  sfuHarness.stop();
});

afterEach(() => {
  for (const c of clients) {
    if (c.connected) c.disconnect();
  }
  clients.length = 0;
});

async function joinedPair(
  port: number,
  prefix: string,
): Promise<{ a: TestClient; b: TestClient; group: GroupInfo }> {
  const a = createClient(port);
  const b = createClient(port);
  clients.push(a, b);
  await Promise.all([connect(a), connect(b)]);
  await join(a, `${prefix}a`);
  await join(b, `${prefix}b`);
  const group = await createGroup(a, `${prefix} group`, [`${prefix}b`]);
  return { a, b, group };
}

describe('group call topology', () => {
  test('GC1: group:create stores topology, defaulting to mesh, and snapshots carry it', async () => {
    const a = createClient(harness.port);
    const observer = createClient(harness.port);
    clients.push(a, observer);
    await Promise.all([connect(a), connect(observer)]);
    await join(a, 'gc1_a');
    await join(observer, 'gc1_observer');

    const sfuGroup = await createGroup(a, 'Gc1 sfu', [], 'sfu');
    expect(sfuGroup.topology).toBe('sfu');

    const meshGroup = await createGroup(a, 'Gc1 mesh', []);
    expect(meshGroup.topology).toBe('mesh');

    const left = waitEvent<UserLeftPayload>(observer, EVENTS.SERVER.USER_LEFT);
    a.disconnect();
    await left;

    const fresh = createClient(harness.port);
    clients.push(fresh);
    await connect(fresh);
    const { groups } = await join(fresh, 'gc1_a');

    expect(groups.find((g) => g.groupId === sfuGroup.groupId)?.topology).toBe('sfu');
    expect(groups.find((g) => g.groupId === meshGroup.groupId)?.topology).toBe('mesh');
  });

  test('GC2: admin switch to sfu broadcasts full state plus the frozen notice', async () => {
    const { a, b, group } = await joinedPair(harness.port, 'gc2_');

    const forA = waitEvent<GroupUpdatedPayload>(a, EVENTS.SERVER.GROUP_UPDATED);
    const forB = waitEvent<GroupUpdatedPayload>(b, EVENTS.SERVER.GROUP_UPDATED);
    const noticeA = waitEvent<NoticePayload>(a, EVENTS.SERVER.NOTICE);
    const noticeB = waitEvent<NoticePayload>(b, EVENTS.SERVER.NOTICE);

    a.emit(EVENTS.CLIENT.GROUP_TOPOLOGY, { groupId: group.groupId, topology: 'sfu' });

    const [updatedA, updatedB] = await Promise.all([forA, forB]);
    for (const updated of [updatedA, updatedB]) {
      expect(updated.groupId).toBe(group.groupId);
      expect(updated.topology).toBe('sfu');
      expect(updated.u).toBe('gc2_a');
    }
    expect((await noticeA).message).toBe(SFU_NOTICE);
    expect((await noticeB).message).toBe(SFU_NOTICE);
  });

  test('GC3: admin switch back to mesh emits the mesh notice', async () => {
    const { a, b, group } = await joinedPair(harness.port, 'gc3_');

    const toSfu = waitEvent<GroupUpdatedPayload>(b, EVENTS.SERVER.GROUP_UPDATED);
    // Consume the first switch's notice too, otherwise it races the listener
    // below and gets mistaken for the second switch's notice.
    const sfuNotice = waitEvent<NoticePayload>(b, EVENTS.SERVER.NOTICE);
    a.emit(EVENTS.CLIENT.GROUP_TOPOLOGY, { groupId: group.groupId, topology: 'sfu' });
    await toSfu;
    expect((await sfuNotice).message).toBe(SFU_NOTICE);

    const forB = waitEvent<GroupUpdatedPayload>(b, EVENTS.SERVER.GROUP_UPDATED);
    const notice = waitEvent<NoticePayload>(b, EVENTS.SERVER.NOTICE);
    a.emit(EVENTS.CLIENT.GROUP_TOPOLOGY, { groupId: group.groupId, topology: 'mesh' });

    expect((await forB).topology).toBe('mesh');
    expect((await notice).message).toBe(MESH_NOTICE);
  });

  test('GC4: non-admin switch is rejected', async () => {
    const { a, b, group } = await joinedPair(harness.port, 'gc4_');
    // Keep the admin socket referenced so the pair stays connected.
    expect(a.connected).toBe(true);

    const rejected = waitEvent<ErrorPayload>(b, EVENTS.SERVER.ERROR);
    b.emit(EVENTS.CLIENT.GROUP_TOPOLOGY, { groupId: group.groupId, topology: 'sfu' });

    expect((await rejected).message).toBe('Only admins can change the call topology');
  });

  test('GC5: invalid topology is a validation error', async () => {
    const { a, group } = await joinedPair(harness.port, 'gc5_');

    const rejected = waitEvent<ErrorPayload>(a, EVENTS.SERVER.ERROR);
    a.emit(EVENTS.CLIENT.GROUP_TOPOLOGY, { groupId: group.groupId, topology: 'p2p' });

    expect((await rejected).message.length).toBeGreaterThan(0);
  });
});

describe('mesh group calls', () => {
  test('GC6: join returns an empty roster and announces to the group', async () => {
    const { a, b, group } = await joinedPair(harness.port, 'gc6_');

    const rosterPromise = waitEvent<GroupCallRosterPayload>(a, EVENTS.SERVER.GROUP_CALL_ROSTER);
    const joinedForB = waitEvent<GroupCallJoinedPayload>(b, EVENTS.SERVER.GROUP_CALL_JOINED);
    a.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });

    expect((await rosterPromise).peers).toEqual([]);
    const joined = await joinedForB;
    expect(joined.groupId).toBe(group.groupId);
    expect(joined.fromUsername).toBe('gc6_a');
  });

  test('GC7: a second joiner sees the first peer and both sides get events', async () => {
    const { a, b, group } = await joinedPair(harness.port, 'gc7_');

    const firstRoster = waitEvent<GroupCallRosterPayload>(a, EVENTS.SERVER.GROUP_CALL_ROSTER);
    a.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });
    await firstRoster;

    const joinedForA = waitEvent<GroupCallJoinedPayload>(a, EVENTS.SERVER.GROUP_CALL_JOINED);
    const secondRoster = waitEvent<GroupCallRosterPayload>(b, EVENTS.SERVER.GROUP_CALL_ROSTER);
    b.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });

    const roster = await secondRoster;
    expect(roster.peers).toHaveLength(1);
    expect(roster.peers[0]?.username).toBe('gc7_a');
    expect(String(roster.peers[0]?.userId)).toBe('gc7_a');
    expect((await joinedForA).fromUsername).toBe('gc7_b');
  });

  test('GC8: the seventh participant is refused and the roster is unchanged', async () => {
    const names = ['gc8_a', 'gc8_b', 'gc8_c', 'gc8_d', 'gc8_e', 'gc8_f', 'gc8_g'];
    const groupClients = names.map(() => createClient(harness.port));
    clients.push(...groupClients);
    await Promise.all(groupClients.map((c) => connect(c)));
    for (const [index, client] of groupClients.entries()) {
      await join(client, names[index] as string);
    }
    const group = await createGroup(groupClients[0] as TestClient, 'Gc8 group', names.slice(1));

    for (const [index, client] of groupClients.slice(0, 6).entries()) {
      const roster = waitEvent<GroupCallRosterPayload>(client, EVENTS.SERVER.GROUP_CALL_ROSTER);
      client.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });
      await roster;
      expect(index).toBeLessThan(6);
    }

    const seventh = groupClients[6] as TestClient;
    const rejected = waitEvent<ErrorPayload>(seventh, EVENTS.SERVER.ERROR);
    seventh.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });
    expect((await rejected).message).toBe(MESH_FULL_ERROR);

    // Still full: a retry is refused again rather than silently joining.
    const rejectedAgain = waitEvent<ErrorPayload>(seventh, EVENTS.SERVER.ERROR);
    seventh.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });
    expect((await rejectedAgain).message).toBe(MESH_FULL_ERROR);
  });

  test('GC9: a repeated join is idempotent', async () => {
    const { a, b, group } = await joinedPair(harness.port, 'gc9_');

    const firstRoster = waitEvent<GroupCallRosterPayload>(a, EVENTS.SERVER.GROUP_CALL_ROSTER);
    a.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });
    await firstRoster;
    const secondRoster = waitEvent<GroupCallRosterPayload>(b, EVENTS.SERVER.GROUP_CALL_ROSTER);
    b.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });
    await secondRoster;
    await delay(100);

    let extraJoins = 0;
    b.on(EVENTS.SERVER.GROUP_CALL_JOINED, () => {
      extraJoins += 1;
    });

    const roster = waitEvent<GroupCallRosterPayload>(a, EVENTS.SERVER.GROUP_CALL_ROSTER);
    a.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });
    expect((await roster).peers[0]?.username).toBe('gc9_b');
    await delay(150);
    expect(extraJoins).toBe(0);
  });

  test('GC10: leave removes the participant and broadcasts left', async () => {
    const { a, b, group } = await joinedPair(harness.port, 'gc10_');

    const firstRoster = waitEvent<GroupCallRosterPayload>(a, EVENTS.SERVER.GROUP_CALL_ROSTER);
    a.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });
    await firstRoster;

    const leftForB = waitEvent<GroupCallLeftPayload>(b, EVENTS.SERVER.GROUP_CALL_LEFT);
    a.emit(EVENTS.CLIENT.GROUP_CALL_LEAVE, { groupId: group.groupId });

    const left = await leftForB;
    expect(left.groupId).toBe(group.groupId);
    expect(left.fromUsername).toBe('gc10_a');

    // Rejoining after a leave starts from an empty roster again.
    const roster = waitEvent<GroupCallRosterPayload>(a, EVENTS.SERVER.GROUP_CALL_ROSTER);
    a.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });
    expect((await roster).peers).toEqual([]);
  });

  test('GC11: offer, answer, and ice relay to the addressed socket', async () => {
    const { a, b, group } = await joinedPair(harness.port, 'gc11_');

    const rosterA = waitEvent<GroupCallRosterPayload>(a, EVENTS.SERVER.GROUP_CALL_ROSTER);
    a.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });
    await rosterA;
    const rosterB = waitEvent<GroupCallRosterPayload>(b, EVENTS.SERVER.GROUP_CALL_ROSTER);
    b.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });
    await rosterB;

    const offerForB = waitEvent<GroupCallOfferRelay>(b, EVENTS.SERVER.GROUP_CALL_OFFER);
    a.emit(EVENTS.CLIENT.GROUP_CALL_OFFER, {
      groupId: group.groupId,
      to: 'gc11_b',
      sdp: 'offer-sdp',
    });
    const offer = await offerForB;
    expect(offer.groupId).toBe(group.groupId);
    expect(offer.fromUsername).toBe('gc11_a');
    expect(offer.sdp).toBe('offer-sdp');

    const answerForA = waitEvent<GroupCallAnswerRelay>(a, EVENTS.SERVER.GROUP_CALL_ANSWER);
    b.emit(EVENTS.CLIENT.GROUP_CALL_ANSWER, {
      groupId: group.groupId,
      to: 'gc11_a',
      sdp: 'answer-sdp',
    });
    const answer = await answerForA;
    expect(answer.fromUsername).toBe('gc11_b');
    expect(answer.sdp).toBe('answer-sdp');

    const iceForB = waitEvent<GroupCallIceRelay>(b, EVENTS.SERVER.GROUP_CALL_ICE);
    a.emit(EVENTS.CLIENT.GROUP_CALL_ICE, {
      groupId: group.groupId,
      to: 'gc11_b',
      candidate: '{"candidate":"x"}',
    });
    const ice = await iceForB;
    expect(ice.fromUsername).toBe('gc11_a');
    expect(ice.candidate).toBe('{"candidate":"x"}');
  });

  test('GC12: joining an SFU room is refused', async () => {
    const { a, group } = await joinedPair(harness.port, 'gc12_');
    const sfuGroup = await createGroup(a, 'Gc12 sfu', [], 'sfu');

    const rejected = waitEvent<ErrorPayload>(a, EVENTS.SERVER.ERROR);
    a.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: sfuGroup.groupId });
    expect((await rejected).message).toBe("This room's calls go through the SFU.");

    // Keep the mesh group referenced to document the contrast.
    expect(group.topology).toBe('mesh');
  });

  test('GC13: a disconnect ends the call for the remaining participants', async () => {
    const { a, b, group } = await joinedPair(harness.port, 'gc13_');

    const rosterA = waitEvent<GroupCallRosterPayload>(a, EVENTS.SERVER.GROUP_CALL_ROSTER);
    a.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });
    await rosterA;
    const rosterB = waitEvent<GroupCallRosterPayload>(b, EVENTS.SERVER.GROUP_CALL_ROSTER);
    b.emit(EVENTS.CLIENT.GROUP_CALL_JOIN, { groupId: group.groupId });
    await rosterB;

    const leftForB = waitEvent<GroupCallLeftPayload>(b, EVENTS.SERVER.GROUP_CALL_LEFT);
    a.disconnect();

    const left = await leftForB;
    expect(left.groupId).toBe(group.groupId);
    expect(left.fromUsername).toBe('gc13_a');
  });
});

describe('sfu token minting', () => {
  test('GC14: sfu room mints a room-scoped token', async () => {
    const a = createClient(sfuHarness.port);
    clients.push(a);
    await connect(a);
    await join(a, 'gc14_a');
    const group = await createGroup(a, 'Gc14 sfu', [], 'sfu');

    const credentials = waitEvent<SfuCredentialsPayload>(
      a,
      EVENTS.SERVER.GROUP_CALL_SFU_CREDENTIALS,
    );
    a.emit(EVENTS.CLIENT.GROUP_CALL_SFU_TOKEN, { groupId: group.groupId });
    const result = await credentials;

    expect(result.groupId).toBe(group.groupId);
    expect(result.url).toBe('wss://livekit.test');

    const claims = decodeJwtPayload(result.token);
    expect(claims['sub']).toBe('gc14_a');
    expect(claims['name']).toBe('gc14_a');
    const video = claims['video'] as Record<string, unknown>;
    expect(video['room']).toBe(`group_${group.groupId}`);
    expect(video['roomJoin']).toBe(true);
    expect(video['canPublish']).toBe(true);
    expect(video['canSubscribe']).toBe(true);
  });

  test('GC15: a mesh room cannot mint an SFU token', async () => {
    const a = createClient(sfuHarness.port);
    clients.push(a);
    await connect(a);
    await join(a, 'gc15_a');
    const group = await createGroup(a, 'Gc15 mesh', []);

    const rejected = waitEvent<ErrorPayload>(a, EVENTS.SERVER.ERROR);
    a.emit(EVENTS.CLIENT.GROUP_CALL_SFU_TOKEN, { groupId: group.groupId });
    expect((await rejected).message).toBe('This room uses mesh calls.');
  });

  test('GC16: missing LiveKit config is refused', async () => {
    const a = createClient(harness.port);
    clients.push(a);
    await connect(a);
    await join(a, 'gc16_a');
    const group = await createGroup(a, 'Gc16 sfu', [], 'sfu');

    const rejected = waitEvent<ErrorPayload>(a, EVENTS.SERVER.ERROR);
    a.emit(EVENTS.CLIENT.GROUP_CALL_SFU_TOKEN, { groupId: group.groupId });
    expect((await rejected).message).toBe('SFU calls are not configured on this server.');
  });

  test('GC17: non-members cannot mint an SFU token', async () => {
    const a = createClient(sfuHarness.port);
    const outsider = createClient(sfuHarness.port);
    clients.push(a, outsider);
    await Promise.all([connect(a), connect(outsider)]);
    await join(a, 'gc17_a');
    await join(outsider, 'gc17_outsider');
    const group = await createGroup(a, 'Gc17 sfu', [], 'sfu');

    const rejected = waitEvent<ErrorPayload>(outsider, EVENTS.SERVER.ERROR);
    outsider.emit(EVENTS.CLIENT.GROUP_CALL_SFU_TOKEN, { groupId: group.groupId });
    expect((await rejected).message).toBe('You are not a member of this group');
  });
});
