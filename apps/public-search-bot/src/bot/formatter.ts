import type { PublicProvider, PublicSearchResult, PublicSeasonDetails } from '../search.repository.js';
import type { InlineKeyboardButton, InlineKeyboardMarkup } from '../telegram.client.js';
import { encodeSeasonCallback } from './callback-data.js';

export const MAX_FORMATTED_MESSAGE_LENGTH = 3500;
export const MAX_INLINE_KEYBOARD_ROWS = 20;
export const MAX_INLINE_KEYBOARD_BUTTONS = 40;

const TV_SEASON_BUTTONS_PER_ROW = 3;

export type PublicBotHandles = {
  channelHandle: string;
  groupHandle: string;
};

export type PublicBotMessage = {
  text: string;
  replyMarkup?: InlineKeyboardMarkup | undefined;
};

export function formatStartMessage(handles: PublicBotHandles): PublicBotMessage {
  return {
    text: [
      '🎬 Welcome to InfinityLinks Search.',
      '',
      '🔎 Use:',
      '/search movie or tv show name',
      '',
      '✨ Examples:',
      '/search inception',
      '/search breaking bad',
      '',
      formatHandles(handles)
    ].join('\n')
  };
}

export function formatSearchValidationMessage(): PublicBotMessage {
  return {
    text: ['⚠️ Please provide a movie or TV show title.', '', 'Example: /search inception'].join('\n')
  };
}

export function formatClearMessage(): PublicBotMessage {
  return {
    text: '🧹 Cleared. Search anytime with /search movie or tv show name.'
  };
}

export function formatJoinRequiredMessage(handles: PublicBotHandles): PublicBotMessage {
  return {
    text: [
      'We could not verify your channel membership right now. Please join the channel and try again.',
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
  return results.flatMap((result) => {
    if (result.type === 'movie') {
      return formatMovieResult(result, handles);
    }

    return formatTvResult(result, handles);
  });
}

export function formatSeasonDetails(details: PublicSeasonDetails, handles: PublicBotHandles): PublicBotMessage[] {
  const headerLines = [`📺 ${formatTitle(details.showTitle, details.showYear)}`, `📂 Season ${details.seasonNumber}`];
  const footerLines = [
    ...originalPostSection(details.channelPostUrl),
    ...(details.channelPostUrl ? [''] : []),
    ...formatHandleLines(handles)
  ];
  const episodeBlocks = details.episodes.map((episode) => ({
    headingLines: [`🎞 Episode ${episode.episodeNumber}`, '🔗 Download Links:'],
    providerLines: episode.providers.map(formatProviderLine)
  }));

  return splitSeasonDetailSections(headerLines, episodeBlocks, footerLines).map((text) => ({ text }));
}

function formatMovieResult(result: Extract<PublicSearchResult, { type: 'movie' }>, handles: PublicBotHandles) {
  const headerLines = ['🎬 Movie', formatTitle(result.title, result.year)];
  const bodyLines = ['🔗 Download Links:', ...result.providers.map(formatProviderLine)];
  const footerLines = [
    ...originalPostSection(result.channelPostUrl),
    ...(result.channelPostUrl ? [''] : []),
    ...formatHandleLines(handles)
  ];

  return splitTextSections(headerLines, bodyLines, footerLines).map((text) => ({ text }));
}

function formatTvResult(result: Extract<PublicSearchResult, { type: 'tv' }>, handles: PublicBotHandles) {
  const text = [
    '📺 TV Show',
    formatTitle(result.title, result.year),
    '',
    '📂 Choose a season:',
    '',
    formatHandles(handles)
  ].join('\n');
  const seasonRows = chunkButtons(
    result.seasons.map((season) => ({
      text: `Season ${season.seasonNumber}`,
      callback_data: encodeSeasonCallback(season.id)
    })),
    TV_SEASON_BUTTONS_PER_ROW
  );

  return splitKeyboardRows(seasonRows, [], []).map((keyboardRows) => ({
    text,
    replyMarkup: toReplyMarkup(keyboardRows)
  }));
}

function formatTitle(title: string, year?: number) {
  return typeof year === 'number' ? `${title} (${year})` : title;
}

function formatHandles(handles: PublicBotHandles) {
  return formatHandleLines(handles).join('\n');
}

function formatHandleLines(handles: PublicBotHandles) {
  return [`📢 Channel: ${handles.channelHandle}`, `👥 Group: ${handles.groupHandle}`];
}

function formatProviderLine(provider: PublicProvider) {
  return `📁 ${provider.providerName} ${provider.quality} - ${provider.url}`;
}

function originalPostSection(channelPostUrl?: string) {
  return channelPostUrl ? ['📌 Original Post:', channelPostUrl] : [];
}

function splitKeyboardRows(
  contentRows: InlineKeyboardButton[][],
  prefixRows: InlineKeyboardButton[][],
  suffixRows: InlineKeyboardButton[][]
): InlineKeyboardButton[][][] {
  const chunks: InlineKeyboardButton[][][] = [];
  let currentRows: InlineKeyboardButton[][] = [];

  for (const row of contentRows) {
    const candidateRows = [...currentRows, row];

    if (currentRows.length > 0 && exceedsMessageLimits('', [...prefixRows, ...candidateRows, ...suffixRows])) {
      chunks.push([...prefixRows, ...currentRows, ...suffixRows]);
      currentRows = [];
    }

    currentRows.push(row);
  }

  chunks.push([...prefixRows, ...currentRows, ...suffixRows]);
  return chunks;
}

function splitTextSections(headerLines: string[], bodyLines: string[], footerLines: string[]) {
  const [bodyHeading, ...splittableBodyLines] = bodyLines;
  const fixedBodyLines = typeof bodyHeading === 'string' ? [bodyHeading] : [];
  const chunks: string[] = [];
  let currentBodyLines: string[] = [];

  const compose = (lines: string[]) => composeTextSections(headerLines, [...fixedBodyLines, ...lines], footerLines);

  for (const line of splittableBodyLines) {
    const candidateBodyLines = [...currentBodyLines, line];
    const candidateText = compose(candidateBodyLines);

    if (currentBodyLines.length > 0 && candidateText.length > MAX_FORMATTED_MESSAGE_LENGTH) {
      chunks.push(compose(currentBodyLines));
      currentBodyLines = [];
    }

    currentBodyLines.push(line);
  }

  chunks.push(compose(currentBodyLines));
  return chunks;
}

function splitSeasonDetailSections(
  headerLines: string[],
  episodes: { headingLines: string[]; providerLines: string[] }[],
  footerLines: string[]
) {
  const chunks: string[] = [];
  let currentBlocks: string[][] = [];
  const compose = (blocks: string[][]) => composeTextSections(headerLines, ...blocks, footerLines);
  const pushCurrentBlocks = () => {
    if (currentBlocks.length === 0) {
      return;
    }

    chunks.push(compose(currentBlocks));
    currentBlocks = [];
  };

  for (const episode of episodes) {
    const headingLineCount = episode.headingLines.length;
    let currentEpisodeLines = [...episode.headingLines];

    for (const providerLine of episode.providerLines) {
      while (true) {
        const candidateEpisodeLines = [...currentEpisodeLines, providerLine];
        const candidateBlocks = [...currentBlocks, candidateEpisodeLines];
        const candidateText = compose(candidateBlocks);

        if (
          candidateText.length <= MAX_FORMATTED_MESSAGE_LENGTH ||
          (currentBlocks.length === 0 && currentEpisodeLines.length === headingLineCount)
        ) {
          currentEpisodeLines = candidateEpisodeLines;
          break;
        }

        if (currentEpisodeLines.length > headingLineCount) {
          currentBlocks.push(currentEpisodeLines);
          pushCurrentBlocks();
          currentEpisodeLines = [...episode.headingLines];
          continue;
        }

        pushCurrentBlocks();
      }
    }

    if (
      currentBlocks.length > 0 &&
      compose([...currentBlocks, currentEpisodeLines]).length > MAX_FORMATTED_MESSAGE_LENGTH
    ) {
      pushCurrentBlocks();
    }

    currentBlocks.push(currentEpisodeLines);
  }

  pushCurrentBlocks();

  if (chunks.length === 0) {
    chunks.push(compose([]));
  }

  return chunks;
}

function composeTextSections(...sections: string[][]) {
  return sections
    .filter((section) => section.length > 0)
    .map((section) => section.join('\n'))
    .join('\n\n');
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
