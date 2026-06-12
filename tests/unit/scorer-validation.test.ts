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

  it('allows anything while EITHER side is null (TBD — the server checks the all-squads union)', () => {
    expect(scorerOnSquads('Anyone At All', null, null)).toBe(true);
    // Exactly one side known: the client cannot replicate the server's union
    // rule cheaply, so it never blocks — the server stays authoritative.
    expect(scorerOnSquads('Anyone At All', MEX, null)).toBe(true);
    expect(scorerOnSquads('Anyone At All', null, RSA)).toBe(true);
  });

  it('allows free text when both squads are known but EMPTY (no squad data — fail open)', () => {
    expect(scorerOnSquads('Anyone At All', [], [])).toBe(true);
  });

  it('still validates when one known squad is empty and the other has names', () => {
    expect(scorerOnSquads('Percy Tau', [], RSA)).toBe(true);
    expect(scorerOnSquads('Raúl Jiménez', [], RSA)).toBe(false);
  });
});
