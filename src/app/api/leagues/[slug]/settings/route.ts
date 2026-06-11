import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { getLeagueBySlug, updateLeagueSettings } from '@/lib/services/leagues';
import {
  handle,
  jsonOk,
  readJson,
  requireLeagueAdmin,
  sanitizeLeague,
} from '@/lib/api-helpers';

const scoringRulesSchema = z.object({
  exact: z.number(),
  outcome: z.number(),
  scorer: z.number(),
  firstTeam: z.number(),
  underdog: z.number(),
});

const roundMultipliersSchema = z.object({
  group: z.number(),
  r32: z.number(),
  r16: z.number(),
  qf: z.number(),
  sf: z.number(),
  third: z.number(),
  final: z.number(),
});

const bodySchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  // JSON boundary takes a boolean; the service (and integer schema column) want 0 | 1.
  isPrivate: z
    .boolean()
    .transform((v): 0 | 1 => (v ? 1 : 0))
    .optional(),
  // string sets the join password, explicit null clears it
  joinPassword: z.string().min(1).max(200).nullable().optional(),
  entriesPerUser: z.number().int().min(1).max(10).optional(),
  buyInCents: z.number().int().min(0).max(10_000_000).optional(),
  payoutSplit: z
    .array(z.number().int().min(0))
    .min(1)
    .refine((split) => split.reduce((sum, n) => sum + n, 0) === 100, {
      message: 'payoutSplit must sum to 100',
    })
    .optional(),
  scoringRules: scoringRulesSchema.optional(),
  boosterMultiplier: z.number().positive().max(100).optional(),
  roundMultipliers: roundMultipliersSchema.optional(),
});

type RouteCtx = { params: Promise<{ slug: string }> };

export const PATCH = handle<RouteCtx>(async (req, { params }) => {
  const { slug } = await params;
  const db = getDb();
  const user = await requireUser(db);
  const league = await getLeagueBySlug(db, slug);
  if (!league) throw new AppError('League not found', 404);
  requireLeagueAdmin(db, league.id, user.id); // service enforces too
  const body = bodySchema.parse(await readJson(req));
  // Only forward keys the caller actually sent (null survives: it clears joinPassword).
  const partial = Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined),
  );
  const updated = await updateLeagueSettings(db, league.id, user.id, partial);
  return jsonOk({ league: sanitizeLeague(updated, true) });
});
