import { z } from 'zod';

const PositiveIntegerSchema = z.number().int().positive();

const OptionalPositiveIntegerSchema = PositiveIntegerSchema.optional();

export const PublicSearchProviderSchema = z
  .object({
    providerName: z.string().trim().min(1),
    quality: z.string().trim().min(1),
    url: z.string().url(),
    sortOrder: PositiveIntegerSchema
  })
  .strict();

export const PublicSearchMovieSchema = z
  .object({
    id: PositiveIntegerSchema,
    title: z.string().trim().min(1),
    year: OptionalPositiveIntegerSchema,
    telegramMessageId: OptionalPositiveIntegerSchema,
    channelPostUrl: z.string().url().optional(),
    providers: PublicSearchProviderSchema.array()
  })
  .strict();

export const PublicSearchEpisodeSchema = z
  .object({
    episodeNumber: PositiveIntegerSchema,
    providers: PublicSearchProviderSchema.array()
  })
  .strict();

export const PublicSearchSeasonSchema = z
  .object({
    id: PositiveIntegerSchema,
    seasonNumber: PositiveIntegerSchema,
    telegramMessageId: OptionalPositiveIntegerSchema,
    channelPostUrl: z.string().url().optional(),
    episodes: PublicSearchEpisodeSchema.array()
  })
  .strict();

export const PublicSearchTvShowSchema = z
  .object({
    id: PositiveIntegerSchema,
    title: z.string().trim().min(1),
    year: OptionalPositiveIntegerSchema,
    seasons: PublicSearchSeasonSchema.array()
  })
  .strict();

export const PublicSearchCatalogSchema = z
  .object({
    generatedAt: z.string().datetime(),
    channelHandle: z.string().trim().min(1),
    groupHandle: z.string().trim().min(1),
    movies: PublicSearchMovieSchema.array(),
    tvShows: PublicSearchTvShowSchema.array()
  })
  .strict();

export type PublicSearchCatalog = z.infer<typeof PublicSearchCatalogSchema>;
