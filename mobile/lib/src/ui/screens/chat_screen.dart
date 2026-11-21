import 'dart:io';

import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../crypto/media_crypto.dart';
import '../../models/models.dart';
import '../../state/chat_controller.dart';
import '../../state/voice_recorder.dart';
import '../../utils/conversation_keys.dart';
import '../../utils/envelope.dart';
import '../theme/app_theme.dart';
import '../widgets/connection_status.dart';
import '../widgets/conversation_settings_sheet.dart';
import '../widgets/edit_group_modal.dart';
import '../widgets/group_members_sheet.dart';
import '../widgets/message_bubble.dart';
import '../widgets/message_composer.dart';
import '../widgets/message_list.dart';
import '../widgets/pin_banner.dart';

/// The conversation detail: header, message history, typing line and composer.
///
/// Rendered as the right pane in the two-pane layout (`showBack: false`)
/// and as a pushed full-screen route on phones (`showBack: true`).
class ChatScreen extends StatefulWidget {
  const ChatScreen({
    super.key,
    required this.controller,
    this.peerUsername,
    this.groupId,
    this.showBack = false,
  }) : assert(peerUsername != null || groupId != null);

  final ChatController controller;
  final String? peerUsername;
  final String? groupId;
  final bool showBack;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  /// Message the composer will reply to (C4); cleared on send/switch.
  MessageView? _reply;

  /// Safety number (Tier-6) shown for the open DM, or null.
  String? _safetyNumber;

  /// Message being edited inline (C6); the composer prefills from its body.
  MessageView? _editing;

  /// Voice recorder session for this conversation (spec H).
  late final VoiceRecorderController _voice;

  ChatController get _controller => widget.controller;
  String? get _peer => widget.peerUsername;
  String? get _groupId => widget.groupId;

  ConversationTarget? get _target {
    final peer = _peer;
    if (peer != null) return ConversationTarget.dm(peer);
    final id = _groupId;
    if (id != null) return ConversationTarget.group(id);
    return null;
  }

  @override
  void initState() {
    super.initState();
    _voice = VoiceRecorderController(onSend: _sendVoiceFile);
  }

  @override
  void dispose() {
    _voice.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(ChatScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final switched = oldWidget.peerUsername != widget.peerUsername ||
        oldWidget.groupId != widget.groupId;
    if (switched) {
      // Conversation switched: pending reply/edit and the typing burst end (C1).
      _reply = null;
      _editing = null;
      _safetyNumber = null;
      _controller.stopTyping();
    }
  }

  GroupInfo? _findGroup() {
    final id = _groupId;
    if (id == null) return null;
    for (final group in _controller.groups) {
      if (group.groupId == id) return group;
    }
    return null;
  }

  List<MessageView> _messages() {
    final peer = _peer;
    if (peer != null) {
      return [
        for (final message in _controller.messagesForPeer(peer))
          MessageView.fromPrivate(message),
      ];
    }
    final id = _groupId;
    if (id != null) {
      return [
        for (final message in _controller.groupMessagesFor(id))
          MessageView.fromGroup(message),
      ];
    }
    return const <MessageView>[];
  }

  /// Wire reply ref for [view] (C4): id + author username + ≤140-char excerpt.
  Map<String, dynamic>? _replyRefFor(MessageView view) {
    final id = view.id;
    if (id == null) return null;
    return buildReplyRef(
      id: id,
      username: view.author ?? '',
      excerpt: replyExcerptFor(
        view.body ?? view.text,
        mediaName: view.media?.name,
        poll: view.poll,
      ),
    );
  }

  Future<bool> _send(String text) async {
    final editing = _editing;
    if (editing != null) {
      final target = _target;
      final id = editing.id;
      if (target == null || id == null) return false;
      final sent = await _controller.editMessage(
        target,
        id,
        text,
        reply: editing.reply,
      );
      if (sent && mounted) {
        setState(() => _editing = null);
      }
      return sent;
    }

    final target = _target;
    if (target == null) return false;
    final replyRef = _reply != null ? _replyRefFor(_reply!) : null;
    final sent = target.isGroup
        ? await _controller.sendGroupMessage(
            _groupId!,
            text,
            reply: replyRef,
          )
        : await _controller.sendMessage(_peer!, text, reply: replyRef);
    if (sent && _reply != null && mounted) {
      setState(() => _reply = null);
    }
    return sent;
  }

  void _startReply(MessageView view) {
    if (view.id == null || view.deleted) return;
    setState(() {
      _reply = view;
      _editing = null;
    });
  }

  void _startEdit(MessageView view) {
    if (view.id == null || view.deleted || view.media != null || view.poll != null) {
      return;
    }
    setState(() {
      _editing = view;
      _reply = null;
    });
  }

  /// Sends a poll through the active conversation (spec B1); invalid
  /// definitions send nothing and surface the composer's send error.
  Future<bool> _sendPoll(String question, List<String> options) async {
    final target = _target;
    if (target == null) return false;
    return target.isGroup
        ? await _controller.sendGroupPoll(_groupId!, question, options)
        : await _controller.sendPoll(_peer!, question, options);
  }

  /// Uploads a stopped voice recording as an audio attachment (spec H):
  /// read the temp file, ship it through the media pipeline, then drop it.
  Future<bool> _sendVoiceFile(String path, Duration duration) async {
    final target = _target;
    if (target == null) return false;
    Uint8List bytes;
    try {
      bytes = await File(path).readAsBytes();
    } catch (_) {
      return false;
    }
    final seconds = duration.inMilliseconds / 1000;
    try {
      return target.isGroup
          ? await _controller.sendGroupMediaMessage(
              _groupId!,
              bytes,
              mime: 'audio/mp4',
              name: 'voice.m4a',
              duration: seconds,
            )
          : await _controller.sendMediaMessage(
              _peer!,
              bytes,
              mime: 'audio/mp4',
              name: 'voice.m4a',
              duration: seconds,
            );
    } finally {
      // The temp file has no further use once its bytes are in memory.
      try {
        final file = File(path);
        if (await file.exists()) await file.delete();
      } catch (_) {
        // Temp cleanup never surfaces to the user.
      }
    }
  }

  /// Picks an attachment and hands it to the active conversation; a cancelled
  /// picker returns true (nothing to do, no error to show).
  Future<bool> _attach() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const <String>[
        'jpg',
        'jpeg',
        'png',
        'webp',
        'mp4',
        'webm',
        'mov',
      ],
      withData: true,
    );
    if (picked == null || picked.files.isEmpty) return true;
    final file = picked.files.first;
    final bytes = file.bytes;
    if (bytes == null) return false;

    final mime = mimeForFileName(file.name) ?? '';
    final peer = _peer;
    if (peer != null) {
      return _controller.sendMediaMessage(
        peer,
        bytes,
        mime: mime,
        name: file.name,
      );
    }
    final id = _groupId;
    if (id != null) {
      return _controller.sendGroupMediaMessage(
        id,
        bytes,
        mime: mime,
        name: file.name,
      );
    }
    return false;
  }

  /// `{displayName} is typing…` label for the open conversation, or null
  /// when nobody else is typing (C1; names in roster order, comma-joined).
  String? _typingLabel() {
    final peer = _peer;
    final groupId = _groupId;
    final names = peer != null
        ? _controller.typingUsernamesIn(peer: peer)
        : groupId != null
        ? _controller.typingUsernamesIn(groupId: groupId)
        : const <String>[];
    if (names.isEmpty) return null;
    final displayNames = [
      for (final name in names) _controller.displayNameOf(name),
    ];
    return '${displayNames.join(', ')} is typing…';
  }

  void _handleTyping() {
    final target = _target;
    if (target != null) _controller.sendTyping(target);
  }

  /// Group member usernames for the `@` autocomplete; DMs get null (C8).
  List<String>? _mentionCandidates() {
    final group = _findGroup();
    if (group == null) return null;
    return [for (final member in group.members) member.username];
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _controller,
      builder: (context, _) {
        final group = _findGroup();
        final peer = _peer;
        final target = _target;
        final status =
            peer != null ? _controller.statusOf(peer) : '';
        final title =
            group?.name ??
            (peer != null ? _controller.displayNameOf(peer) : 'Direct');
        final subtitle = group != null
            ? (group.description.isNotEmpty ? group.description : 'Group')
            : (status.isEmpty ? null : status);
        final typingLabel = _typingLabel();
        final conversationKey =
            target == null ? null : conversationKeyFor(target);
        final canPin = target == null
            ? false
            : (target.isGroup
                ? (group?.isAdmin(_controller.me?.username) ?? false)
                : true);
        final pinnedId = conversationKey == null
            ? null
            : _controller.pinnedMessageId(conversationKey);
        final messages = _messages();
        MessageView? pinnedView;
        if (pinnedId != null) {
          for (final message in messages) {
            if (message.id == pinnedId) {
              pinnedView = message;
              break;
            }
          }
        }
        final reply = _reply;
        final editing = _editing;
        return SafeArea(
          child: Column(
            children: [
              _ChatHeader(
                title: title,
                subtitle: subtitle,
                status: _controller.connectionStatus,
                showBack: widget.showBack,
                showStatusLabel: !widget.showBack,
                onMembers: group == null
                    ? null
                    : () => showGroupMembersSheet(
                        context,
                        controller: _controller,
                        groupId: group.groupId,
                      ),
                onSettings: target == null
                    ? null
                    : () async {
                        final seconds = await showConversationSettingsSheet(
                          context,
                          timerSeconds: _controller.timerSecondsFor(target),
                          disabled: target.isGroup
                              ? !(group?.isAdmin(_controller.me?.username) ??
                                  false)
                              : false,
                          canEditGroup: target.isGroup &&
                              (group?.isAdmin(_controller.me?.username) ??
                                  false),
                          onEditGroup: target.isGroup && group != null
                              ? () => showEditGroupModal(
                                    context,
                                    group: group,
                                    onSave: (name, description) =>
                                        _controller.updateGroup(
                                      group.groupId,
                                      name,
                                      description,
                                    ),
                                  )
                              : null,
                        );
                        if (seconds != null && context.mounted) {
                          final k = conversationKeyFor(target);
                          _controller.setDisappearing(k, seconds);
                        }
                      },
                onLogout: () {
                  _controller.logout();
                  // On phones the chat sits on top of the list; drop it so
                  // the auth screen underneath is visible right away.
                  if (widget.showBack && Navigator.canPop(context)) {
                    Navigator.pop(context);
                  }
                },
              ),
              if (pinnedView != null)
                PinBanner(
                  excerpt: replyExcerptFor(
                    pinnedView.body ?? pinnedView.text,
                    mediaName: pinnedView.media?.name,
                    poll: pinnedView.poll,
                  ),
                  canUnpin: canPin,
                  onUnpin: () {
                    if (conversationKey != null && pinnedId != null) {
                      _controller.sendPin(conversationKey, pinnedId, false);
                    }
                  },
                ),
              if (peer != null)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: TextButton(
                    onPressed: () async {
                      final sn = await _controller.safetyNumberFor(peer);
                      if (!mounted || sn == null) return;
                      setState(() => _safetyNumber = sn);
                    },
                    child: const Text('Verify safety number'),
                  ),
                ),
              if (peer != null && _safetyNumber != null)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: AlertDialog(
                    title: const Text('Safety number'),
                    content: Text(_safetyNumber!),
                    actions: [
                      TextButton(
                        onPressed: () => setState(() => _safetyNumber = null),
                        child: const Text('OK'),
                      ),
                    ],
                  ),
                ),
              Expanded(
                child: MessageList(
                  messages: messages,
                  controller: _controller,
                  target: target,
                  showReadTicks: peer != null,
                  readUpTo:
                      peer != null ? _controller.readUpToFor(peer) : 0,
                  onReply: _startReply,
                  onEdit: _startEdit,
                  onPin: (view) {
                    final id = view.id;
                    if (id == null || conversationKey == null) return;
                    _controller.sendPin(conversationKey, id, true);
                  },
                  onUnpin: (view) {
                    final id = view.id;
                    if (id == null || conversationKey == null) return;
                    _controller.sendPin(conversationKey, id, false);
                  },
                  canPin: canPin,
                  pinnedMessageId: pinnedId,
                ),
              ),
              if (typingLabel != null)
                Align(
                  alignment: Alignment.centerLeft,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
                    child: Text(
                      key: const Key('typing-line'),
                      typingLabel,
                      style: const TextStyle(
                        fontSize: 12,
                        fontStyle: FontStyle.italic,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ),
                ),
              MessageComposer(
                enabled:
                    _controller.connectionStatus == ConnectionStatus.connected,
                onSend: _send,
                onAttach: _attach,
                onSendPoll: _sendPoll,
                voiceRecorder: _voice,
                replyAuthor: reply == null
                    ? null
                    : _controller.displayNameOf(reply.author ?? ''),
                replyExcerpt: reply == null
                    ? null
                    : replyExcerptFor(
                        reply.body ?? reply.text,
                        mediaName: reply.media?.name,
                        poll: reply.poll,
                      ),
                onCancelReply: () => setState(() => _reply = null),
                editingBody: editing?.body ?? editing?.text,
                onCancelEdit: () => setState(() => _editing = null),
                onTyping: _handleTyping,
                onStopTyping: _controller.stopTyping,
                mentionCandidates: _mentionCandidates(),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ChatHeader extends StatelessWidget {
  const _ChatHeader({
    required this.title,
    required this.status,
    required this.showBack,
    required this.showStatusLabel,
    required this.onLogout,
    this.subtitle,
    this.onMembers,
    this.onSettings,
  });

  final String title;
  final String? subtitle;
  final ConnectionStatus status;
  final bool showBack;
  final bool showStatusLabel;
  final VoidCallback onLogout;
  final VoidCallback? onMembers;
  final VoidCallback? onSettings;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.surfaceGlass,
        border: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(showBack ? 4 : 16, 6, 8, 6),
        child: Row(
          children: [
            if (showBack)
              IconButton(
                tooltip: 'Back to conversations',
                onPressed: () => Navigator.pop(context),
                icon: const Icon(
                  Icons.arrow_back,
                  size: 22,
                  color: AppColors.textSecondary,
                ),
              ),
            const SizedBox(width: 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    key: const Key('chat-header-title'),
                    title,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -0.1,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  if (subtitle != null)
                    Text(
                      key: const Key('chat-header-subtitle'),
                      subtitle!,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                        letterSpacing: 0.3,
                        color: AppColors.textMuted,
                      ),
                    ),
                ],
              ),
            ),
            if (onMembers != null)
              IconButton(
                tooltip: 'Members',
                onPressed: onMembers,
                icon: const Icon(
                  Icons.people_outline,
                  size: 22,
                  color: AppColors.textSecondary,
                ),
              ),
            if (onSettings != null)
              IconButton(
                tooltip: 'Conversation settings',
                onPressed: onSettings,
                icon: const Icon(
                  Icons.tune,
                  size: 22,
                  color: AppColors.textSecondary,
                ),
              ),
            ConnectionBadge(status: status, showLabel: showStatusLabel),
            TextButton(onPressed: onLogout, child: const Text('Logout')),
          ],
        ),
      ),
    );
  }
}
