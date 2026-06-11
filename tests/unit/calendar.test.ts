import { describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { buildCalendar } from '@/lib/calendar';
import { freshDb } from '../helpers/db';

describe('buildCalendar', () => {
  it('emits one VEVENT per match, resolving teams and placeholders', () => {
    const db = freshDb();
    db.insert(schema.teams).values([
      { id: 1, code: 'MEX', name: 'Mexico', groupLetter: 'A' },
      { id: 2, code: 'RSA', name: 'South Africa', groupLetter: 'A' },
    ]).run();
    db.insert(schema.matches).values([
      {
        id: 1, stage: 'group', groupLetter: 'A', homeTeamId: 1, awayTeamId: 2,
        kickoffUtc: '2026-06-11T19:00:00Z', matchday: '2026-06-11',
        venue: 'Estadio Azteca', city: 'Mexico City', status: 'scheduled',
      },
      {
        id: 73, stage: 'r32', homeTeamId: null, awayTeamId: null,
        homePlaceholder: 'Group A winners', awayPlaceholder: '3rd C/D/F',
        kickoffUtc: '2026-06-28T19:00:00Z', matchday: '2026-06-28',
        venue: 'BMO Field', city: 'Toronto', status: 'scheduled',
      },
    ]).run();

    const ics = buildCalendar(db, "Fabian's Red Card");
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('Mexico vs South Africa');
    expect(ics).toContain('Group A winners vs 3rd C/D/F');
    expect(ics).toContain('DTSTART:20260611T190000Z');
    expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true);
  });
});
