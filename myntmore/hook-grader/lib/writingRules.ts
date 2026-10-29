// The Task 01 writing rules, applied to the Gemini rewrites.
// Same checks as validateEmail() in the lead engine, minus the meeting link
// (a LinkedIn hook should carry no link at all).

const JARGON = [
  "synergy", "synergies", "leverage", "leveraging", "circle back", "touch base", "game-changer",
  "game changer", "cutting-edge", "best-in-class", "paradigm", "holistic", "robust", "seamless",
  "unlock", "supercharge", "revolutionize", "world-class", "value-add", "low-hanging fruit",
  "move the needle", "deep dive", "bandwidth", "ecosystem", "empower", "streamline", "guarantee",
];

const nums = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.$/, ""));

export function checkRewrite(rewrite: string, originalHook: string) {
  const v: string[] = [];
  const words = rewrite.trim().split(/\s+/).filter(Boolean).length;
  if (words >= 120) v.push(`${words} words, must be under 120`);
  if (/[—–]/.test(rewrite)) v.push("contains a dash character");
  const lower = rewrite.toLowerCase();
  const j = JARGON.filter((w) => lower.includes(w));
  if (j.length) v.push(`jargon: ${j.join(", ")}`);
  if (/https?:\/\/|www\.|\.com\b/i.test(rewrite)) v.push("contains a link");
  const allowed = new Set(nums(originalHook));
  const invented = nums(rewrite).filter((n) => !allowed.has(n));
  if (invented.length) v.push(`invented numbers: ${invented.join(", ")}`);
  if (/\b(clients like|we helped|trusted by|our clients)\b/i.test(rewrite)) v.push("social proof claim");
  return v;
}

// Last-resort cleanup so a rewrite that slipped through never shows a dash.
export const stripDashes = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");
