import type { PublicSearchDatabase as AppDatabase } from '../db/database.js';
import type { PublicTelegramClient, TelegramChatMember, TelegramUpdate } from '../telegram.client.js';
import type { createTelegramReplyQueue } from '../telegram.reply-queue.js';
import { getPublicSeasonDetails, hasPublicCatalog, searchPublicCatalog } from '../search.repository.js';
import { decodeSeasonCallback } from './callback-data.js';
import {
  formatJoinRequiredMessage,
  formatNoResultsMessage,
  formatSearchResults,
  formatSeasonDetails,
  formatStartMessage,
  formatUnavailableMessage,
  type PublicBotMessage
} from './formatter.js';

type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

type ReplyQueue = Pick<
  ReturnType<typeof createTelegramReplyQueue>,
  'enqueueSendMessage' | 'enqueueAnswerCallbackQuery'
>;

export type HandlerDeps = {
  db: AppDatabase;
  telegram: Pick<PublicTelegramClient, 'getChatMember'>;
  replies: ReplyQueue;
  rateLimiter: {
    check(key: string): RateLimitResult;
  };
  channelHandle: string;
  groupHandle: string;
};

const JOINED_STATUSES = new Set(['creator', 'administrator', 'member']);

export async function handleTelegramUpdate(deps: HandlerDeps, update: TelegramUpdate): Promise<void> {
  if (update.message) {
    await handleMessage(deps, update.message);
    return;
  }

  if (update.callback_query) {
    await handleCallbackQuery(deps, update.callback_query);
  }
}

async function handleMessage(deps: HandlerDeps, message: NonNullable<TelegramUpdate['message']>) {
  const text = message.text?.trim();

  if (!text) {
    return;
  }

  if (isCommand(text, 'start')) {
    await sendBotMessage(deps, message.chat.id, formatStartMessage(getHandles(deps)));
    return;
  }

  if (isCommand(text, 'search')) {
    const query = getCommandArgument(text);

    if (!query) {
      await sendBotMessage(deps, message.chat.id, formatStartMessage(getHandles(deps)));
      return;
    }

    const userId = message.from?.id;
    const rateLimit = checkRateLimit(deps, userId, 'message');
    if (!rateLimit.allowed) {
      await deps.replies.enqueueSendMessage({
        chatId: message.chat.id,
        text: formatWaitMessage(rateLimit.retryAfterMs)
      });
      return;
    }

    await handleSearch(deps, message.chat.id, userId, query);
    return;
  }

  if (text.startsWith('/')) {
    await sendBotMessage(deps, message.chat.id, formatStartMessage(getHandles(deps)));
  }
}

async function handleSearch(deps: HandlerDeps, chatId: number, userId: number | undefined, query: string) {
  const membership = await checkMembership(deps, userId);

  if (membership === 'not-joined') {
    await sendBotMessage(deps, chatId, formatJoinRequiredMessage(getHandles(deps)));
    return;
  }

  if (membership === 'unavailable') {
    await deps.replies.enqueueSendMessage({
      chatId,
      text: 'We could not verify your channel membership right now. Please try again later.'
    });
    return;
  }

  if (!hasPublicCatalog(deps.db)) {
    await sendBotMessage(deps, chatId, formatUnavailableMessage());
    return;
  }

  const results = searchPublicCatalog(deps.db, query, 10);
  const messages =
    results.length > 0 ? formatSearchResults(results, getHandles(deps)) : [formatNoResultsMessage(getHandles(deps))];

  for (const message of messages) {
    await sendBotMessage(deps, chatId, message);
  }
}

async function handleCallbackQuery(deps: HandlerDeps, callbackQuery: NonNullable<TelegramUpdate['callback_query']>) {
  const callbackQueryId = callbackQuery.id;
  const rateLimit = checkRateLimit(deps, callbackQuery.from.id, 'callback');
  if (!rateLimit.allowed) {
    await deps.replies.enqueueAnswerCallbackQuery({
      callbackQueryId,
      text: formatWaitMessage(rateLimit.retryAfterMs)
    });
    return;
  }

  const seasonId = callbackQuery.data ? decodeSeasonCallback(callbackQuery.data) : undefined;

  if (!seasonId) {
    await deps.replies.enqueueAnswerCallbackQuery({
      callbackQueryId,
      text: 'That button is no longer available.'
    });
    return;
  }

  const chatId = callbackQuery.message?.chat.id;
  const membership = await checkMembership(deps, callbackQuery.from.id);

  if (membership === 'not-joined') {
    if (chatId !== undefined) {
      await sendBotMessage(deps, chatId, formatJoinRequiredMessage(getHandles(deps)));
    }
    await deps.replies.enqueueAnswerCallbackQuery({
      callbackQueryId,
      text: 'Please join the channel first.'
    });
    return;
  }

  if (membership === 'unavailable') {
    if (chatId !== undefined) {
      await deps.replies.enqueueSendMessage({
        chatId,
        text: 'We could not verify your channel membership right now. Please try again later.'
      });
    }
    await deps.replies.enqueueAnswerCallbackQuery({
      callbackQueryId,
      text: 'Please try again later.'
    });
    return;
  }

  if (!hasPublicCatalog(deps.db)) {
    if (chatId !== undefined) {
      await sendBotMessage(deps, chatId, formatUnavailableMessage());
    }
    await deps.replies.enqueueAnswerCallbackQuery({
      callbackQueryId,
      text: 'Search is temporarily unavailable.'
    });
    return;
  }

  const details = getPublicSeasonDetails(deps.db, seasonId);

  if (!details || chatId === undefined) {
    await deps.replies.enqueueAnswerCallbackQuery({
      callbackQueryId,
      text: 'That button is no longer available.'
    });
    return;
  }

  for (const message of formatSeasonDetails(details, getHandles(deps))) {
    await sendBotMessage(deps, chatId, message);
  }

  await deps.replies.enqueueAnswerCallbackQuery({ callbackQueryId });
}

async function sendBotMessage(deps: HandlerDeps, chatId: number, message: PublicBotMessage) {
  await deps.replies.enqueueSendMessage({
    chatId,
    text: message.text,
    replyMarkup: message.replyMarkup
  });
}

async function checkMembership(
  deps: HandlerDeps,
  userId: number | undefined
): Promise<'joined' | 'not-joined' | 'unavailable'> {
  if (userId === undefined) {
    return 'not-joined';
  }

  let member: TelegramChatMember;
  try {
    member = await deps.telegram.getChatMember({
      chatId: deps.channelHandle,
      userId
    });
  } catch {
    return 'unavailable';
  }

  return JOINED_STATUSES.has(member.status) ? 'joined' : 'not-joined';
}

function checkRateLimit(deps: HandlerDeps, userId: number | undefined, interactionType: 'message' | 'callback') {
  return deps.rateLimiter.check(`${interactionType}:${userId ?? 'unknown'}`);
}

function isCommand(text: string, command: string) {
  return new RegExp(`^/${command}(?:@\\w+)?(?:\\s|$)`, 'i').test(text);
}

function getCommandArgument(text: string) {
  return text.replace(/^\/\w+(?:@\w+)?\s*/i, '').trim();
}

function getHandles(deps: HandlerDeps) {
  return {
    channelHandle: deps.channelHandle,
    groupHandle: deps.groupHandle
  };
}

function formatWaitMessage(retryAfterMs: number) {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Please wait ${seconds} ${seconds === 1 ? 'second' : 'seconds'} before trying again.`;
}
