export type TelegramFetcher = (url: string, init: RequestInit) => Promise<Response>;

export type InlineKeyboardButton = {
  text: string;
  url?: string;
  callback_data?: string;
};

export type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

export type TelegramMessage = {
  message_id: number;
  chat: {
    id: number;
    type?: string;
    username?: string;
  };
  from?: {
    id: number;
    username?: string;
    first_name?: string;
  };
  text?: string;
};

export type TelegramCallbackQuery = {
  id: string;
  from: {
    id: number;
    username?: string;
    first_name?: string;
  };
  message?: TelegramMessage;
  data?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type TelegramChatMember = {
  status: string;
  user?: {
    id: number;
    username?: string;
    first_name?: string;
  };
};

type TelegramApiResponse<TResult> = {
  ok?: boolean;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
  result?: TResult;
};

export class TelegramRateLimitError extends Error {
  retryAfter: number;

  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = 'TelegramRateLimitError';
    this.retryAfter = retryAfter;
  }
}

function getTelegramErrorMessage(payload: TelegramApiResponse<unknown>, fallback: string) {
  return typeof payload.description === 'string' && payload.description.length > 0 ? payload.description : fallback;
}

function throwTelegramError(response: Response, payload: TelegramApiResponse<unknown>, method: string): never {
  const retryAfter = payload.parameters?.retry_after;
  const message = getTelegramErrorMessage(payload, `Telegram ${method} failed`);

  if ((response.status === 429 || payload.error_code === 429) && typeof retryAfter === 'number') {
    throw new TelegramRateLimitError(message, retryAfter);
  }

  throw new Error(message);
}

async function readTelegramJson<TResult>(
  response: Response,
  method: string
): Promise<TelegramApiResponse<TResult>> {
  try {
    return (await response.json()) as TelegramApiResponse<TResult>;
  } catch {
    throw new Error(`Telegram ${method} returned invalid JSON`);
  }
}

function stripUndefinedFields(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export function createPublicTelegramClient(
  { botToken }: { botToken: string },
  fetcher: TelegramFetcher = fetch
) {
  async function post<TResult>(method: string, body: Record<string, unknown>): Promise<TResult | undefined> {
    const response = await fetcher(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(stripUndefinedFields(body))
    });
    const payload = await readTelegramJson<TResult>(response, method);

    if (!response.ok || payload.ok !== true) {
      throwTelegramError(response, payload, method);
    }

    return payload.result;
  }

  return {
    async getUpdates(input: { offset?: number | undefined; timeout?: number | undefined }): Promise<TelegramUpdate[]> {
      const result = await post<TelegramUpdate[]>('getUpdates', {
        offset: input.offset,
        timeout: input.timeout
      });

      return result ?? [];
    },

    async sendMessage(input: { chatId: number; text: string; replyMarkup?: InlineKeyboardMarkup | undefined }): Promise<void> {
      await post('sendMessage', {
        chat_id: input.chatId,
        text: input.text,
        reply_markup: input.replyMarkup
      });
    },

    async answerCallbackQuery(input: { callbackQueryId: string; text?: string }): Promise<void> {
      await post('answerCallbackQuery', {
        callback_query_id: input.callbackQueryId,
        text: input.text
      });
    },

    async getChatMember(input: { chatId: string; userId: number }): Promise<TelegramChatMember> {
      const result = await post<TelegramChatMember>('getChatMember', {
        chat_id: input.chatId,
        user_id: input.userId
      });

      if (!result) {
        throw new Error('Telegram getChatMember response did not include result');
      }

      return result;
    }
  };
}

export type PublicTelegramClient = ReturnType<typeof createPublicTelegramClient>;
