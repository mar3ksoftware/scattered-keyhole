import 'dart:async';

import 'package:flutter/material.dart';

import '../../state/voice_recorder.dart';
import '../../utils/mentions.dart';
import '../../utils/time.dart';
import '../theme/app_theme.dart';

/// Single-line composer with a Send button, local send-error text and a
/// disconnected state — the native counterpart of the web `MessageInput`.
///
/// Tier-1 additions: reply/edit context bars above the input, typing burst
/// callbacks (C1) and the group-only `@` autocomplete (C8).
///
/// Spec lane additions: the poll composer panel (C1) and the voice
/// recording bar driven by an injected [VoiceRecorderController] (H).
class MessageComposer extends StatefulWidget {
  const MessageComposer({
    super.key,
    required this.onSend,
    required this.enabled,
    this.onAttach,
    this.onSendPoll,
    this.voiceRecorder,
    this.replyAuthor,
    this.replyExcerpt,
    this.onCancelReply,
    this.editingBody,
    this.onCancelEdit,
    this.onTyping,
    this.onStopTyping,
    this.mentionCandidates,
  });

  /// Attempts to send the trimmed text; returns false when it did not go out.
  final Future<bool> Function(String text) onSend;

  /// False while the socket is disconnected: input and button are disabled.
  final bool enabled;

  /// Picks and sends an attachment; the attach button is hidden when null.
  final Future<bool> Function()? onAttach;

  /// Sends a poll envelope; null hides the poll toggle button.
  final Future<bool> Function(String question, List<String> options)? onSendPoll;

  /// Voice recorder state machine; null hides the mic button (spec H).
  final VoiceRecorderController? voiceRecorder;

  /// Author of the message being replied to; null hides the reply bar (C4).
  final String? replyAuthor;

  /// Excerpt shown under the reply author.
  final String? replyExcerpt;

  /// Clears the pending reply (✕ on the reply bar).
  final VoidCallback? onCancelReply;

  /// Body of the message being edited; non-null shows the edit context bar
  /// and prefills the input (C6).
  final String? editingBody;

  /// Cancels the inline edit and restores an empty composer.
  final VoidCallback? onCancelEdit;

  /// Called on each keystroke of a fresh burst — the controller throttles
  /// the repeat cadence (C1). Not called while an edit is pending.
  final VoidCallback? onTyping;

  /// Ends the typing burst: the input went empty or the message went out.
  final VoidCallback? onStopTyping;

  /// Group member usernames powering the `@` autocomplete; null/empty
  /// disables it (DMs never autocomplete, C8).
  final List<String>? mentionCandidates;

  @override
  State<MessageComposer> createState() => _MessageComposerState();
}

class _MessageComposerState extends State<MessageComposer> {
  static const int _maxMessageLength = 5000;

  /// Web parity: at most six autocomplete rows (C8).
  static const int _maxSuggestions = 6;

  // Poll composer bounds (spec B1, mirrors the web constants).
  static const int _maxPollQuestion = 200;
  static const int _minPollOptions = 2;
  static const int _maxPollOptions = 10;
  static const int _maxPollOption = 60;

  final TextEditingController _textController = TextEditingController();
  bool _sending = false;
  bool _attaching = false;
  String? _localError;
  List<String> _suggestions = const <String>[];

  // ── Poll composer state (C1) ───────────────────────────────────────
  bool _pollOpen = false;
  String _pollQuestion = '';
  List<_PollOptionRow> _pollOptions = <_PollOptionRow>[
    const _PollOptionRow(0),
    const _PollOptionRow(1),
  ];
  int _nextPollOptionId = 2;
  bool _pollSending = false;

  bool get _editing => widget.editingBody != null;

  @override
  void initState() {
    super.initState();
    if (widget.editingBody != null) {
      _textController.text = widget.editingBody!;
    }
  }

  @override
  void didUpdateWidget(MessageComposer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.editingBody != oldWidget.editingBody) {
      if (widget.editingBody != null) {
        // Edit started: prefill the draft with the original body (C6).
        _textController.text = widget.editingBody!;
        _textController.selection = TextSelection.collapsed(
          offset: _textController.text.length,
        );
      } else if (oldWidget.editingBody != null) {
        // Edit finished or cancelled — the draft is no longer meaningful.
        _textController.clear();
      }
      _updateSuggestions();
    }
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  bool get _canSend =>
      widget.enabled &&
      !_sending &&
      !_attaching &&
      _textController.text.trim().isNotEmpty;

  bool get _busy => _sending || _attaching;

  // ── Typing (C1) ──────────────────────────────────────────────────────

  void _handleChanged(String _) {
    if (_textController.text.isEmpty) {
      widget.onStopTyping?.call();
    } else if (!_editing) {
      widget.onTyping?.call();
    }
    _updateSuggestions();
    setState(() {});
  }

  // ── Group `@` autocomplete (C8) ──────────────────────────────────────

  void _updateSuggestions() {
    final candidates = widget.mentionCandidates;
    if (candidates == null ||
        candidates.isEmpty ||
        _editing ||
        !widget.enabled) {
      _suggestions = const <String>[];
      return;
    }
    final text = _textController.text;
    final cursor = _textController.selection.isValid
        ? _textController.selection.baseOffset
        : text.length;
    final token = mentionTokenBefore(text, cursor);
    if (token == null) {
      _suggestions = const <String>[];
      return;
    }
    final query = token.toLowerCase();
    _suggestions = [
      for (final name in candidates)
        if (name.toLowerCase().startsWith(query)) name,
    ].take(_maxSuggestions).toList();
  }

  void _applySuggestion(String name) {
    final text = _textController.text;
    final cursor = _textController.selection.isValid
        ? _textController.selection.baseOffset
        : text.length;
    final token = mentionTokenBefore(text, cursor);
    if (token == null) return;
    // `start` is the index of the `@` itself (the token excludes it).
    final start = cursor - token.length - 1;
    final next = '${text.substring(0, start)}@$name ${text.substring(cursor)}';
    _textController.text = next;
    _textController.selection = TextSelection.collapsed(
      offset: start + name.length + 2,
    );
    _updateSuggestions();
    setState(() {});
  }

  // ── Send / attach ────────────────────────────────────────────────────

  Future<void> _send() async {
    if (_suggestions.isNotEmpty) {
      // Enter accepts the highlighted autocomplete row while it is open (C8).
      _applySuggestion(_suggestions.first);
      return;
    }
    final text = _textController.text.trim();
    if (text.isEmpty || _busy || !widget.enabled) return;
    setState(() {
      _sending = true;
      _localError = null;
    });
    var sent = false;
    try {
      sent = await widget.onSend(text);
    } catch (_) {
      sent = false;
    }
    if (!mounted) return;
    setState(() {
      _sending = false;
      if (sent) {
        _textController.clear();
        _localError = null;
        _suggestions = const <String>[];
      } else {
        _localError = 'Message not sent. Please try again.';
      }
    });
    if (sent) widget.onStopTyping?.call();
  }

  Future<void> _attach() async {
    final onAttach = widget.onAttach;
    if (onAttach == null || _busy || !widget.enabled) return;
    setState(() => _attaching = true);
    try {
      await onAttach();
    } catch (_) {
      // The controller already toasts the specific attachment failure.
    }
    if (!mounted) return;
    setState(() => _attaching = false);
  }

  // ── Poll composer (C1) ─────────────────────────────────────────────

  /// Trimmed-then-validated like the web `pollValid`; [wrapPollEnvelope]
  /// re-checks the raw values on the send path.
  bool get _pollValid {
    final question = _pollQuestion.trim();
    final options = [
      for (final row in _pollOptions) row.value.trim(),
    ];
    if (question.isEmpty || question.length > _maxPollQuestion) return false;
    if (options.length < _minPollOptions || options.length > _maxPollOptions) {
      return false;
    }
    for (final option in options) {
      if (option.isEmpty || option.length > _maxPollOption) return false;
    }
    return options.toSet().length == options.length;
  }

  bool get _canSendPoll =>
      _pollValid && !_pollSending && widget.enabled && !_busy;

  void _closePollPanel() {
    setState(() {
      _pollOpen = false;
      _pollQuestion = '';
      _pollOptions = <_PollOptionRow>[
        const _PollOptionRow(0),
        const _PollOptionRow(1),
      ];
      _nextPollOptionId = 2;
    });
  }

  Future<void> _sendPoll() async {
    if (!_canSendPoll) return;
    final question = _pollQuestion.trim();
    final options = [
      for (final row in _pollOptions) row.value.trim(),
    ];
    setState(() {
      _pollSending = true;
      _localError = null;
    });
    var sent = false;
    try {
      sent = await widget.onSendPoll!(question, options);
    } catch (_) {
      sent = false;
    }
    if (!mounted) return;
    setState(() {
      _pollSending = false;
      if (sent) {
        _closePollPanel();
      } else {
        _localError = 'Message not sent. Please try again.';
      }
    });
    if (sent) widget.onStopTyping?.call();
  }

  // ── Voice recorder (spec H) ────────────────────────────────────────

  bool get _recording =>
      widget.voiceRecorder?.status == VoiceRecorderStatus.recording;

  /// The voice failure text (permission or send) shown in the error row.
  String? get _voiceError => widget.voiceRecorder?.error;

  // ── Context bars (C4/C6) ─────────────────────────────────────────────

  Widget _contextBar({
    required Key key,
    required String author,
    required String excerpt,
    required VoidCallback onCancel,
  }) {
    return Container(
      key: key,
      margin: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      padding: const EdgeInsets.fromLTRB(12, 6, 4, 6),
      decoration: BoxDecoration(
        color: AppColors.accentTint,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.accentBorder),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  author,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppColors.accentSoft,
                  ),
                ),
                Text(
                  excerpt,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Cancel',
            visualDensity: VisualDensity.compact,
            onPressed: onCancel,
            icon: const Icon(Icons.close, size: 18, color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _replyBar() {
    final author = widget.replyAuthor;
    if (author == null) return const SizedBox.shrink();
    return _contextBar(
      key: const Key('reply-context-bar'),
      author: author,
      excerpt: widget.replyExcerpt ?? '',
      onCancel: () => widget.onCancelReply?.call(),
    );
  }

  Widget _editBar() {
    final body = widget.editingBody;
    if (body == null) return const SizedBox.shrink();
    return Container(
      key: const Key('edit-context-bar'),
      margin: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
      decoration: BoxDecoration(
        color: AppColors.accentTint,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.accentBorder),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              body,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 12,
                fontStyle: FontStyle.italic,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          IconButton(
            tooltip: 'Cancel',
            visualDensity: VisualDensity.compact,
            onPressed: () => widget.onCancelEdit?.call(),
            icon: const Icon(Icons.close, size: 18, color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _autocomplete() {
    if (_suggestions.isEmpty) return const SizedBox.shrink();
    return Container(
      key: const Key('mention-autocomplete'),
      margin: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      constraints: const BoxConstraints(maxHeight: 140),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: ListView.builder(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(vertical: 4),
        itemCount: _suggestions.length,
        itemBuilder: (context, index) {
          final name = _suggestions[index];
          return InkWell(
            key: ValueKey<String>('mention-suggestion-$name'),
            onTap: () => _applySuggestion(name),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              child: Text(
                name,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textBody,
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  // ── Poll panel (C1) ────────────────────────────────────────────────

  Widget _pollPanel() {
    final canAddOption = _pollOptions.length < _maxPollOptions;
    return Container(
      key: const Key('poll-panel'),
      margin: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Text(
              'Create poll',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
              ),
            ),
          ),
          TextField(
            key: const Key('poll-question'),
            enabled: !_pollSending,
            maxLength: _maxPollQuestion,
            onChanged: (value) => setState(() => _pollQuestion = value),
            style: const TextStyle(fontSize: 14, color: AppColors.textBody),
            decoration: InputDecoration(
              counterText: '',
              hintText: 'Question',
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: AppColors.border),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: AppColors.border),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: AppColors.accent, width: 1.5),
              ),
              hintStyle: const TextStyle(fontSize: 14, color: AppColors.textMuted),
            ),
          ),
          const SizedBox(height: 8),
          for (var index = 0; index < _pollOptions.length; index++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      key: Key('poll-option-$index'),
                      enabled: !_pollSending,
                      maxLength: _maxPollOption,
                      onChanged: (value) => setState(
                        () => _pollOptions[index] = _PollOptionRow(
                          _pollOptions[index].id,
                          value,
                        ),
                      ),
                      style: const TextStyle(fontSize: 14, color: AppColors.textBody),
                      decoration: InputDecoration(
                        counterText: '',
                        hintText: 'Option ${index + 1}',
                        isDense: true,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 10,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: const BorderSide(color: AppColors.border),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: const BorderSide(color: AppColors.border),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: const BorderSide(
                            color: AppColors.accent,
                            width: 1.5,
                          ),
                        ),
                        hintStyle: const TextStyle(
                          fontSize: 14,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ),
                  ),
                  if (_pollOptions.length > _minPollOptions)
                    IconButton(
                      key: Key('poll-remove-option-$index'),
                      tooltip: 'Remove option ${index + 1}',
                      visualDensity: VisualDensity.compact,
                      onPressed: _pollSending
                          ? null
                          : () => setState(() => _pollOptions.removeAt(index)),
                      icon: const Icon(
                        Icons.close,
                        size: 16,
                        color: AppColors.textMuted,
                      ),
                    ),
                ],
              ),
            ),
          Row(
            children: [
              TextButton(
                key: const Key('poll-add-option'),
                onPressed: !canAddOption || _pollSending
                    ? null
                    : () => setState(() {
                          _pollOptions = <_PollOptionRow>[
                            ..._pollOptions,
                            _PollOptionRow(_nextPollOptionId++),
                          ];
                        }),
                child: const Text('Add option', style: TextStyle(fontSize: 13)),
              ),
              const Spacer(),
              TextButton(
                key: const Key('poll-cancel'),
                onPressed: _pollSending ? null : _closePollPanel,
                child: const Text('Cancel', style: TextStyle(fontSize: 13)),
              ),
              const SizedBox(width: 4),
              FilledButton(
                key: const Key('poll-send'),
                onPressed: _canSendPoll ? () => unawaited(_sendPoll()) : null,
                child: _pollSending
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Send'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ── Recording bar (spec D/H) ───────────────────────────────────────

  Widget _recordingBar(VoiceRecorderController voice) {
    return Container(
      key: const Key('voice-recording-bar'),
      margin: const EdgeInsets.symmetric(horizontal: 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.dangerTint,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.dangerBorder),
      ),
      child: Row(
        children: [
          const Icon(Icons.fiber_manual_record, size: 12, color: AppColors.danger),
          const SizedBox(width: 8),
          Text(
            key: const Key('voice-elapsed'),
            formatVoiceTime(voice.elapsed),
            style: const TextStyle(
              fontSize: 13,
              fontFeatures: <FontFeature>[FontFeature.tabularFigures()],
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(width: 10),
          const Expanded(
            child: Text(
              'Recording…',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
            ),
          ),
          FilledButton(
            key: const Key('voice-send'),
            onPressed: () => unawaited(voice.send()),
            style: FilledButton.styleFrom(
              minimumSize: const Size(64, 36),
              padding: const EdgeInsets.symmetric(horizontal: 14),
            ),
            child: const Text('Send', style: TextStyle(fontSize: 12)),
          ),
          const SizedBox(width: 6),
          Tooltip(
            message: 'Cancel recording',
            child: TextButton(
              key: const Key('voice-cancel'),
              onPressed: () => unawaited(voice.cancel()),
              child: const Text('Cancel', style: TextStyle(fontSize: 12)),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final voice = widget.voiceRecorder;
    if (voice == null) return _buildBody(context);
    return ListenableBuilder(
      listenable: voice,
      builder: (context, _) => _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    final voice = widget.voiceRecorder;
    final error = _localError ?? _voiceError;
    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
              child: Text(
                error,
                style: const TextStyle(fontSize: 12, color: AppColors.dangerSoft),
              ),
            ),
          _replyBar(),
          _editBar(),
          if (_pollOpen && widget.onSendPoll != null) _pollPanel(),
          _autocomplete(),
          if (_recording && voice != null)
            _recordingBar(voice)
          else
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (widget.onAttach != null && !_editing)
                  IconButton(
                    onPressed:
                        _busy || !widget.enabled ? null : _attach,
                    tooltip: 'Attach file',
                    icon: _attaching
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AppColors.accent,
                            ),
                          )
                        : const Icon(Icons.attach_file_outlined, size: 22),
                  ),
                if (widget.onSendPoll != null && !_editing)
                  IconButton(
                    key: const Key('poll-toggle-button'),
                    tooltip: 'Create poll',
                    onPressed: _busy || !widget.enabled
                        ? null
                        : () => setState(() => _pollOpen = !_pollOpen),
                    icon: Icon(
                      Icons.bar_chart,
                      size: 22,
                      color: _pollOpen ? AppColors.accentSoft : null,
                    ),
                  ),
                if (widget.voiceRecorder != null && !_editing)
                  IconButton(
                    key: const Key('voice-record-button'),
                    tooltip: 'Record voice message',
                    onPressed: _busy || !widget.enabled
                        ? null
                        : () => unawaited(widget.voiceRecorder!.start()),
                    icon: const Icon(Icons.mic_none, size: 22),
                  ),
              Expanded(
                child: TextField(
                  controller: _textController,
                  enabled: widget.enabled && !_busy,
                  onChanged: _handleChanged,
                  onSubmitted: (_) => _send(),
                  textInputAction: TextInputAction.send,
                  textCapitalization: TextCapitalization.sentences,
                  maxLength: _maxMessageLength,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.4,
                    color: AppColors.textPrimary,
                  ),
                  decoration: InputDecoration(
                    counterText: '',
                    hintText: widget.enabled ? 'Type a message…' : 'Disconnected…',
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 13,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(
                        color: AppColors.accent,
                        width: 1.5,
                      ),
                    ),
                    disabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                    filled: true,
                    fillColor: widget.enabled
                        ? AppColors.fill
                        : AppColors.fill.withValues(alpha: 0.4),
                    hintStyle: const TextStyle(
                      fontSize: 14,
                      color: AppColors.textMuted,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: _canSend ? _send : null,
                  style: ElevatedButton.styleFrom(
                    minimumSize: const Size(72, 48),
                    padding: const EdgeInsets.symmetric(horizontal: 18),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: _sending
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Send'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// One option row in the poll panel: a stable id (survives removals) plus
/// the current field value.
class _PollOptionRow {
  const _PollOptionRow(this.id, [this.value = '']);

  final int id;
  final String value;
}
