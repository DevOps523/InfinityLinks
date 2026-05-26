import type { PublicSearchDatabase } from '../db/database.js';
import type { TelegramChatMemberUpdated, TelegramUpdate } from '../telegram.client.js';
import { upsertSeenTelegramUser } from './repository.js';

const ACTIVE_MEMBER_STATUSES = new Set(['creator', 'administrator', 'member']);
const REMOVED_MEMBER_STATUSES = new Set(['left', 'kicked']);

export type SubscriptionBotDeps = {
  db: PublicSearchDatabase;
  now: () => Date;
  subscriptionGroupChatId?: number | undefined;
  botUserId?: number | undefined;
};

function userFromChatMemberUpdate(update: TelegramChatMemberUpdated) {
  const user = update.new_chat_member.user ?? update.old_chat_member.user;

  if (!user || !Number.isSafeInteger(user.id) || user.is_bot) {
    return undefined;
  }

  return { id: user.id, username: user.username };
}

function isConfiguredSubscriptionGroup(deps: SubscriptionBotDeps, update: TelegramChatMemberUpdated) {
  return deps.subscriptionGroupChatId === undefined || update.chat.id === deps.subscriptionGroupChatId;
}

function updateRemovedFromGroup(deps: SubscriptionBotDeps, telegramUserId: number, removedFromGroup: boolean, now: Date) {
  deps.db
    .prepare(
      `UPDATE subscription_users
       SET removed_from_group = @removedFromGroup,
           updated_at = @updatedAt
       WHERE telegram_user_id = @telegramUserId
         AND status != 'Kicked'`
    )
    .run({
      telegramUserId,
      removedFromGroup: removedFromGroup ? 1 : 0,
      updatedAt: now.toISOString()
    });
}

export async function handleSubscriptionBotUpdate(deps: SubscriptionBotDeps, update: TelegramUpdate): Promise<void> {
  const chatMemberUpdate = update.chat_member ?? update.my_chat_member;
  if (!chatMemberUpdate || !isConfiguredSubscriptionGroup(deps, chatMemberUpdate)) {
    return;
  }

  const user = userFromChatMemberUpdate(chatMemberUpdate);
  if (!user || user.id === deps.botUserId) {
    return;
  }

  const now = deps.now();
  upsertSeenTelegramUser(deps.db, user, now);

  if (ACTIVE_MEMBER_STATUSES.has(chatMemberUpdate.new_chat_member.status)) {
    updateRemovedFromGroup(deps, user.id, false, now);
    return;
  }

  if (REMOVED_MEMBER_STATUSES.has(chatMemberUpdate.new_chat_member.status)) {
    updateRemovedFromGroup(deps, user.id, true, now);
  }
}
