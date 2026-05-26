import type { PublicSearchDatabase as AppDatabase } from '../db/database.js';
import type { TelegramUpdate } from '../telegram.client.js';
import type { createTelegramReplyQueue } from '../telegram.reply-queue.js';
import { getPublicSeasonDetails, hasPublicCatalog, searchPublicCatalog } from '../search.repository.js';
import { evaluateSearchAccess } from '../subscriptions/access.service.js';
import type { TelegramUserIdentity } from '../subscriptions/repository.js';
import { decodeSeasonCallback } from './callback-data.js';
import {
  formatClearMessage,
  formatNoResultsMessage,
  formatSearchValidationMessage,
  formatSearchResults,
  formatSeasonDetails,
  formatStartMessage,
  formatSubscriptionRequiredMessage,
  formatUnavailableMessage,
  type PublicBotMessage
} from './formatter.js';

type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

type ReplyQueue = Pick<
  ReturnType<typeof createTelegramReplyQueue>,
  'enqueueSendMessage' | 'enqueueAnswerCallbackQuery'
>;

type ReplyUserKey = number | string;

export type ReplyThrottleState = {
  shouldAllowFirstStart(userId: number | undefined): boolean;
  shouldSendWaitMessage(userId: number | undefined, retryAfterMs: number): boolean;
  clearWaitMessage(userId: number | undefined): void;
};

export type HandlerDeps = {
  db: AppDatabase;
  subscription: {
    now: () => Date;
    trialHours: number;
    adminContact: string;
  };
  replies: ReplyQueue;
  rateLimiter: {
    check(key: string): RateLimitResult;
  };
  groupHandle: string;
  replyThrottleState?: ReplyThrottleState;
};

const FIRST_START_EXEMPTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REPLY_THROTTLE_STATE_LIMIT = 10_000;

export function createReplyThrottleState(options: { now?: () => number; maxEntries?: number } = {}): ReplyThrottleState {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? DEFAULT_REPLY_THROTTLE_STATE_LIMIT;
  const firstStartUsers = new Map<ReplyUserKey, number>();
  const waitMessageUsers = new Map<ReplyUserKey, number>();

  return {
    shouldAllowFirstStart(userId) {
      const nowMs = now();
      pruneExpired(firstStartUsers, nowMs);

      const key = getUserKey(userId);
      if (firstStartUsers.has(key)) {
        return false;
      }

      rememberUntil(firstStartUsers, key, nowMs + FIRST_START_EXEMPTION_MS, maxEntries);
      return true;
    },
    shouldSendWaitMessage(userId, retryAfterMs) {
      const nowMs = now();
      pruneExpired(waitMessageUsers, nowMs);

      const key = getUserKey(userId);
      if (waitMessageUsers.has(key)) {
        return false;
      }

      rememberUntil(waitMessageUsers, key, nowMs + Math.max(1, retryAfterMs), maxEntries);
      return true;
    },
    clearWaitMessage(userId) {
      const nowMs = now();
      pruneExpired(waitMessageUsers, nowMs);
      waitMessageUsers.delete(getUserKey(userId));
    }
  };
}

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
    const userId = message.from?.id;
    if (!getReplyThrottleState(deps).shouldAllowFirstStart(userId) && !(await replyIfAllowed(deps, message.chat.id, userId))) {
      return;
    }

    await sendBotMessage(deps, message.chat.id, formatStartMessage(getHandles(deps)));
    return;
  }

  if (isCommand(text, 'clear')) {
    if (!(await replyIfAllowed(deps, message.chat.id, message.from?.id))) {
      return;
    }

    await sendBotMessage(deps, message.chat.id, formatClearMessage());
    return;
  }

  if (isCommand(text, 'search')) {
    const query = getCommandArgument(text);

    if (!query) {
      if (!(await replyIfAllowed(deps, message.chat.id, message.from?.id))) {
        return;
      }

      await sendBotMessage(deps, message.chat.id, formatSearchValidationMessage());
      return;
    }

    const user = getTelegramUser(message.from);
    if (!(await replyIfAllowed(deps, message.chat.id, user?.id))) {
      return;
    }

    await handleSearch(deps, message.chat.id, user, query);
    return;
  }

  if (text.startsWith('/')) {
    if (!(await replyIfAllowed(deps, message.chat.id, message.from?.id))) {
      return;
    }

    await sendBotMessage(deps, message.chat.id, formatStartMessage(getHandles(deps)));
  }
}

async function handleSearch(deps: HandlerDeps, chatId: number, user: TelegramUserIdentity | undefined, query: string) {
  const access = evaluateSearchAccess(deps.db, {
    user,
    now: deps.subscription.now(),
    trialHours: deps.subscription.trialHours
  });

  if (!access.allowed) {
    await sendBotMessage(deps, chatId, formatSubscriptionRequiredMessage(deps.subscription.adminContact));
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
  const rateLimit = checkReplyRateLimit(deps, callbackQuery.from.id, 'callback');
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
  const access = evaluateSearchAccess(deps.db, {
    user: getTelegramUser(callbackQuery.from),
    now: deps.subscription.now(),
    trialHours: deps.subscription.trialHours
  });

  if (!access.allowed) {
    await deps.replies.enqueueAnswerCallbackQuery({
      callbackQueryId,
      text: 'Subscription required.'
    });
    if (chatId !== undefined) {
      await sendBotMessage(deps, chatId, formatSubscriptionRequiredMessage(deps.subscription.adminContact));
    }
    return;
  }

  if (!hasPublicCatalog(deps.db)) {
    await deps.replies.enqueueAnswerCallbackQuery({
      callbackQueryId,
      text: 'Search is temporarily unavailable.'
    });
    if (chatId !== undefined) {
      await sendBotMessage(deps, chatId, formatUnavailableMessage());
    }
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

  await deps.replies.enqueueAnswerCallbackQuery({ callbackQueryId });

  for (const message of formatSeasonDetails(details, getHandles(deps))) {
    await sendBotMessage(deps, chatId, message);
  }
}

async function sendBotMessage(deps: HandlerDeps, chatId: number, message: PublicBotMessage) {
  await deps.replies.enqueueSendMessage({
    chatId,
    text: message.text,
    replyMarkup: message.replyMarkup
  });
}

function getUserKey(userId: number | undefined) {
  return userId ?? 'unknown';
}

function checkReplyRateLimit(deps: HandlerDeps, userId: number | undefined, interactionType: 'message' | 'callback') {
  return deps.rateLimiter.check(`${interactionType}:${getUserKey(userId)}`);
}

async function sendRateLimitMessage(deps: HandlerDeps, chatId: number, userId: number | undefined, retryAfterMs: number) {
  if (!getReplyThrottleState(deps).shouldSendWaitMessage(userId, retryAfterMs)) {
    return;
  }

  await deps.replies.enqueueSendMessage({
    chatId,
    text: formatWaitMessage(retryAfterMs)
  });
}

async function replyIfAllowed(deps: HandlerDeps, chatId: number, userId: number | undefined) {
  const rateLimit = checkReplyRateLimit(deps, userId, 'message');
  if (rateLimit.allowed) {
    getReplyThrottleState(deps).clearWaitMessage(userId);
    return true;
  }

  await sendRateLimitMessage(deps, chatId, userId, rateLimit.retryAfterMs);
  return false;
}

function getReplyThrottleState(deps: HandlerDeps) {
  deps.replyThrottleState ??= createReplyThrottleState();
  return deps.replyThrottleState;
}

function pruneExpired(entries: Map<ReplyUserKey, number>, nowMs: number) {
  for (const [key, expiresAtMs] of entries) {
    if (expiresAtMs <= nowMs) {
      entries.delete(key);
    }
  }
}

function rememberUntil(entries: Map<ReplyUserKey, number>, key: ReplyUserKey, expiresAtMs: number, maxEntries: number) {
  entries.set(key, expiresAtMs);

  while (entries.size > maxEntries) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    entries.delete(oldestKey);
  }
}

function isCommand(text: string, command: string) {
  return new RegExp(`^/${command}(?:@\\w+)?(?:\\s|$)`, 'i').test(text);
}

function getCommandArgument(text: string) {
  return text.replace(/^\/\w+(?:@\w+)?\s*/i, '').trim();
}

function getHandles(deps: HandlerDeps) {
  return {
    groupHandle: deps.groupHandle
  };
}

function getTelegramUser(from: { id: number; username?: string } | undefined): TelegramUserIdentity | undefined {
  return from ? { id: from.id, username: from.username } : undefined;
}

function formatWaitMessage(retryAfterMs: number) {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Please wait ${seconds} ${seconds === 1 ? 'second' : 'seconds'} before trying again.`;
}
