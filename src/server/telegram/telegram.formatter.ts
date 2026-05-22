const TELEGRAM_PHOTO_CAPTION_LIMIT = 1024;

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
  description?: string;
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
  description?: string;
  episodes?: TelegramSeasonEpisodeInput[];
};

export function formatMovieCaption(input: TelegramMovieCaptionInput): string {
  return fitCaption({
    heading: formatTitle(input.title, input.year),
    meta: formatMeta(input.rating, input.quality),
    description: input.description,
    trailing: formatMovieLinks(input.links ?? [])
  });
}

export function formatSeasonCaption(input: TelegramSeasonCaptionInput): string {
  return fitCaption({
    heading: `${formatTitle(input.title, input.year)} - Season ${input.seasonNumber}`,
    meta: formatMeta(input.rating, input.quality),
    description: input.description,
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
    meta.push(`Rating: ${normalizedRating}`);
  }

  if (normalizedQuality) {
    meta.push(`Quality: ${normalizedQuality}`);
  }

  return meta;
}

function formatMovieLinks(links: TelegramLinkInput[]): CaptionBlock[] {
  const linkLines = links.map(formatLink).filter((line) => line.length > 0);

  return linkLines.length > 0 ? [['Links:', linkLines[0]], ...linkLines.slice(1).map((line) => [line])] : [];
}

function formatEpisodes(episodes: TelegramSeasonEpisodeInput[]): CaptionBlock[] {
  let hasEpisodesHeading = false;

  return episodes.flatMap((episode) => {
    const linkLines = (episode.links ?? []).map(formatLink).filter((line) => line.length > 0);

    if (linkLines.length === 0) {
      return [];
    }

    const title = normalizeValue(episode.title);
    const episodeHeading = title
      ? `Episode ${episode.episodeNumber} - ${title}`
      : `Episode ${episode.episodeNumber}`;
    const heading = hasEpisodesHeading ? [episodeHeading] : ['Episodes:', episodeHeading];
    hasEpisodesHeading = true;

    return [[...heading, ...linkLines]];
  });
}

function formatLink(link: TelegramLinkInput): string {
  const providerName = link.providerName.trim();
  const url = link.url.trim();

  if (!providerName || !url) {
    return '';
  }

  const details = [link.quality, link.status].map(normalizeValue).filter(Boolean);
  const suffix = details.length > 0 ? ` [${details.join(', ')}]` : '';

  return `${providerName}${suffix}: ${url}`;
}

function fitCaption(input: {
  heading: string;
  meta: string[];
  description?: string;
  trailing: CaptionBlock[];
}): string {
  const description = normalizeValue(input.description);
  const fullCaption = composeCaption(input.heading, input.meta, description, input.trailing);

  if (fullCaption.length <= TELEGRAM_PHOTO_CAPTION_LIMIT) {
    return fullCaption;
  }

  const requiredCaption = composeCaption(input.heading, input.meta, undefined, input.trailing);

  if (requiredCaption.length > TELEGRAM_PHOTO_CAPTION_LIMIT) {
    return composeRequiredWithinLimit(input.heading, input.meta, input.trailing);
  }

  if (!description) {
    return requiredCaption;
  }

  let low = 0;
  let high = description.length;
  let best = '';

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const trimmedDescription = trimDescription(description, middle);
    const candidate = composeCaption(input.heading, input.meta, trimmedDescription, input.trailing);

    if (candidate.length <= TELEGRAM_PHOTO_CAPTION_LIMIT) {
      best = trimmedDescription;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best ? composeCaption(input.heading, input.meta, best, input.trailing) : requiredCaption;
}

function composeCaption(
  heading: string,
  meta: string[],
  description: string | undefined,
  trailing: CaptionBlock[]
): string {
  const trailingLines = trailing.flat();
  const sections = [[heading, ...meta], description ? [description] : [], trailingLines]
    .filter((section) => section.length > 0)
    .map((section) => section.join('\n'));

  return sections.join('\n\n');
}

function composeRequiredWithinLimit(heading: string, meta: string[], trailing: CaptionBlock[]): string {
  const headingLines = fitCompleteLines([heading, ...meta], TELEGRAM_PHOTO_CAPTION_LIMIT);
  let includedTrailing: CaptionBlock[] = [];
  let caption = composeCaptionFromSections(headingLines, includedTrailing);

  for (const block of trailing) {
    const candidateBlocks = [...includedTrailing, block];
    const candidate = composeCaptionFromSections(headingLines, candidateBlocks);

    if (candidate.length <= TELEGRAM_PHOTO_CAPTION_LIMIT) {
      includedTrailing = candidateBlocks;
      caption = candidate;
    }
  }

  return caption;
}

function composeCaptionFromSections(headingLines: string[], trailing: CaptionBlock[]): string {
  const trailingLines = trailing.flat();
  const sections = [headingLines, trailingLines]
    .filter((section) => section.length > 0)
    .map((section) => section.join('\n'));

  return sections.join('\n\n');
}

function fitCompleteLines(lines: string[], maxLength: number): string[] {
  const included: string[] = [];

  for (const line of lines) {
    const candidate = [...included, line].join('\n');

    if (candidate.length <= maxLength) {
      included.push(line);
    }
  }

  if (included.length > 0) {
    return included;
  }

  return lines.length > 0 ? [lines[0].slice(0, maxLength)] : [];
}

function trimDescription(description: string, maxLength: number): string {
  if (maxLength <= 0) {
    return '';
  }

  if (description.length <= maxLength) {
    return description;
  }

  if (maxLength <= 3) {
    return '.'.repeat(maxLength);
  }

  return `${description.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeValue(value: NullableValue): string {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}
