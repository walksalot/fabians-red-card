import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { fixNullSurnameArtifacts } from '@/lib/data-fixes';
import { freshDb } from '../helpers/db';

function seedWorld() {
  const db = freshDb();
  db.insert(schema.teams)
    .values([{ id: 30, code: 'BRA', name: 'Brazil', groupLetter: 'C' }])
    .run();
  db.insert(schema.players)
    .values([
      { teamId: 30, name: 'Casemiro null', position: 'M' },
      { teamId: 30, name: 'Endrick null', position: 'F' },
      { teamId: 30, name: 'Vinicius Junior', position: 'F' }, // untouched
    ])
    .run();
  const user = db
    .insert(schema.users)
    .values({ username: 'u1', displayName: 'U1', passwordHash: 'x', createdAt: 0 })
    .returning()
    .get();
  const league = db
    .insert(schema.leagues)
    .values({ name: 'L', slug: 'l', inviteToken: 't', adminUserId: user.id, createdAt: 0 })
    .returning()
    .get();
  const entry = db
    .insert(schema.entries)
    .values({ leagueId: league.id, userId: user.id, label: 'E', createdAt: 0 })
    .returning()
    .get();
  db.insert(schema.matches)
    .values({
      id: 1,
      stage: 'group',
      kickoffUtc: '2026-06-15T16:00:00Z',
      matchday: '2026-06-15',
      venue: 'V',
      city: 'C',
    })
    .run();
  return { db, entry };
}

describe('fixNullSurnameArtifacts', () => {
  it('strips the " null" scrape artifact from players and saved picks, once', () => {
    const { db, entry } = seedWorld();
    db.insert(schema.picks)
      .values([
        {
          entryId: entry.id,
          matchId: 1,
          predHome: 1,
          predAway: 0,
          predScorer: 'Casemiro null', // dead pick: would never match "Casemiro"
          createdAt: 5,
          updatedAt: 7,
        },
      ])
      .run();

    const first = fixNullSurnameArtifacts(db);
    expect(first).toEqual({ playersFixed: 2, picksFixed: 1 });

    const names = db
      .select({ name: schema.players.name })
      .from(schema.players)
      .all()
      .map((r) => r.name)
      .sort();
    expect(names).toEqual(['Casemiro', 'Endrick', 'Vinicius Junior']);

    const pick = db.select().from(schema.picks).where(eq(schema.picks.entryId, entry.id)).get()!;
    expect(pick.predScorer).toBe('Casemiro');
    // A repair is not an edit: timestamps untouched.
    expect(pick.updatedAt).toBe(7);
    expect(pick.createdAt).toBe(5);

    // Idempotent: a second boot fixes nothing more.
    expect(fixNullSurnameArtifacts(db)).toEqual({ playersFixed: 0, picksFixed: 0 });
  });

  it('is a no-op on clean data', () => {
    const { db } = seedWorld();
    db.update(schema.players).set({ name: 'Casemiro' }).where(eq(schema.players.name, 'Casemiro null')).run();
    db.update(schema.players).set({ name: 'Endrick' }).where(eq(schema.players.name, 'Endrick null')).run();
    expect(fixNullSurnameArtifacts(db)).toEqual({ playersFixed: 0, picksFixed: 0 });
  });
});
