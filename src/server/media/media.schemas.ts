import { z } from 'zod';

export const QualitySchema = z.enum(['SD', 'HD', 'Full HD', '2K', '4K']);
export const LinkStatusSchema = z.enum(['active', 'inactive']);

export const LinkInputSchema = z.object({
  providerName: z.string().trim().min(1),
  quality: QualitySchema,
  status: LinkStatusSchema,
  url: z.string().url()
});

const MediaInputBaseSchema = z.object({
  tmdbId: z.number().int().positive().optional(),
  title: z.string().trim().min(1),
  year: z.number().int().positive().optional(),
  posterUrl: z.union([z.string().url(), z.literal('')]).optional(),
  rating: z.number().optional(),
  quality: QualitySchema,
  description: z.string().default('')
});

export const MovieInputSchema = MediaInputBaseSchema.extend({
  links: z.array(LinkInputSchema).default([])
});

export const TvShowInputSchema = MediaInputBaseSchema;

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
