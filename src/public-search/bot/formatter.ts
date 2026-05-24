import type { PublicProvider, PublicSearchResult, PublicSeasonDetails } from '../search.repository.js';
import type { InlineKeyboardButton, InlineKeyboardMarkup } from '../telegram.client.js';
import { encodeSeasonCallback } from './callback-data.js';

export const MAX_FORMATTED_MESSAGE_LENGTH = 3500;

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

  for (const episode of details.episodes) {
    const block = [`Episode ${episode.episodeNumber}`, 'Providers:'].join('\n');
    const candidateBlocks = [...blocks, block];
    const candidateText = composeSeasonDetailsText(header, candidateBlocks, footer);

    if (blocks.length > 0 && candidateText.length > MAX_FORMATTED_MESSAGE_LENGTH) {
      messages.push({
        text: composeSeasonDetailsText(header, blocks, footer),
        replyMarkup: toReplyMarkup(keyboardRows)
      });
      blocks = [];
      keyboardRows = [];
    }

    blocks.push(block);
    keyboardRows.push(providerButtons(episode.providers));
  }

  messages.push({
    text: composeSeasonDetailsText(header, blocks, footer),
    replyMarkup: toReplyMarkup(keyboardRows)
  });

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
    replyMarkup: toReplyMarkup([providerButtons(result.providers)])
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
    replyMarkup: toReplyMarkup([result.seasons.map((season) => ({
      text: `Season ${season.seasonNumber}`,
      callback_data: encodeSeasonCallback(season.id)
    }))])
  };
}

function formatTitle(title: string, year?: number) {
  return typeof year === 'number' ? `${title} (${year})` : title;
}

function formatHandles(handles: PublicBotHandles) {
  return [`Channel: ${handles.channelHandle}`, `Group: ${handles.groupHandle}`].join('\n');
}

function providerButtons(providers: PublicProvider[]) {
  return providers.map((provider) => ({
    text: `${provider.providerName} ${provider.quality}`.trim(),
    url: provider.url
  }));
}

function toReplyMarkup(rows: InlineKeyboardButton[][]): InlineKeyboardMarkup | undefined {
  const inlineKeyboard = rows.filter((row) => row.length > 0);
  return inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined;
}

function composeSeasonDetailsText(header: string, episodeBlocks: string[], footer: string) {
  const parts = [header];

  if (episodeBlocks.length > 0) {
    parts.push(episodeBlocks.join('\n\n'));
  }

  parts.push(footer);
  return parts.join('\n\n');
}
