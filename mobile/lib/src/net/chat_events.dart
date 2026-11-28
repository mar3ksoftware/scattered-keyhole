/// Event names from `backend/src/types.ts`.
///
/// Kept as string constants (rather than an enum) because the values are the
/// literal Socket.io event names used on the wire.
abstract final class ChatEvents {
  // Client -> server.
  static const userJoin = 'user:join';
  static const messageSend = 'message:send';
  static const e2eePublicKey = 'e2ee:public_key';
  static const e2eeMlkemCt = 'e2ee:mlkem_ct';
  static const userRegister = 'user:register';
  static const userLogin = 'user:login';
  static const groupCreate = 'group:create';
  static const groupMessageSend = 'group:message:send';
  static const groupMemberAdd = 'group:member:add';
  static const groupMemberRemove = 'group:member:remove';
  static const groupKickVote = 'group:kick:vote';
  static const typingSend = 'typing:send';
  static const receiptRead = 'receipt:read';
  static const messageReact = 'message:react';
  static const messageEdit = 'message:edit';
  static const messageDelete = 'message:delete';
  static const profileUpdate = 'profile:update';
  static const pollVote = 'poll:vote';
  static const pollClose = 'poll:close';
  static const groupUpdate = 'group:update';
  static const groupTopology = 'group:topology';
  static const messagePin = 'message:pin';
  static const disappearingSet = 'disappearing:set';

  // Group calls (mesh signaling + SFU token request).
  static const groupCallJoin = 'group_call:join';
  static const groupCallLeave = 'group_call:leave';
  static const groupCallOffer = 'group_call:offer';
  static const groupCallAnswer = 'group_call:answer';
  static const groupCallIce = 'group_call:ice';
  static const groupCallSfuToken = 'group_call:sfu_token';

  // Call signaling (Tier-8a) uses the same event names in both directions;
  // the server relays each one with `from`/`fromUsername` attached.
  static const callOffer = 'call:offer';
  static const callAnswer = 'call:answer';
  static const callIce = 'call:ice';
  static const callEnd = 'call:end';
  static const callReject = 'call:reject';

  // Server -> client.
  static const mediaToken = 'media:token';
  static const userJoined = 'user:joined';
  static const userLeft = 'user:left';
  static const privateMessage = 'private_message';
  static const deliveryFailed = 'delivery_failed';
  static const messageRejected = 'message_rejected';
  static const activeUsers = 'active_users';
  static const activeGroups = 'active_groups';
  static const error = 'error';
  static const registerSuccess = 'register_success';
  static const registerError = 'register_error';
  static const loginSuccess = 'login_success';
  static const loginError = 'login_error';
  static const groupCreated = 'group:created';
  static const groupCreatedError = 'group:created_error';
  static const groupMessage = 'group:message';
  static const groupMessageDeliveryFailed = 'group:message_delivery_failed';
  static const usersDirectory = 'users:directory';
  static const typingChanged = 'typing:changed';
  static const receiptReadIn = 'receipt:read';
  static const messageReacted = 'message:reacted';
  static const messageEdited = 'message:edited';
  static const messageDeleted = 'message:deleted';
  static const profileUpdated = 'profile:updated';
  static const groupMemberRemoved = 'group:member:removed';
  static const groupKickTally = 'group:kick:tally';
  static const pollVoted = 'poll:voted';
  static const pollClosed = 'poll:closed';
  static const groupUpdated = 'group:updated';
  static const groupCallRoster = 'group_call:roster';
  static const groupCallJoined = 'group_call:joined';
  static const groupCallLeft = 'group_call:left';
  static const groupCallSfuCredentials = 'group_call:sfu_credentials';
  static const messagePinned = 'message:pinned';
  static const disappearingChanged = 'disappearing:changed';
  static const notice = 'notice';
  static const groupMemberPromote = 'group:member:promote';
  static const groupMemberDemote = 'group:member:demote';
  static const messageRedact = 'message:redact';
  static const groupKickReset = 'group:kick:reset';

  // Socket.io lifecycle.
  static const connect = 'connect';
  static const disconnect = 'disconnect';
  static const connectError = 'connect_error';
  static const reconnectAttempt = 'reconnect_attempt';
}
