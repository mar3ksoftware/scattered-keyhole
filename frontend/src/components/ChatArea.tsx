import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { conversationKeyFor } from '../lib/conversation';
import { replyExcerptFor } from '../lib/envelope';
import { isAdminOf } from '../lib/permissions';
import type { ConversationTarget, ReplyRef } from '../types';
import { CallMuteButton } from './CallMuteButton';
import { ChatHeader } from './ChatHeader';
import { EditGroupModal } from './EditGroupModal';
import { GroupCallControls } from './GroupCallControls';
import { GroupCallOverlay } from './GroupCallOverlay';
import { GroupMembersPanel } from './GroupMembersPanel';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';
import { PinBanner } from './PinBanner';

type ChatAreaProps = {
  readonly selectedUser: string | null;
  readonly selectedGroup: string | null;
  readonly onBack?: (() => void) | undefined;
  readonly showBack?: boolean | undefined;
};

type SinkableAudio = HTMLAudioElement & {
  readonly setSinkId?: (deviceId: string) => Promise<void>;
};

// Plays the remote 1:1 track and routes it to the chosen output device.
// MediaStream.setSinkId is not implemented anywhere yet, so the sink lives on
// the <audio> element that actually renders the stream.
function RemoteCallAudio({
  stream,
  sinkId,
}: {
  readonly stream: MediaStream | null;
  readonly sinkId: string | null;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element !== null) element.srcObject = stream;
    return () => {
      if (element !== null) element.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const element = ref.current as SinkableAudio | null;
    if (element !== null && sinkId !== null && typeof element.setSinkId === 'function') {
      void element.setSinkId(sinkId).catch(() => undefined);
    }
  }, [sinkId]);

  if (stream === null) return null;
  return (
    <>
      {/* biome-ignore lint/a11y/useMediaCaption: live call audio has no caption track */}
      <audio ref={ref} autoPlay playsInline className="hidden" />
    </>
  );
}

export function ChatArea({ selectedUser, selectedGroup, onBack, showBack }: ChatAreaProps) {
  const {
    messages,
    sendMessage,
    sendMediaMessage,
    sendPollMessage,
    groupMessages,
    groups,
    sendGroupMessage,
    sendGroupMediaMessage,
    sendGroupPollMessage,
    logout,
    connectionStatus,
    user,
    typing,
    profiles,
    displayNameOf,
    sendTyping,
    stopTyping,
    pins,
    dmDisappearing,
    sendPin,
    setDisappearing,
    updateGroup,
    getSafetyNumber,
    callState,
    callPeer,
    callMuted,
    callRemoteStream,
    toggleCallMute,
    audioSettings,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    groupCallState,
    groupCallPeers,
    groupCallLocalStream,
    groupCallGroupId,
    groupCallTopology,
    joinGroupCall,
    leaveGroupCall,
    setGroupTopology,
  } = useChat();
  const [showMembers, setShowMembers] = useState(false);
  const [editingGroup, setEditingGroup] = useState(false);
  const [reply, setReply] = useState<ReplyRef | null>(null);
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);

  useEffect(() => {
    // The drawer hides itself whenever no group is selected, so only a switch
    // between conversations needs an actual reset.
    if (selectedGroup !== null) {
      setShowMembers(false);
    }
  }, [selectedGroup]);

  // Conversation switched (C1): drop any live typing burst, pending reply
  // and any open group edit form.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on conversation switch
  useEffect(() => {
    setReply(null);
    setEditingGroup(false);
    stopTyping();
  }, [selectedUser, selectedGroup, stopTyping]);

  const selectedGroupInfo =
    selectedGroup !== null ? groups.find((g) => g.groupId === selectedGroup) : undefined;

  // The peer may be offline, so match by username instead of requiring them to
  // be present in the active user list.
  const filteredMessages =
    selectedUser !== null
      ? messages.filter((m) => m.fromUsername === selectedUser || m.toUsername === selectedUser)
      : selectedGroup !== null
        ? groupMessages.filter((m) => m.groupId === selectedGroup)
        : [];

  const conversationTarget: ConversationTarget | null =
    selectedUser !== null
      ? { kind: 'dm', username: selectedUser }
      : selectedGroup !== null
        ? { kind: 'group', groupId: selectedGroup }
        : null;

  const handleSend = (text: string, pendingReply: ReplyRef | null): Promise<boolean> => {
    if (selectedUser !== null) {
      return sendMessage(selectedUser, text, pendingReply);
    }
    if (selectedGroup !== null) {
      return sendGroupMessage(selectedGroup, text, pendingReply);
    }
    return Promise.resolve(false);
  };

  const handleAttach = (file: File): Promise<boolean> => {
    if (selectedUser !== null) {
      return sendMediaMessage(selectedUser, file);
    }
    if (selectedGroup !== null) {
      return sendGroupMediaMessage(selectedGroup, file);
    }
    return Promise.resolve(false);
  };

  const handlePollSend = (question: string, options: readonly string[]): Promise<boolean> => {
    if (selectedUser !== null) {
      return sendPollMessage(selectedUser, question, options);
    }
    if (selectedGroup !== null) {
      return sendGroupPollMessage(selectedGroup, question, options);
    }
    return Promise.resolve(false);
  };

  // Voice notes ride the same media pipeline, plus their duration (B2).
  const handleVoice = (file: File, durationSeconds: number): Promise<boolean> => {
    if (selectedUser !== null) {
      return sendMediaMessage(selectedUser, file, durationSeconds);
    }
    if (selectedGroup !== null) {
      return sendGroupMediaMessage(selectedGroup, file, durationSeconds);
    }
    return Promise.resolve(false);
  };

  const handleTyping = () => {
    if (conversationTarget !== null) sendTyping(conversationTarget);
  };

  // Typing line names use the display-name fallback (spec D).
  const typingNames = useMemo(() => {
    const names: string[] = [];
    if (selectedUser !== null) {
      if (`dm:${selectedUser}` in typing) names.push(displayNameOf(selectedUser));
    } else if (selectedGroup !== null && selectedGroupInfo !== undefined) {
      for (const member of selectedGroupInfo.members) {
        if (member.username === user?.username) continue;
        if (`group:${selectedGroup}:${member.username}` in typing) {
          names.push(displayNameOf(member.username));
        }
      }
    }
    return names;
  }, [typing, selectedUser, selectedGroup, selectedGroupInfo, user, displayNameOf]);

  // DM header: display name with username fallback; status as subtitle when
  // non-empty (C9). Group header keeps the group name, with the Tier-3
  // description below it when one is set (spec A).
  const dmDisplayName = selectedUser !== null ? displayNameOf(selectedUser) : null;
  const dmStatus = selectedUser !== null ? (profiles[selectedUser]?.status ?? '') : '';
  const displayName = selectedGroupInfo?.name ?? dmDisplayName;
  const groupDescription = selectedGroupInfo?.description ?? '';
  const subtitle =
    selectedGroupInfo !== undefined
      ? groupDescription.length > 0
        ? groupDescription
        : 'Group'
      : dmStatus.length > 0
        ? dmStatus
        : undefined;

  // Tier-3: who may change this conversation's settings (admin in groups,
  // either participant in DMs) and the current timer value.
  const canAdmin =
    conversationTarget !== null && user !== null
      ? isAdminOf(groups, user.username, conversationTarget)
      : false;
  const timerSeconds =
    conversationTarget === null
      ? 0
      : conversationTarget.kind === 'group'
        ? (selectedGroupInfo?.disappearing ?? 0)
        : (dmDisappearing[`dm:${conversationTarget.username}`] ?? 0);

  // Group call controls: the header shows the live state only for the room
  // currently open; another room's live call keeps this entry point inert.
  const groupCallForThisGroup =
    selectedGroup !== null && groupCallGroupId === selectedGroup && groupCallState !== 'idle';
  const groupCallParticipantCount = groupCallPeers.length + 1;
  const groupCallName = groups.find((g) => g.groupId === groupCallGroupId)?.name ?? 'Group call';

  // Pin banner (spec B): excerpt of the slot's message via the existing
  // reply-excerpt helper, best-effort scroll on click.
  const pinnedId =
    conversationTarget !== null ? pins[conversationKeyFor(conversationTarget)] : undefined;
  const pinnedMessage =
    pinnedId !== undefined ? filteredMessages.find((m) => m.id === pinnedId) : undefined;
  const revealPinned = () => {
    if (pinnedId === undefined) return;
    document
      .getElementById(`message-${pinnedId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const mentionSuggestions =
    selectedGroupInfo !== undefined ? selectedGroupInfo.members.map((m) => m.username) : undefined;

  return (
    <div className="relative flex flex-col h-full bg-zinc-950">
      <RemoteCallAudio stream={callRemoteStream} sinkId={audioSettings.outputDeviceId} />
      <ChatHeader
        username={displayName}
        subtitle={subtitle}
        onLogout={logout}
        onBack={onBack}
        showBack={showBack}
        onMembersClick={
          selectedGroupInfo !== undefined ? () => setShowMembers((v) => !v) : undefined
        }
        timerSeconds={timerSeconds}
        timerDisabled={conversationTarget?.kind === 'group' && !canAdmin}
        onSelectTimer={
          conversationTarget !== null
            ? (seconds) => setDisappearing(conversationTarget, seconds)
            : undefined
        }
        canEditGroup={selectedGroupInfo !== undefined && canAdmin}
        onEditGroup={
          selectedGroupInfo !== undefined && canAdmin ? () => setEditingGroup(true) : undefined
        }
        groupTopology={selectedGroupInfo?.topology}
        onSelectTopology={
          selectedGroupInfo !== undefined && canAdmin
            ? (topology) => setGroupTopology(selectedGroupInfo.groupId, topology)
            : undefined
        }
        callControls={
          selectedGroupInfo !== undefined ? (
            <GroupCallControls
              state={groupCallForThisGroup ? groupCallState : 'idle'}
              participantCount={groupCallParticipantCount}
              disabled={groupCallState !== 'idle' && !groupCallForThisGroup}
              onStart={() => joinGroupCall(selectedGroupInfo.groupId)}
              onLeave={leaveGroupCall}
            />
          ) : undefined
        }
      />
      {selectedUser !== null && (
        <div className="px-4 py-1 flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              const sn = await getSafetyNumber(selectedUser);
              setSafetyNumber(sn);
            }}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            Verify safety number
          </button>
          {callState === 'idle' && (
            <button
              type="button"
              onClick={() => startCall(selectedUser)}
              className="text-xs text-emerald-500 hover:text-emerald-300"
            >
              Call
            </button>
          )}
          {callState === 'calling' && <span className="text-xs text-zinc-400">Calling…</span>}
          {callState === 'connected' && (
            <>
              <CallMuteButton muted={callMuted} onToggle={toggleCallMute} />
              <button
                type="button"
                onClick={endCall}
                className="text-xs text-rose-400 hover:text-rose-300"
              >
                End call
              </button>
            </>
          )}
          {safetyNumber !== null && (
            <p className="mt-1 text-[10px] font-mono text-zinc-400 break-all">{safetyNumber}</p>
          )}
        </div>
      )}
      {callState === 'incoming' && callPeer !== null && (
        <div className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2">
          <span className="text-sm text-zinc-200">Incoming call from {callPeer}</span>
          <button type="button" onClick={acceptCall} className="text-xs text-emerald-500">
            Accept
          </button>
          <button type="button" onClick={rejectCall} className="text-xs text-rose-400">
            Reject
          </button>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {displayName == null ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-zinc-500 text-sm">Select a conversation</p>
          </div>
        ) : (
          <>
            {pinnedMessage !== undefined && (
              <PinBanner
                excerpt={replyExcerptFor(
                  pinnedMessage.body,
                  pinnedMessage.media ?? null,
                  pinnedMessage.poll ?? null,
                )}
                canUnpin={canAdmin}
                onUnpin={() => {
                  if (pinnedId !== undefined && conversationTarget !== null) {
                    sendPin(conversationTarget, pinnedId, false);
                  }
                }}
                onOpen={revealPinned}
              />
            )}
            <MessageList messages={filteredMessages} onReply={setReply} />
            <div className="min-h-6 px-5 pt-1 text-xs text-zinc-500" aria-live="polite">
              {typingNames.length > 0 && `${typingNames.join(', ')} is typing…`}
            </div>
            <MessageInput
              onSend={handleSend}
              onAttach={handleAttach}
              onSendPoll={handlePollSend}
              onSendVoice={handleVoice}
              disabled={connectionStatus !== 'connected'}
              reply={reply}
              onClearReply={() => setReply(null)}
              mentionSuggestions={mentionSuggestions}
              onTyping={handleTyping}
              onStopTyping={stopTyping}
            />
          </>
        )}
        {groupCallState !== 'idle' && (
          <GroupCallOverlay
            groupName={groupCallName}
            state={groupCallState}
            topology={groupCallTopology}
            peers={groupCallPeers}
            localStream={groupCallLocalStream}
            onLeave={leaveGroupCall}
          />
        )}
      </div>
      {showMembers && selectedGroupInfo !== undefined && (
        <GroupMembersPanel group={selectedGroupInfo} onClose={() => setShowMembers(false)} />
      )}
      {editingGroup && selectedGroupInfo !== undefined && (
        <EditGroupModal
          group={selectedGroupInfo}
          onSave={(name, description) => {
            updateGroup(selectedGroupInfo.groupId, name, description);
            setEditingGroup(false);
          }}
          onClose={() => setEditingGroup(false)}
        />
      )}
    </div>
  );
}
