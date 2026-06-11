/**
 * Builds an iCalendar (.ics) feed of the whole tournament. Friends subscribe to
 * the URL once and their own phone/calendar app reminds them before each match —
 * no push-notification service, no server-side reminders to maintain.
 */
import type { Db } from '@/db';
import { schema } from '@/db';
import { asc } from 'drizzle-orm';

const STAGE_LABEL: Record<string, string> = {
  group: 'Group Stage',
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarter-final',
  sf: 'Semi-final',
  third: 'Third-place play-off',
  final: 'Final',
};

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** ISO instant → iCal UTC stamp (YYYYMMDDTHHMMSSZ). */
function icsStamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z?$/, 'Z');
}

/** Fold lines to 75 octets per RFC 5545 (calendar apps are strict about this). */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(' ' + rest);
  return parts.join('\r\n');
}

export function buildCalendar(db: Db, leagueName: string): string {
  const rows = db
    .select({
      id: schema.matches.id,
      stage: schema.matches.stage,
      groupLetter: schema.matches.groupLetter,
      kickoffUtc: schema.matches.kickoffUtc,
      venue: schema.matches.venue,
      city: schema.matches.city,
      homePlaceholder: schema.matches.homePlaceholder,
      awayPlaceholder: schema.matches.awayPlaceholder,
    })
    .from(schema.matches)
    .orderBy(asc(schema.matches.id))
    .all();

  // resolve team names (two left joins are awkward in drizzle's query builder
  // here, so map ids → names once)
  const teams = new Map(
    db.select({ id: schema.teams.id, name: schema.teams.name }).from(schema.teams).all().map((t) => [t.id, t.name]),
  );
  const full = db
    .select({
      id: schema.matches.id,
      homeTeamId: schema.matches.homeTeamId,
      awayTeamId: schema.matches.awayTeamId,
    })
    .from(schema.matches)
    .all();
  const sides = new Map(full.map((m) => [m.id, m]));

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fabians Red Card//World Cup 2026 Pool//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(leagueName)} — World Cup 2026`,
    'X-WR-TIMEZONE:UTC',
  ];

  for (const m of rows) {
    const s = sides.get(m.id);
    const home = (s?.homeTeamId != null ? teams.get(s.homeTeamId) : null) ?? m.homePlaceholder ?? 'TBD';
    const away = (s?.awayTeamId != null ? teams.get(s.awayTeamId) : null) ?? m.awayPlaceholder ?? 'TBD';
    const start = new Date(m.kickoffUtc);
    const end = new Date(start.getTime() + 2 * 3600_000); // ~2h block
    const stageLabel = m.stage === 'group' ? `Group ${m.groupLetter}` : STAGE_LABEL[m.stage] ?? m.stage;
    const summary = `${home} vs ${away} (${stageLabel})`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:wc2026-match-${m.id}@fabians-red-card`,
      `DTSTAMP:${icsStamp(start.toISOString())}`,
      `DTSTART:${icsStamp(start.toISOString())}`,
      `DTEND:${icsStamp(end.toISOString())}`,
      fold(`SUMMARY:${icsEscape(summary)}`),
      fold(`LOCATION:${icsEscape(`${m.venue}, ${m.city}`)}`),
      fold(`DESCRIPTION:${icsEscape(`Match ${m.id} · ${stageLabel}. Get your pick in before kickoff!`)}`),
      'BEGIN:VALARM',
      'TRIGGER:-PT60M',
      'ACTION:DISPLAY',
      fold(`DESCRIPTION:${icsEscape(`${summary} kicks off in 1 hour — lock your pick!`)}`),
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
