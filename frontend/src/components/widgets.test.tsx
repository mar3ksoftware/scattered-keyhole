import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatContext, type ChatContextValue } from '../context/ChatContext';
import { ChatHeader } from './ChatHeader';
import { ConversationSettingsMenu } from './ConversationSettingsMenu';
import { CreateGroupForm } from './CreateGroupModal';
import { MessageActionMenu } from './MessageActionMenu';
import { PinBanner } from './PinBanner';

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test('pin banner shows the excerpt and the Unpin button when allowed', () => {
  const html = render(<PinBanner excerpt="Pinned reply excerpt" canUnpin onUnpin={() => {}} />);
  assert.ok(html.includes('Pinned reply excerpt'));
  assert.ok(html.includes('Unpin'));
});

test('pin banner hides Unpin for users who may not pin', () => {
  const html = render(<PinBanner excerpt="Only the excerpt" canUnpin={false} onUnpin={() => {}} />);
  assert.ok(html.includes('Only the excerpt'));
  assert.ok(!html.includes('>Unpin<'), 'no Unpin entry without permission');
});

test('settings menu renders the exact timer option strings', () => {
  const html = render(<ConversationSettingsMenu timerSeconds={0} onSelect={() => {}} />);
  assert.ok(html.includes('Disappearing messages'));
  assert.ok(html.includes('Off'));
  assert.ok(html.includes('24 hours'));
  assert.ok(html.includes('7 days'));
  assert.ok(html.includes('30 days'));
  // Exactly one option is checked: the current value.
  assert.equal(count(html, 'aria-checked="true"'), 1);
});

test('settings menu disables the options for non-admin group members', () => {
  const html = render(
    <ConversationSettingsMenu timerSeconds={86_400} disabled onSelect={() => {}} />,
  );
  // Every preset button is disabled — visible but not changeable (spec C).
  assert.equal(count(html, 'disabled=""'), 4);
  // The current value still shows as checked so members can see it.
  assert.ok(html.includes('aria-checked="true"'));
});

test('settings menu shows Edit group only for admins', () => {
  const hidden = render(
    <ConversationSettingsMenu timerSeconds={0} onSelect={() => {}} canEditGroup={false} />,
  );
  assert.ok(!hidden.includes('Edit group'));

  const shown = render(
    <ConversationSettingsMenu
      timerSeconds={0}
      onSelect={() => {}}
      canEditGroup
      onEditGroup={() => {}}
    />,
  );
  assert.ok(shown.includes('Edit group'));
});

test('header renders the group description as the subtitle', () => {
  const html = render(
    <ChatHeader username="Team" subtitle="Sprint planning notes" onLogout={() => {}} />,
  );
  assert.ok(html.includes('Sprint planning notes'));
});

test('header hides the settings affordance without a conversation', () => {
  const html = render(<ChatHeader username={null} onLogout={() => {}} />);
  assert.ok(!html.includes('Conversation settings'));
  assert.ok(!html.includes('Disappearing messages'));
});

test('message action menu offers Pin message on an unpinned message', () => {
  const html = render(
    <MessageActionMenu
      canReply
      canReact
      canEdit={false}
      canDelete={false}
      pinLabel="Pin message"
      onReply={() => {}}
      onReact={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      onPin={() => {}}
    />,
  );
  assert.ok(html.includes('Pin message'));
  assert.ok(!html.includes('Unpin message'));
});

test('message action menu offers Unpin message on the pinned message', () => {
  const html = render(
    <MessageActionMenu
      canReply
      canReact
      canEdit={false}
      canDelete={false}
      pinLabel="Unpin message"
      onReply={() => {}}
      onReact={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      onPin={() => {}}
    />,
  );
  assert.ok(html.includes('Unpin message'));
  assert.ok(!html.includes('>Pin message<'));
});

test('message action menu shows no pin entry when the user may not pin', () => {
  const html = render(
    <MessageActionMenu
      canReply
      canReact
      canEdit={false}
      canDelete={false}
      pinLabel={null}
      onReply={() => {}}
      onReact={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      onPin={() => {}}
    />,
  );
  assert.ok(!html.includes('Pin message'));
  assert.ok(!html.includes('Unpin message'));
});

test('create group form carries the optional Description field', () => {
  const fakeChat = {
    directory: ['carol'],
    users: [],
    user: { userId: 'u1', username: 'alice', isGuest: false },
    createGroup: () => {},
  } as unknown as ChatContextValue;

  const html = render(
    <ChatContext.Provider value={fakeChat}>
      <CreateGroupForm onClose={() => {}} />
    </ChatContext.Provider>,
  );
  assert.ok(html.includes('Description'), 'the create form must offer Description');
  // Description is optional: with no name typed and no members picked the
  // Create button is disabled by name/members, never by the empty field.
  assert.ok(html.includes('disabled=""'));
});
