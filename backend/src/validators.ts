import { z } from 'zod';
import type { ValidationResult } from './types';
import { CONSTANTS } from './types';

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

// Sender-generated per-message id; same shape as randomUUID() output.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidSchema = z.string().regex(UUID_PATTERN, { message: 'must be a UUID' });

const usernameSchema = z
  .string()
  .min(CONSTANTS.MIN_USERNAME_LENGTH)
  .max(CONSTANTS.MAX_USERNAME_LENGTH)
  .regex(/^[a-zA-Z0-9_-]+$/);

const ivSchema = z.string().min(1).max(CONSTANTS.MAX_IV_LENGTH).regex(BASE64_PATTERN);

const userJoinPayloadSchema = z.strictObject({
  username: usernameSchema,
});

const messagePayloadSchema = z.strictObject({
  id: uuidSchema,
  to: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH),
  ciphertext: z.string().min(1).max(CONSTANTS.MAX_CIPHERTEXT_LENGTH),
  iv: ivSchema,
});

const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/)
  .optional();

const registerPayloadSchema = z.strictObject({
  username: usernameSchema,
  password: z.string().min(CONSTANTS.MIN_PASSWORD_LENGTH).max(CONSTANTS.MAX_PASSWORD_LENGTH),
  pin: pinSchema,
});

const loginPayloadSchema = z.strictObject({
  username: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH),
  password: z.string().min(1).max(CONSTANTS.MAX_PASSWORD_LENGTH),
  pin: pinSchema,
});

const e2eePublicKeyPayloadSchema = z.strictObject({
  to: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH),
  publicKey: z.string().min(1).max(CONSTANTS.MAX_PUBLIC_KEY_LENGTH),
  mlkemPublicKey: z.string().min(1).optional(),
});

const groupCreatePayloadSchema = z.strictObject({
  name: z.string().min(1).max(CONSTANTS.MAX_GROUP_NAME_LENGTH),
  description: z.string().max(CONSTANTS.MAX_GROUP_DESCRIPTION_LENGTH).default(''),
  persistent: z.boolean().default(false),
  members: z
    .array(z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH))
    .max(CONSTANTS.MAX_GROUP_MEMBERS),
});

const groupUpdatePayloadSchema = z
  .strictObject({
    groupId: z.string().min(1),
    name: z.string().min(1).max(CONSTANTS.MAX_GROUP_NAME_LENGTH).optional(),
    description: z.string().max(CONSTANTS.MAX_GROUP_DESCRIPTION_LENGTH).optional(),
  })
  .refine((payload) => payload.name !== undefined || payload.description !== undefined, {
    message: 'at least one of "name" or "description" must be set',
  });

const groupMessagePayloadSchema = z.strictObject({
  id: uuidSchema,
  groupId: z.string().min(1),
  ciphertexts: z
    .array(
      z.strictObject({
        to: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH),
        ciphertext: z.string().min(1).max(CONSTANTS.MAX_CIPHERTEXT_LENGTH),
        iv: ivSchema,
      }),
    )
    .min(1)
    .max(CONSTANTS.MAX_GROUP_CIPHERTEXTS),
});

const groupTargetPayloadSchema = z.strictObject({
  groupId: z.string().min(1),
  username: usernameSchema,
});

// Conversation events address either a DM peer or a group — never both.
function exactlyOneTarget(payload: {
  readonly to?: string | undefined;
  readonly groupId?: string | undefined;
}): boolean {
  return (payload.to !== undefined) !== (payload.groupId !== undefined);
}

const conversationTargetFields = {
  to: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH).optional(),
  groupId: z.string().min(1).optional(),
} as const;

const exactlyOneTargetMessage = 'exactly one of "to" or "groupId" must be set';

const typingSendPayloadSchema = z
  .strictObject({
    ...conversationTargetFields,
    active: z.boolean(),
  })
  .refine(exactlyOneTarget, { message: exactlyOneTargetMessage });

const receiptReadPayloadSchema = z
  .strictObject({
    to: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH),
    upTo: z.number(),
  })
  .refine((payload) => payload.upTo <= Date.now() + CONSTANTS.RECEIPT_UP_TO_FUTURE_MS, {
    message: 'upTo is too far in the future',
  });

const emojiSchema = z
  .string()
  .min(1)
  .max(CONSTANTS.MAX_EMOJI_LENGTH)
  .refine((emoji) => !/[\s\p{Cc}]/u.test(emoji), {
    message: 'emoji must not contain whitespace or control characters',
  });

const messageReactPayloadSchema = z
  .strictObject({
    ...conversationTargetFields,
    targetId: uuidSchema,
    emoji: emojiSchema,
    active: z.boolean(),
  })
  .refine(exactlyOneTarget, { message: exactlyOneTargetMessage });

const messageEditPayloadSchema = z
  .strictObject({
    ...conversationTargetFields,
    targetId: uuidSchema,
    ciphertext: z.string().min(1).max(CONSTANTS.MAX_CIPHERTEXT_LENGTH),
    iv: z.string().min(1).max(CONSTANTS.MAX_IV_LENGTH),
  })
  .refine(exactlyOneTarget, { message: exactlyOneTargetMessage });

const messageDeletePayloadSchema = z
  .strictObject({
    ...conversationTargetFields,
    targetId: uuidSchema,
  })
  .refine(exactlyOneTarget, { message: exactlyOneTargetMessage });

const messagePinPayloadSchema = z
  .strictObject({
    ...conversationTargetFields,
    targetId: uuidSchema,
    pinned: z.boolean(),
  })
  .refine(exactlyOneTarget, { message: exactlyOneTargetMessage });

// Mirrors CONSTANTS.DISAPPEARING_PRESETS: off / 24 hours / 7 days / 30 days.
const disappearingSetPayloadSchema = z
  .strictObject({
    ...conversationTargetFields,
    seconds: z.union([z.literal(0), z.literal(86400), z.literal(604800), z.literal(2592000)]),
  })
  .refine(exactlyOneTarget, { message: exactlyOneTargetMessage });

// Poll definitions live inside the ciphertext, so only the pollId (the id of
// the message carrying the poll) and the chosen option index cross the wire.
const pollVotePayloadSchema = z
  .strictObject({
    ...conversationTargetFields,
    pollId: uuidSchema,
    option: z.number().int().min(0).max(9),
  })
  .refine(exactlyOneTarget, { message: exactlyOneTargetMessage });

const pollClosePayloadSchema = z
  .strictObject({
    ...conversationTargetFields,
    pollId: uuidSchema,
  })
  .refine(exactlyOneTarget, { message: exactlyOneTargetMessage });

const displayNameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, 'displayName must not be empty')
      .max(CONSTANTS.MAX_DISPLAY_NAME_LENGTH, {
        message: `displayName must be at most ${CONSTANTS.MAX_DISPLAY_NAME_LENGTH} characters`,
      })
      .refine((value) => !/\p{Cc}/u.test(value), {
        message: 'displayName must not contain control characters',
      }),
  );

const statusSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .max(CONSTANTS.MAX_STATUS_LENGTH, {
        message: `status must be at most ${CONSTANTS.MAX_STATUS_LENGTH} characters`,
      })
      .refine((value) => !/\p{Cc}/u.test(value), {
        message: 'status must not contain control characters',
      }),
  );

const profileUpdatePayloadSchema = z.strictObject({
  displayName: displayNameSchema,
  status: statusSchema,
});

function toValidationResult<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.issues.map((i) => i.message) };
}

export function validateUsername(input: unknown): ValidationResult<string> {
  return toValidationResult(usernameSchema, input);
}

// Both send events require a sender-generated UUIDv4 up front, before the
// event's own validation runs.
export function validateMessageId(input: unknown): ValidationResult<string> {
  return toValidationResult(uuidSchema, input);
}

export function validateUserJoinPayload(
  input: unknown,
): ValidationResult<{ readonly username: string }> {
  return toValidationResult(userJoinPayloadSchema, input);
}

export function validateMessagePayload(input: unknown): ValidationResult<{
  readonly id: string;
  readonly to: string;
  readonly ciphertext: string;
  readonly iv: string;
}> {
  return toValidationResult(messagePayloadSchema, input);
}

export function validateRegisterPayload(
  input: unknown,
): ValidationResult<z.infer<typeof registerPayloadSchema>> {
  return toValidationResult(registerPayloadSchema, input);
}

export function validateLoginPayload(
  input: unknown,
): ValidationResult<z.infer<typeof loginPayloadSchema>> {
  return toValidationResult(loginPayloadSchema, input);
}

export function validateE2eePublicKeyPayload(
  input: unknown,
): ValidationResult<{ readonly to: string; readonly publicKey: string; readonly mlkemPublicKey?: string | undefined }> {
  return toValidationResult(e2eePublicKeyPayloadSchema, input);
}

export function validateGroupCreatePayload(input: unknown): ValidationResult<{
  readonly name: string;
  readonly description: string;
  readonly persistent: boolean;
  readonly members: readonly string[];
}> {
  return toValidationResult(groupCreatePayloadSchema, input);
}

export function validateGroupUpdatePayload(
  input: unknown,
): ValidationResult<z.infer<typeof groupUpdatePayloadSchema>> {
  return toValidationResult(groupUpdatePayloadSchema, input);
}

export function validateGroupMessagePayload(input: unknown): ValidationResult<{
  readonly id: string;
  readonly groupId: string;
  readonly ciphertexts: readonly {
    readonly to: string;
    readonly ciphertext: string;
    readonly iv: string;
  }[];
}> {
  return toValidationResult(groupMessagePayloadSchema, input);
}

export function validateGroupTargetPayload(
  input: unknown,
): ValidationResult<{ readonly groupId: string; readonly username: string }> {
  return toValidationResult(groupTargetPayloadSchema, input);
}

export function validateTypingSendPayload(
  input: unknown,
): ValidationResult<z.infer<typeof typingSendPayloadSchema>> {
  return toValidationResult(typingSendPayloadSchema, input);
}

export function validateReceiptReadPayload(
  input: unknown,
): ValidationResult<{ readonly to: string; readonly upTo: number }> {
  return toValidationResult(receiptReadPayloadSchema, input);
}

export function validateMessageReactPayload(
  input: unknown,
): ValidationResult<z.infer<typeof messageReactPayloadSchema>> {
  return toValidationResult(messageReactPayloadSchema, input);
}

export function validateMessageEditPayload(
  input: unknown,
): ValidationResult<z.infer<typeof messageEditPayloadSchema>> {
  return toValidationResult(messageEditPayloadSchema, input);
}

export function validateMessageDeletePayload(
  input: unknown,
): ValidationResult<z.infer<typeof messageDeletePayloadSchema>> {
  return toValidationResult(messageDeletePayloadSchema, input);
}

export function validateMessagePinPayload(
  input: unknown,
): ValidationResult<z.infer<typeof messagePinPayloadSchema>> {
  return toValidationResult(messagePinPayloadSchema, input);
}

export function validateDisappearingSetPayload(
  input: unknown,
): ValidationResult<z.infer<typeof disappearingSetPayloadSchema>> {
  return toValidationResult(disappearingSetPayloadSchema, input);
}

export function validatePollVotePayload(
  input: unknown,
): ValidationResult<z.infer<typeof pollVotePayloadSchema>> {
  return toValidationResult(pollVotePayloadSchema, input);
}

export function validatePollClosePayload(
  input: unknown,
): ValidationResult<z.infer<typeof pollClosePayloadSchema>> {
  return toValidationResult(pollClosePayloadSchema, input);
}

export function validateProfileUpdatePayload(
  input: unknown,
): ValidationResult<{ readonly displayName: string; readonly status: string }> {
  return toValidationResult(profileUpdatePayloadSchema, input);
}

export function validateGroupMemberPromotePayload(
  input: unknown,
): ValidationResult<{ readonly groupId: string; readonly username: string }> {
  return validateGroupTargetPayload(input);
}

export function validateGroupMemberDemotePayload(
  input: unknown,
): ValidationResult<{ readonly groupId: string; readonly username: string }> {
  return validateGroupTargetPayload(input);
}

export function validateMessageRedactPayload(
  input: unknown,
): ValidationResult<z.infer<typeof messageDeletePayloadSchema>> {
  return validateMessageDeletePayload(input);
}

export function validateGroupKickResetPayload(
  input: unknown,
): ValidationResult<{ readonly groupId: string; readonly username: string }> {
  return validateGroupTargetPayload(input);
}

// ── Tier-8 call signaling validators ──
const callTargetSchema = z.strictObject({ to: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH) });

export function validateCallOfferPayload(input: unknown): ValidationResult<{ readonly to: string; readonly sdp: string }> {
  const schema = z.strictObject({ to: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH), sdp: z.string().min(1) });
  return toValidationResult(schema, input);
}
export function validateCallAnswerPayload(input: unknown): ValidationResult<{ readonly to: string; readonly sdp: string }> {
  const schema = z.strictObject({ to: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH), sdp: z.string().min(1) });
  return toValidationResult(schema, input);
}
export function validateCallIcePayload(input: unknown): ValidationResult<{ readonly to: string; readonly candidate: string }> {
  const schema = z.strictObject({ to: z.string().min(1).max(CONSTANTS.MAX_USERNAME_LENGTH), candidate: z.string().min(1) });
  return toValidationResult(schema, input);
}
export function validateCallEndPayload(input: unknown): ValidationResult<{ readonly to: string }> {
  return toValidationResult(callTargetSchema, input);
}
export function validateCallRejectPayload(input: unknown): ValidationResult<{ readonly to: string }> {
  return toValidationResult(callTargetSchema, input);
}
