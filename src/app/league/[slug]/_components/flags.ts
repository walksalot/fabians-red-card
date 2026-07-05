/**
 * FIFA 3-letter team code → flag emoji. Pure presentational helper — flags
 * need no image assets, render crisply at text size, and degrade to nothing
 * (callers fall back to the code chip) for unknown/placeholder teams.
 */

/** FIFA codes whose flag is not derivable from an ISO 3166-1 alpha-2 pair. */
const SPECIAL: Record<string, string> = {
  ENG: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', // 🏴󠁧󠁢󠁥󠁮󠁧󠁿
  SCO: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', // 🏴󠁧󠁢󠁳󠁣󠁴󠁿
  WAL: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}', // 🏴󠁧󠁢󠁷󠁬󠁳󠁿
};

/** FIFA code → ISO 3166-1 alpha-2 (only where they differ or are ambiguous). */
const FIFA_TO_ISO2: Record<string, string> = {
  ALG: 'DZ',
  ANG: 'AO',
  ARG: 'AR',
  AUS: 'AU',
  AUT: 'AT',
  BEL: 'BE',
  BIH: 'BA',
  BOL: 'BO',
  BRA: 'BR',
  BUL: 'BG',
  CAN: 'CA',
  CHI: 'CL',
  CHN: 'CN',
  CIV: 'CI',
  CMR: 'CM',
  COD: 'CD',
  COL: 'CO',
  CPV: 'CV',
  CRC: 'CR',
  CRO: 'HR',
  CUB: 'CU',
  CUW: 'CW',
  CZE: 'CZ',
  DEN: 'DK',
  ECU: 'EC',
  EGY: 'EG',
  ESP: 'ES',
  FIN: 'FI',
  FRA: 'FR',
  GAB: 'GA',
  GAM: 'GM',
  GEO: 'GE',
  GER: 'DE',
  GHA: 'GH',
  GRE: 'GR',
  GUA: 'GT',
  HAI: 'HT',
  HON: 'HN',
  HUN: 'HU',
  IDN: 'ID',
  IND: 'IN',
  IRL: 'IE',
  IRN: 'IR',
  IRQ: 'IQ',
  ISL: 'IS',
  ISR: 'IL',
  ITA: 'IT',
  JAM: 'JM',
  JOR: 'JO',
  JPN: 'JP',
  KOR: 'KR',
  KSA: 'SA',
  MAR: 'MA',
  MEX: 'MX',
  MLI: 'ML',
  NED: 'NL',
  NGA: 'NG',
  NIR: 'GB',
  NOR: 'NO',
  NZL: 'NZ',
  PAN: 'PA',
  PAR: 'PY',
  PER: 'PE',
  POL: 'PL',
  POR: 'PT',
  PRK: 'KP',
  QAT: 'QA',
  ROU: 'RO',
  RSA: 'ZA',
  RUS: 'RU',
  SEN: 'SN',
  SRB: 'RS',
  SUI: 'CH',
  SVK: 'SK',
  SVN: 'SI',
  SWE: 'SE',
  TRI: 'TT',
  TUN: 'TN',
  TUR: 'TR',
  UAE: 'AE',
  UKR: 'UA',
  URU: 'UY',
  USA: 'US',
  UZB: 'UZ',
  VEN: 'VE',
  WAL: 'GB',
};

/**
 * Display-only short names for FIFA names too long for a 390px fixture grid —
 * mid-word truncation ("Bosnia and He… 🇧🇦") strands the flag after an ellipsis.
 * Callers keep title={fullName} so press-and-hold still reveals the long form.
 */
const SHORT_TEAM_NAMES: Record<string, string> = {
  'Bosnia and Herzegovina': 'Bosnia & Herz.',
  'Korea Republic': 'Korea Rep.',
  'Republic of Ireland': 'Ireland',
  'United Arab Emirates': 'UAE',
  // 'United States' deliberately NOT shortened to 'USA': it fits the fixture
  // grid, and a name identical to its code loses the small code eyebrow —
  // the only one-line team block on a board of two-line blocks.
  'IR Iran': 'Iran',
};

/** Short display name for long FIFA team names; everything else passes through. */
export function shortTeamName(name: string): string {
  const mapped = SHORT_TEAM_NAMES[name];
  if (mapped) return mapped;
  // Knockout placeholders ("Group A runners-up") — drop the word "Group" so
  // the qualifier (winners vs runners-up) survives one line at 390px.
  const placeholder = /^Group ([A-L]) (winners|runners-up)$/.exec(name);
  if (placeholder) return `${placeholder[1]} ${placeholder[2]}`;
  // Later-round feeders ("Winners Match 73") — keep the distinguishing match
  // number, not the shared prefix: two side-by-side "Winners Mat…" are
  // indistinguishable at 390px.
  const feeder = /^Winners Match (\d+)$/.exec(name);
  if (feeder) return `Winner M${feeder[1]}`;
  return name;
}

function iso2ToFlag(iso2: string): string {
  const A = 0x1f1e6; // regional indicator 'A'
  const base = 'A'.charCodeAt(0);
  return (
    String.fromCodePoint(A + (iso2.charCodeAt(0) - base)) +
    String.fromCodePoint(A + (iso2.charCodeAt(1) - base))
  );
}

/** Returns the flag emoji for a FIFA code, or null for unknown/TBD teams. */
export function codeToFlagEmoji(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  if (SPECIAL[upper]) return SPECIAL[upper];
  const iso2 = FIFA_TO_ISO2[upper];
  if (!iso2) return null;
  return iso2ToFlag(iso2);
}
