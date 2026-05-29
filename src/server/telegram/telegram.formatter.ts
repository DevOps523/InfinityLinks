const TELEGRAM_PHOTO_CAPTION_LIMIT = 1024;
const SEARCH_BOT_HANDLE = '@dlhubcatalog_bot';

type NullableValue = number | string | null | undefined;
type CaptionBlock = string[];

export type TelegramLinkInput = {
  providerName: string;
  quality?: string;
  status?: string;
  url: string;
};

export type TelegramMovieCaptionInput = {
  title: string;
  year?: NullableValue;
  rating?: NullableValue;
  quality?: string;
  links?: TelegramLinkInput[];
};

export type TelegramSeasonEpisodeInput = {
  episodeNumber: number | string;
  title?: string;
  links?: TelegramLinkInput[];
};

export type TelegramSeasonCaptionInput = {
  title: string;
  seasonNumber: number | string;
  year?: NullableValue;
  rating?: NullableValue;
  quality?: string;
  episodes?: TelegramSeasonEpisodeInput[];
};

export function formatMovieCaption(input: TelegramMovieCaptionInput): string {
  return fitCaption({
    heading: `🎬 ${formatTitle(input.title, input.year)}`,
    meta: formatMeta(input.rating, input.quality),
    trailing: formatMovieLinks(input.links ?? [])
  });
}

export function formatSeasonCaption(input: TelegramSeasonCaptionInput): string {
  return fitCaption({
    heading: `📺 ${formatTitle(input.title, input.year)} - Season ${input.seasonNumber}`,
    meta: formatMeta(input.rating, input.quality),
    trailing: formatEpisodes(input.episodes ?? [])
  });
}

function formatTitle(title: string, year?: NullableValue): string {
  const trimmedTitle = title.trim();
  const normalizedYear = normalizeValue(year);

  return normalizedYear ? `${trimmedTitle} (${normalizedYear})` : trimmedTitle;
}

function formatMeta(rating?: NullableValue, quality?: string): string[] {
  const meta: string[] = [];
  const normalizedRating = normalizeValue(rating);
  const normalizedQuality = normalizeValue(quality);

  if (normalizedRating) {
    meta.push(`⭐ Rating: ${normalizedRating}`);
  }

  if (normalizedQuality) {
    meta.push(`🎥 Quality: ${normalizedQuality}`);
  }

  return meta;
}

function formatMovieLinks(links: TelegramLinkInput[]): CaptionBlock[] {
  const linkLines = links.map(formatLink).filter((line) => line.length > 0);

  if (linkLines.length === 0) {
    return [formatFooter()];
  }

  return [['📥 Download Links:', linkLines[0]], ...linkLines.slice(1).map((line) => [line]), ['', ...formatFooter()]];
}

function formatEpisodes(episodes: TelegramSeasonEpisodeInput[]): CaptionBlock[] {
  let hasLinkedEpisode = false;
  const episodeBlocks = episodes.flatMap((episode) => {
    const linkLines = (episode.links ?? []).map(formatLink).filter((line) => line.length > 0);

    if (linkLines.length === 0) {
      return [];
    }

    const headingPrefix = hasLinkedEpisode ? [''] : [];
    hasLinkedEpisode = true;

    return [
      [...headingPrefix, `🎞️ Episode ${episode.episodeNumber}`, '📥 Download Links:', linkLines[0]],
      ...linkLines.slice(1).map((line) => [line])
    ];
  });

  return episodeBlocks.length > 0 ? [...episodeBlocks, ['', ...formatFooter()]] : [formatFooter()];
}

function formatLink(link: TelegramLinkInput): string {
  const providerName = link.providerName.trim();
  const url = link.url.trim();

  if (!providerName || !url) {
    return '';
  }

  return `🔗 ${providerName} - ${url}`;
}

function formatFooter(): CaptionBlock {
  return [`🔎 Search Movies and Series: ${SEARCH_BOT_HANDLE}`];
}

function fitCaption(input: {
  heading: string;
  meta: string[];
  trailing: CaptionBlock[];
}): string {
  const fullCaption = composeCaption(input.heading, input.meta, input.trailing);

  if (fullCaption.length <= TELEGRAM_PHOTO_CAPTION_LIMIT) {
    return fullCaption;
  }

  return composeRequiredWithinLimit(input.heading, input.meta, input.trailing);
}

function composeCaption(
  heading: string,
  meta: string[],
  trailing: CaptionBlock[]
): string {
  const trailingLines = trailing.flat();
  const sections = [[heading, ...meta], trailingLines]
    .filter((section) => section.length > 0)
    .map((section) => section.join('\n'));

  return sections.join('\n\n');
}

function composeRequiredWithinLimit(heading: string, meta: string[], trailing: CaptionBlock[]): string {
  const requiredTrailing = splitRequiredTrailing(trailing);
  const headingLimit = getHeadingLimitForRequiredTrailing(requiredTrailing.required);
  const headingLines = fitCompleteLines([heading, ...meta], headingLimit);
  let includedOptional: CaptionBlock[] = [];
  let includedTrailing: CaptionBlock[] = [...includedOptional, ...requiredTrailing.required];
  let caption = composeCaptionFromSections(headingLines, includedTrailing);

  for (const block of requiredTrailing.optional) {
    const candidateOptional = [...includedOptional, block];
    const candidateBlocks = [...candidateOptional, ...requiredTrailing.required];
    const candidate = composeCaptionFromSections(headingLines, candidateBlocks);

    if (candidate.length <= TELEGRAM_PHOTO_CAPTION_LIMIT) {
      includedOptional = candidateOptional;
      includedTrailing = candidateBlocks;
      caption = candidate;
    }
  }

  return caption;
}

function getHeadingLimitForRequiredTrailing(requiredTrailing: CaptionBlock[]): number {
  const requiredLines = requiredTrailing.flat();

  if (requiredLines.length === 0) {
    return TELEGRAM_PHOTO_CAPTION_LIMIT;
  }

  const requiredSectionLength = requiredLines.join('\n').length;

  return Math.max(0, TELEGRAM_PHOTO_CAPTION_LIMIT - requiredSectionLength - '\n\n'.length);
}

function splitRequiredTrailing(trailing: CaptionBlock[]): {
  optional: CaptionBlock[];
  required: CaptionBlock[];
} {
  let footerIndex = -1;

  for (let index = trailing.length - 1; index >= 0; index -= 1) {
    if (trailing[index].some((line) => line.includes(SEARCH_BOT_HANDLE))) {
      footerIndex = index;
      break;
    }
  }

  if (footerIndex === -1) {
    return { optional: trailing, required: [] };
  }

  return {
    optional: trailing.slice(0, footerIndex),
    required: trailing.slice(footerIndex)
  };
}

function composeCaptionFromSections(headingLines: string[], trailing: CaptionBlock[]): string {
  const trailingLines = trailing.flat();
  const sections = [headingLines, trailingLines]
    .filter((section) => section.length > 0)
    .map((section) => section.join('\n'));

  return sections.join('\n\n');
}

function fitCompleteLines(lines: string[], maxLength: number): string[] {
  if (maxLength <= 0) {
    return [];
  }

  const included: string[] = [];

  for (const line of lines) {
    const candidate = [...included, line].join('\n');

    if (candidate.length <= maxLength) {
      included.push(line);
    } else if (included.length === 0) {
      return [line.slice(0, maxLength)];
    }
  }

  if (included.length > 0) {
    return included;
  }

  return lines.length > 0 ? [lines[0].slice(0, maxLength)] : [];
}

function normalizeValue(value: NullableValue): string {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}
