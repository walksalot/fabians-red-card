import { describe, expect, it } from 'vitest';
import { scorerOnSquads } from '@/app/league/[slug]/_components/scorer-validation';

const MEX = ['Raúl Jiménez', 'Guillermo Ochoa', 'Edson Álvarez'];
const RSA = ['Ronwen Williams', 'Percy Tau'];

describe('scorerOnSquads (client mirror of the server squad rule)', () => {
  it('accepts a full name from the home squad', () => {
    expect(scorerOnSquads('Raúl Jiménez', MEX, RSA)).toBe(true);
  });

  it('accepts a full name from the away squad', () => {
    expect(scorerOnSquads('Percy Tau', MEX, RSA)).toBe(true);
  });

  it('forgives accents, case, periods and extra whitespace', () => {
    expect(scorerOnSquads('raul jimenez', MEX, RSA)).toBe(true);
    expect(scorerOnSquads('  GUILLERMO   OCHOA  ', MEX, RSA)).toBe(true);
    expect(scorerOnSquads('Edson. Alvarez', MEX, RSA)).toBe(true);
  });

  it('rejects a bare last name (the closed loophole)', () => {
    expect(scorerOnSquads('Jimenez', MEX, RSA)).toBe(false);
  });

  it('rejects a name from neither squad', () => {
    expect(scorerOnSquads('Test Scorer', MEX, RSA)).toBe(false);
  });

  it('passes an empty/whitespace pick (scorer is optional)', () => {
    expect(scorerOnSquads('', MEX, RSA)).toBe(true);
    expect(scorerOnSquads('   ', MEX, RSA)).toBe(true);
  });

  it('allows free text while both squads are unknown (knockout TBD)', () => {
    expect(scorerOnSquads('Anyone At All', [], [])).toBe(true);
  });

  it('validates when only one squad list is known', () => {
    expect(scorerOnSquads('Percy Tau', [], RSA)).toBe(true);
    expect(scorerOnSquads('Raúl Jiménez', [], RSA)).toBe(false);
  });
});
