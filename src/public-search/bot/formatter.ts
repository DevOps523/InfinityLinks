import type { PublicProvider, PublicSearchResult, PublicSeasonDetails } from '../search.repository.js';
import type { InlineKeyboardButton, InlineKeyboardMarkup } from '../telegram.client.js';
import { encodeSeasonCallback } from './callback-data.js';

export const MAX_FORMATTED_MESSAGE_LENGTH = 3500;
export const MAX_INLINE_KEYBOARD_ROWS = 20;
export const MAX_INLINE_KEYBOARD_BUTTONS = 40;

const MOVIE_PROVIDER_BUTTONS_PER_ROW = 2;
const SEASON_PROVIDER_BUTTONS_PER_ROW = 2;
const TV_SEASON_BUTTONS_PER_ROW = 3;

export type PublicBotHandles = {
  channelHandle: string;
  groupHandle: string;
};

export type PublicBotMessage = {
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
};

export function formatStartMessage(handles: PublicBotHandles): PublicBotMessage {
  return {
    text: [
      'Welcome to InfinityLinks Search.',
      '',
      'Use:',
      '/search movie or tv show name',
      '',
      'Examples:',
      '/search inception',
      '/search breaking bad',
      '',
      formatHandles(handles)
    ].join('\n')
  };
}

export function formatJoinRequiredMessage(handles: PublicBotHandles): PublicBotMessage {
  return {
    text: [
      'Please join our channel first, then come back and use /search again.',
      '',
      formatHandles(handles)
    ].join('\n')
  };
}

export function formatNoResultsMessage(handles: PublicBotHandles): PublicBotMessage {
  return {
    text: [
      'No results found. Try checking the spelling or using fewer words.',
      '',
      formatHandles(handles)
    ].join('\n')
  };
}

export function formatUnavailableMessage(): PublicBotMessage {
  return {
    text: 'Search is temporarily unavailable. Please try again later.'
  };
}

export function formatSearchResults(results: PublicSearchResult[], handles: PublicBotHandles): PublicBotMessage[] {
  return results.map((result) => {
    if (result.type === 'movie') {
      return formatMovieResult(result, handles);
    }

    return formatTvResult(result, handles);
  });
}

export function formatSeasonDetails(details: PublicSeasonDetails, handles: PublicBotHandles): PublicBotMessage[] {
  const header = [formatTitle(details.showTitle, details.showYear), `Season ${details.seasonNumber}`].join('\n');
  const footer = formatHandles(handles);
  const messages: PublicBotMessage[] = [];
  let blocks: string[] = [];
  let keyboardRows: InlineKeyboardButton[][] = [];

  const flushMessage = () => {
    if (blocks.length === 0 && keyboardRows.length === 0) {
      return;
    }

    messages.push({
      text: composeSeasonDetailsText(header, blocks, footer),
      replyMarkup: toReplyMarkup(keyboardRows)
    });
    blocks = [];
    keyboardRows = [];
  };

  for (const episode of details.episodes) {
    const block = [`Episode ${episode.episodeNumber}`, 'Providers:'].join('\n');
    const episodeRows = chunkButtons(
      providerButtons(episode.providers, `E${episode.episodeNumber} `),
      SEASON_PROVIDER_BUTTONS_PER_ROW
    );
    let rowIndex = 0;

    while (rowIndex < episodeRows.length) {
      const rowsToAdd = countFittingRows({
        header,
        footer,
        existingBlocks: blocks,
        existingRows: keyboardRows,
        nextBlock: block,
        candidateRows: episodeRows.slice(rowIndex)
      });

      if (rowsToAdd === 0 && blocks.length > 0) {
        flushMessage();
        continue;
      }

      const safeRowsToAdd = rowsToAdd === 0 ? 1 : rowsToAdd;
      blocks.push(block);
      keyboardRows.push(...episodeRows.slice(rowIndex, rowIndex + safeRowsToAdd));
      rowIndex += safeRowsToAdd;

      if (rowIndex < episodeRows.length) {
        flushMessage();
      }
    }
  }

  flushMessage();

  return messages;
}

function formatMovieResult(result: Extract<PublicSearchResult, { type: 'movie' }>, handles: PublicBotHandles) {
  return {
    text: [
      'Movie',
      formatTitle(result.title, result.year),
      '',
      'Providers:',
      '',
      formatHandles(handles)
    ].join('\n'),
    replyMarkup: toReplyMarkup(chunkButtons(providerButtons(result.providers), MOVIE_PROVIDER_BUTTONS_PER_ROW))
  };
}

function formatTvResult(result: Extract<PublicSearchResult, { type: 'tv' }>, handles: PublicBotHandles) {
  return {
    text: [
      'TV Show',
      formatTitle(result.title, result.year),
      '',
      'Choose a season:',
      '',
      formatHandles(handles)
    ].join('\n'),
    replyMarkup: toReplyMarkup(
      chunkButtons(
        result.seasons.map((season) => ({
          text: `Season ${season.seasonNumber}`,
          callback_data: encodeSeasonCallback(season.id)
        })),
        TV_SEASON_BUTTONS_PER_ROW
      )
    )
  };
}

function formatTitle(title: string, year?: number) {
  return typeof year === 'number' ? `${title} (${year})` : title;
}

function formatHandles(handles: PublicBotHandles) {
  return [`Channel: ${handles.channelHandle}`, `Group: ${handles.groupHandle}`].join('\n');
}

function providerButtons(providers: PublicProvider[], labelPrefix = '') {
  return providers.map((provider) => ({
    text: `${labelPrefix}${provider.providerName} ${provider.quality}`.trim(),
    url: provider.url
  }));
}

function chunkButtons<TButton extends InlineKeyboardButton>(buttons: TButton[], size: number): TButton[][] {
  const rows: TButton[][] = [];

  for (let index = 0; index < buttons.length; index += size) {
    rows.push(buttons.slice(index, index + size));
  }

  return rows;
}

function toReplyMarkup(rows: InlineKeyboardButton[][]): InlineKeyboardMarkup | undefined {
  const inlineKeyboard = rows.filter((row) => row.length > 0);
  return inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined;
}

function exceedsMessageLimits(text: string, keyboardRows: InlineKeyboardButton[][]) {
  return (
    text.length > MAX_FORMATTED_MESSAGE_LENGTH ||
    keyboardRows.length > MAX_INLINE_KEYBOARD_ROWS ||
    countKeyboardButtons(keyboardRows) > MAX_INLINE_KEYBOARD_BUTTONS
  );
}

function countKeyboardButtons(rows: InlineKeyboardButton[][]) {
  return rows.reduce((total, row) => total + row.length, 0);
}

function countFittingRows({
  header,
  footer,
  existingBlocks,
  existingRows,
  nextBlock,
  candidateRows
}: {
  header: string;
  footer: string;
  existingBlocks: string[];
  existingRows: InlineKeyboardButton[][];
  nextBlock: string;
  candidateRows: InlineKeyboardButton[][];
}) {
  let fittingRows = 0;

  for (let index = 0; index < candidateRows.length; index += 1) {
    const rows = [...existingRows, ...candidateRows.slice(0, index + 1)];
    const text = composeSeasonDetailsText(header, [...existingBlocks, nextBlock], footer);

    if (exceedsMessageLimits(text, rows)) {
      break;
    }

    fittingRows = index + 1;
  }

  return fittingRows;
}

function composeSeasonDetailsText(header: string, episodeBlocks: string[], footer: string) {
  const parts = [header];

  if (episodeBlocks.length > 0) {
    parts.push(episodeBlocks.join('\n\n'));
  }

  parts.push(footer);
  return parts.join('\n\n');
}
