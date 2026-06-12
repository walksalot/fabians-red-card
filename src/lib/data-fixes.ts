/**
 * One-shot, idempotent data repairs, run at server boot (instrumentation.ts).
 *
 * "<Name> null": ESPN's roster API returns fullName "Casemiro null" for
 * mononym players (their lastName is the literal string "null"). Those names
 * leaked into the players table and into saved picks via the dropdown — and a
 * pick "Casemiro null" scores ZERO against the result string "Casemiro"
 * (scorerMatches treats the extra token as a mismatch). Strip the artifact
 * everywhere so honest picks of these players count again.
 */
import { eq, like } from 'drizzle-orm';
import { schema, type Db } from '@/db';

const NULL_SUFFIX = /\s+null$/i;

export interface NullSurnameFixResult {
  playersFixed: number;
  picksFixed: number;
}

export function fixNullSurnameArtifacts(db: Db): NullSurnameFixResult {
  let playersFixed = 0;
  let picksFixed = 0;

  db.transaction(() => {
    const players = db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)
      .where(like(schema.players.name, '% null'))
      .all();
    for (const p of players) {
      const fixed = p.name.replace(NULL_SUFFIX, '').trim();
      if (fixed !== p.name && fixed.length > 0) {
        db.update(schema.players)
          .set({ name: fixed })
          .where(eq(schema.players.id, p.id))
          .run();
        playersFixed += 1;
      }
    }

    const picks = db
      .select({ id: schema.picks.id, predScorer: schema.picks.predScorer })
      .from(schema.picks)
      .where(like(schema.picks.predScorer, '% null'))
      .all();
    for (const pk of picks) {
      const fixed = pk.predScorer!.replace(NULL_SUFFIX, '').trim();
      if (fixed !== pk.predScorer && fixed.length > 0) {
        // deliberately does NOT touch updatedAt: this is a repair, not an edit
        db.update(schema.picks)
          .set({ predScorer: fixed })
          .where(eq(schema.picks.id, pk.id))
          .run();
        picksFixed += 1;
      }
    }
  });

  return { playersFixed, picksFixed };
}
