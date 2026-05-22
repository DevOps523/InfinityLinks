export type TelegramClientConfig = {
  botToken: string;
  channelId: string;
};

export type TelegramMessageResult = {
  messageId: number;
};

type TelegramApiResponse = {
  ok?: boolean;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
  result?: {
    message_id?: number;
  };
};

type TelegramFetcher = (url: string, init: RequestInit) => Promise<Response>;

export class TelegramRateLimitError extends Error {
  retryAfter: number;

  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = 'TelegramRateLimitError';
    this.retryAfter = retryAfter;
  }
}

async function readTelegramJson(response: Response): Promise<TelegramApiResponse> {
  try {
    return (await response.json()) as TelegramApiResponse;
  } catch {
    return {};
  }
}

function getTelegramErrorMessage(payload: TelegramApiResponse, fallback: string) {
  return typeof payload.description === 'string' && payload.description.length > 0 ? payload.description : fallback;
}

function throwTelegramError(response: Response, payload: TelegramApiResponse, method: string): never {
  const retryAfter = payload.parameters?.retry_after;
  const message = getTelegramErrorMessage(payload, `Telegram ${method} failed`);

  if ((response.status === 429 || payload.error_code === 429) && typeof retryAfter === 'number') {
    throw new TelegramRateLimitError(message, retryAfter);
  }

  throw new Error(message);
}

export function createTelegramClient(config: TelegramClientConfig, fetcher: TelegramFetcher = fetch) {
  async function post(method: string, body: Record<string, unknown>) {
    const response = await fetcher(`https://api.telegram.org/bot${config.botToken}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: config.channelId,
        ...body
      })
    });
    const payload = await readTelegramJson(response);

    if (!response.ok || payload.ok === false) {
      throwTelegramError(response, payload, method);
    }

    return payload;
  }

  return {
    async sendPhotoPost(input: { photo: string; caption: string }): Promise<TelegramMessageResult> {
      const payload = await post('sendPhoto', {
        photo: input.photo,
        caption: input.caption
      });
      const messageId = payload.result?.message_id;

      if (typeof messageId !== 'number') {
        throw new Error('Telegram sendPhoto response did not include message_id');
      }

      return { messageId };
    },

    async editPhotoCaption(input: { messageId: number; caption: string }): Promise<void> {
      await post('editMessageCaption', {
        message_id: input.messageId,
        caption: input.caption
      });
    },

    async deleteMessage(input: { messageId: number }): Promise<void> {
      await post('deleteMessage', {
        message_id: input.messageId
      });
    }
  };
}
