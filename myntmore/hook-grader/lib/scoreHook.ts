// Deterministic hook scoring. No AI, no randomness, no dates.
// The same hook always returns the same score. Rules add up to 100.

export type RuleResult = {
  id: string;
  label: string;
  points: number;   // points earned
  max: number;      // points available
  passed: boolean;
  message: string;  // one line, shown when the rule fails
};

const WEAK_OPENERS = [
  /^i('| a)?m (so )?(excited|thrilled|happy|delighted|proud|honou?red)/i,
  /^(hello|hi|hey) (everyone|all|linkedin|folks|connections)/i,
  /^in today'?s (fast|world|digital|ever)/i,
  /^as an? /i,
  /^did you know/i,
  /^(today )?i want(ed)? to share/i,
  /^(so|well|ok|okay),? /i,
  /^this is (a|my) (post|update)/i,
];

const FLUFF = [
  "synergy", "leverage", "game changer", "game-changer", "cutting-edge", "best-in-class",
  "revolutionize", "unlock", "supercharge", "world-class", "paradigm", "seamless", "next level",
  "thought leader", "disrupt",
];

const TENSION = /\b(but|nobody|no one|stop|mistake|wrong|why|how|never|secret|truth|lesson|failed|lost|quit|instead|actually|unpopular|myth)\b/i;

export function normalizeHook(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function scoreHook(raw: string) {
  const lines = normalizeHook(raw);
  const first = lines[0] ?? "";
  const text = lines.join(" ");
  const lower = text.toLowerCase();
  const results: RuleResult[] = [];
  const rule = (id: string, label: string, max: number, earned: number, message: string) =>
    results.push({ id, label, max, points: earned, passed: earned === max, message });

  // R1 (20): first line fits before LinkedIn's "see more" cut on mobile.
  const len = first.length;
  rule("first_line_length", "First line is short", 20,
    len === 0 ? 0 : len <= 60 ? 20 : len <= 80 ? 10 : 0,
    len <= 60 ? "" : `Your first line is ${len} characters. Keep it under 60 so it is not cut off on mobile.`);

  // R2 (15): exactly two lines, so the hook reads as a set-up and a pull.
  rule("two_lines", "Two separate lines", 15, lines.length === 2 ? 15 : 0,
    lines.length === 2 ? "" : lines.length < 2
      ? "Only one line. Break it into two: a set-up line, then a line that makes them click."
      : `You have ${lines.length} lines. A hook works best as exactly two.`);

  // R3 (20): strong opener, not a warm-up phrase.
  const weak = WEAK_OPENERS.find((re) => re.test(first));
  rule("strong_opener", "Opens with substance", 20, weak ? 0 : 20,
    weak ? `It opens with a warm-up ("${first.split(" ").slice(0, 4).join(" ")}..."). Start with the point instead.` : "");

  // R4 (15): specific: a number, a name or a concrete detail.
  const specific = /\d/.test(text) || /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(text.slice(1));
  rule("specific", "Has a specific detail", 15, specific ? 15 : 0,
    specific ? "" : "No number or concrete detail. Specific hooks feel real, vague ones get scrolled past.");

  // R5 (15): creates tension or speaks to the reader.
  const tension = TENSION.test(text) || /\?/.test(text) || /\byou(r)?\b/i.test(text);
  rule("tension", "Creates tension or speaks to the reader", 15, tension ? 15 : 0,
    tension ? "" : "No tension, question or 'you'. Give the reader a reason to want line three.");

  // R6 (15): clean: no fluff words, hashtags, links or emoji walls.
  const fluffHit = FLUFF.filter((f) => lower.includes(f));
  const hashtags = (text.match(/#\w+/g) ?? []).length;
  const links = /https?:\/\/|www\./i.test(text);
  const emojis = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  const problems = [
    fluffHit.length ? `buzzwords (${fluffHit.join(", ")})` : "",
    hashtags ? "hashtags" : "",
    links ? "a link" : "",
    emojis > 1 ? "too many emojis" : "",
  ].filter(Boolean);
  rule("clean", "No fluff, hashtags or links", 15, problems.length ? 0 : 15,
    problems.length ? `Remove ${problems.join(", ")} from the first two lines.` : "");

  const score = results.reduce((a, r) => a + r.points, 0);
  const verdict = score >= 80 ? "Strong hook" : score >= 55 ? "Decent, fix the misses" : "Needs work";
  return { score, verdict, lines, results };
}
