import { z } from 'zod';
import { DEFAULT_MOVIE_TOPIC_KEY, DEFAULT_TV_TOPIC_KEY, MOVIE_TOPIC_KEYS, TV_TOPIC_KEYS } from './topics.js';

export const QualitySchema = z.enum(['SD', 'HD', 'Full HD', '2K', '4K']);
export const LinkStatusSchema = z.enum(['active', 'inactive']);
export const MovieTopicKeySchema = z.enum(MOVIE_TOPIC_KEYS);
export const TvTopicKeySchema = z.enum(TV_TOPIC_KEYS);

const HTTP_URL_ERROR_MESSAGE = 'URL must use http or https';

function isHttpUrl(value: string) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const HttpUrlSchema = z.string().url().refine(isHttpUrl, {
  message: HTTP_URL_ERROR_MESSAGE
});

export const LinkInputSchema = z.object({
  providerName: z.string().trim().min(1),
  quality: QualitySchema,
  status: LinkStatusSchema,
  url: HttpUrlSchema
});

const MediaInputBaseSchema = z.object({
  tmdbId: z.number().int().positive().optional(),
  title: z.string().trim().min(1),
  year: z.number().int().positive().optional(),
  posterUrl: z.union([HttpUrlSchema, z.literal('')]).optional(),
  rating: z.number().optional(),
  quality: QualitySchema,
  description: z.string().default('')
});

export const MovieInputSchema = MediaInputBaseSchema.extend({
  topicKey: MovieTopicKeySchema.default(DEFAULT_MOVIE_TOPIC_KEY),
  links: z.array(LinkInputSchema).default([])
});

export const TvShowInputSchema = MediaInputBaseSchema.extend({
  topicKey: TvTopicKeySchema.default(DEFAULT_TV_TOPIC_KEY)
});

export const SeasonInputSchema = z.object({
  seasonNumber: z.number().int().positive()
});

export const BulkEpisodeInputSchema = z.object({
  startEpisode: z.number().int().positive(),
  count: z.number().int().positive().max(100)
});

export const EpisodeInputSchema = z.object({
  episodeNumber: z.number().int().positive()
});
