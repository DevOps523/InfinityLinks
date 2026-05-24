import type { PublicTelegramClient, TelegramUpdate } from './telegram.client.js';

export type PollState = {
  nextOffset?: number;
};

export type UpdateHandler = (update: TelegramUpdate) => Promise<void>;

export async function pollOnce(
  state: PollState,
  client: PublicTelegramClient,
  handleUpdate: UpdateHandler
) {
  const updates = await client.getUpdates({ offset: state.nextOffset, timeout: 30 });

  for (const update of updates) {
    try {
      await handleUpdate(update);
    } catch {
      // Advance past poison updates so one failing handler cannot stall polling forever.
    } finally {
      state.nextOffset = update.update_id + 1;
    }
  }
}
