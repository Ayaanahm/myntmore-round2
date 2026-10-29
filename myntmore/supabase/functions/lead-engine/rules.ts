// Deterministic rules for the Myntmore Lead Follow-Up Engine.
// Everything in this file is plain code: same input, same output, no AI.
// Gemini only does two jobs (judging fit nuance, writing the email), and its
// output is checked by validateEmail() below before anything is saved.

export type Lead = {
  id?: string;
  external_lead_id?: string | null;
  tool_slug?: string | null;
  source_tool_raw?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  designation?: string | null;
  email?: string | null;
  company?: string | null;
  company_website?: string | null;
  linkedin_url?: string | null;
  tool_input?: { text?: string } | null;
  tool_output?: { text?: string } | null;
};

export type CleanResult = {
  clean_status: "clean" | "duplicate" | "test_entry" | "invalid" | "non_buyer" | "competitor";
  clean_reason: string | null;
  flags: string[];
};

// ---- Config: edit these lists to add a rule. No other code changes needed. ----
export const CONFIG = {
  hotThreshold: 8,      // final score >= 8 => hot
  warmThreshold: 5,     // final score 5..7 => warm, below => not a fit
  ruleWeight: 0.6,      // final = 0.6 * rule + 0.4 * gemini
  suspiciousCap: 4,     // input that looks like prompt injection never reaches warm/hot; a human reviews it
  testPatterns: [/^test@/i, /@test\.com$/i, /@example\.com$/i, /mailinator|yopmail|tempmail/i],
  junkInput: /^(asdf|test|xxx|qwerty|abc|na|n\/a|\.+)$/i,
  nonBuyerTitle: /\b(student|intern|fresher|open to work|aspiring|job seeker|looking for)\b/i,
  nonBuyerInput: /\b(looking for an? (sdr|bdr|job|role)|offer: me\b|hiring managers?\b.*\bme\b)/i,
  competitorSignals: /\b(ghostwrit\w*|i write linkedin posts|linkedin (agency|ghostwriting)|lead gen(eration)? agency)\b/i,
  injection: /(ignore (all )?(previous|prior|above) instructions|system prompt|set the (score|tier)|you are now|disregard .* instructions)/i,
  toolFailed: /\b(failed|error)\b/i,
  seniority: [
    { re: /\b(founder|co-founder|ceo|owner|managing director|md|partner)\b/i, pts: 4, label: "decision maker" },
    { re: /\b(chief \w+ officer|cxo|cro|cfo|cmo|coo|cto)\b/i, pts: 4, label: "C-level" },
    { re: /\b(vp|vice president|head of|director)\b/i, pts: 3, label: "senior leader" },
    { re: /\bmanager\b/i, pts: 1, label: "manager (influencer, not buyer)" },
  ],
  b2bSignals: /\b(b2b|cfos?|ctos?|ceos?|hr heads?|procurement|importers?|finance heads?|founders|mid-market|mid-size|enterprise|companies|brands?)\b/i,
  b2cSignals: /\b(parents|kids|consumers|students|shoppers)\b/i,
  // Which Myntmore service a tool session points to.
  serviceByTool: {
    profile_optimizer: "personal_branding",
    posting_rhythm_builder: "personal_branding",
    founder_presence_analyzer: "personal_branding",
    hook_grader: "personal_branding",
    roi_calculator: "linkedin_outreach",
    dm_angle_generator: "linkedin_outreach",
    icp_builder: "lead_generation",
    lead_magnet_ideas: "lead_generation",
    battle_card: "cold_email",
    case_study: "cold_email",
  } as Record<string, string>,
  // Tools whose use shows the visitor is actively weighing outbound spend.
  highIntentTools: ["roi_calculator"],
  allowedLink: "myntmore.com/founder-meeting",
  maxWords: 120,
  jargon: [
    "synergy", "synergies", "leverage", "leveraging", "circle back", "touch base", "game-changer",
    "game changer", "cutting-edge", "best-in-class", "paradigm", "holistic", "robust", "seamless",
    "scalable solution", "unlock", "supercharge", "revolutionize", "world-class", "value-add",
    "low-hanging fruit", "move the needle", "deep dive", "bandwidth", "ecosystem", "empower",
    "streamline", "hope this email finds you well", "guarantee", "guaranteed",
  ],
};

const txt = (v?: { text?: string } | null) => (v?.text ?? "").trim();
export const normEmail = (e?: string | null) => (e ?? "").trim().toLowerCase();
export const domainOf = (l: Lead) => {
  const w = (l.company_website ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (w) return w;
  const d = normEmail(l.email).split("@")[1] ?? "";
  return /gmail|yahoo|outlook|hotmail/.test(d) ? null : d || null;
};

// ---- 1. Cleaning (order matters: first hard rule wins, flags accumulate) ----
export function clean(l: Lead, earlierSameEmail?: Lead | null): CleanResult {
  const flags: string[] = [];
  const email = normEmail(l.email);
  const input = txt(l.tool_input);
  const output = txt(l.tool_output);
  const allText = `${l.designation ?? ""} ${l.company ?? ""} ${input}`;

  if (!email) flags.push("no_email");
  if (!input || !output) flags.push("incomplete_session");
  if (output && CONFIG.toolFailed.test(output)) flags.push("tool_failed");
  if (CONFIG.injection.test(input)) flags.push("suspicious_input");
  if (!l.company) flags.push("no_company");
  if (/gmail|yahoo|outlook|hotmail/.test(email)) flags.push("personal_email");

  const isTest =
    CONFIG.testPatterns.some((re) => re.test(email)) ||
    [l.first_name, l.last_name, l.company].filter(Boolean).every((v) => /^test$/i.test(String(v))) ||
    CONFIG.junkInput.test(input);
  if (isTest) return { clean_status: "test_entry", clean_reason: "Test submission (test name/email or junk input)", flags };

  if (!email && !l.linkedin_url)
    return { clean_status: "invalid", clean_reason: "No email and no LinkedIn URL, cannot follow up", flags };

  if (earlierSameEmail)
    return {
      clean_status: "duplicate",
      clean_reason: `Repeat session from same email as ${earlierSameEmail.external_lead_id ?? "an earlier lead"}; merged into that lead`,
      flags,
    };

  if (CONFIG.nonBuyerTitle.test(l.designation ?? "") || CONFIG.nonBuyerInput.test(input))
    return { clean_status: "non_buyer", clean_reason: "Job seeker or student, not buying services", flags };

  if (CONFIG.competitorSignals.test(allText))
    return { clean_status: "competitor", clean_reason: "Sells LinkedIn writing/outbound services, a competitor", flags };

  return { clean_status: "clean", clean_reason: null, flags };
}

// ---- 2. Rule score, 0..10 ----
export type Enrichment = { company: string; employees: number | null; funding_stage: string | null; last_round_usd: number | null; last_round_date: string | null };

export function ruleScore(l: Lead, flags: string[], extraSessions: Lead[] = [], enrichment: Enrichment | null = null) {
  const breakdown: { rule: string; points: number; note: string }[] = [];
  const add = (rule: string, points: number, note: string) => breakdown.push({ rule, points, note });
  const title = l.designation ?? "";
  const sessions = [l, ...extraSessions];
  const inputs = sessions.map((s) => txt(s.tool_input)).join(" ");
  const outputs = sessions.map((s) => txt(s.tool_output)).join(" ");

  // R1 seniority (0-4)
  const sen = CONFIG.seniority.find((s) => s.re.test(title));
  add("R1 seniority", sen?.pts ?? 0, sen ? sen.label : "title not senior");

  // R2 real company (0-1)
  add("R2 company", l.company && l.company_website ? 1 : 0, l.company_website ? "company + website present" : "no company website");

  // R3 B2B target (0-2). Suspicious input is not trusted as evidence.
  const safeInputs = flags.includes("suspicious_input") ? "" : inputs;
  // Running the ROI calculator means modelling LinkedIn outbound, so it counts as a B2B signal.
  const b2b = CONFIG.b2bSignals.test(safeInputs) || CONFIG.highIntentTools.includes(l.tool_slug ?? "");
  const b2c = CONFIG.b2cSignals.test(safeInputs);
  add("R3 B2B buyer", b2b && !b2c ? 2 : b2b ? 1 : 0, b2b && !b2c ? "sells to businesses" : b2c ? "sells to consumers" : "no B2B signal");

  // R4 tool intent (0-2)
  const slug = l.tool_slug ?? "";
  const used = new Set(sessions.map((s) => s.tool_slug));
  const intent = flags.includes("incomplete_session") || flags.includes("tool_failed") ? 0
    : CONFIG.highIntentTools.includes(slug) || used.size > 1 ? 2 : 1;
  add("R4 intent", intent, intent === 2 ? (used.size > 1 ? "used more than one tool" : "ran the ROI calculator") : intent ? "completed a tool" : "session empty or tool failed");

  // R5 visible pain from the tool result (0-1)
  const scores = [...outputs.matchAll(/(\d{1,3})\s*\/\s*100/g)].map((m) => Number(m[1]));
  const pain = scores.some((s) => s < 50) || /gaps?|needs work|rarely/i.test(outputs);
  add("R5 pain", pain ? 1 : 0, pain ? "tool surfaced a clear gap" : "no clear gap shown");

  // R6 growth signal from enrichment (0-1): funded in the last 18 months or 50+ staff.
  if (enrichment) {
    const months = enrichment.last_round_date
      ? (Date.now() - new Date(enrichment.last_round_date).getTime()) / (30.44 * 864e5) : Infinity;
    const growth = months <= 18 || (enrichment.employees ?? 0) >= 50;
    add("R6 growth", growth ? 1 : 0,
      growth ? `enriched: ${enrichment.funding_stage ?? "funded"}${enrichment.employees ? `, ~${enrichment.employees} staff` : ""}` : "enriched, no growth signal");
  }

  const total = Math.min(10, breakdown.reduce((a, b) => a + b.points, 0));
  return {
    rule_score: total,
    rule_breakdown: breakdown,
    seniority_points: sen?.pts ?? 0,
    matched_service: CONFIG.serviceByTool[slug] ?? "lead_generation",
  };
}

// ---- 3. Final score and tier ----
export function finalize(ruleScoreVal: number, aiScore: number | null, flags: string[], seniorityPts = 0) {
  let final = aiScore == null ? ruleScoreVal : Math.round(CONFIG.ruleWeight * ruleScoreVal + (1 - CONFIG.ruleWeight) * aiScore);
  const notes: string[] = [];
  if (flags.includes("suspicious_input")) {
    final = Math.min(final, CONFIG.suspiciousCap);
    notes.push("capped: tool input looked like instructions to the AI, needs a human look");
  }
  // A senior person who left the tool empty is still worth one light nurture email.
  if (flags.includes("incomplete_session") && !flags.includes("suspicious_input") && seniorityPts >= 3 && final < CONFIG.warmThreshold) {
    final = CONFIG.warmThreshold;
    notes.push("raised to warm: senior title, empty session, generic nurture only");
  }
  final = Math.max(1, Math.min(10, final));
  const tier = final >= CONFIG.hotThreshold ? "hot" : final >= CONFIG.warmThreshold ? "warm" : "not_a_fit";
  return { final_score: final, tier, notes };
}

// ---- 4. Email validator: Gemini output never ships without passing this ----
export function validateEmail(subject: string, body: string, sourceText: string) {
  const full = `${subject}\n${body}`;
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  const violations: string[] = [];
  if (words >= CONFIG.maxWords) violations.push(`body is ${words} words, must be under ${CONFIG.maxWords}`);
  if (/[—–]/.test(full)) violations.push("contains an em or en dash");
  const lower = full.toLowerCase();
  const jargon = CONFIG.jargon.filter((j) => lower.includes(j));
  if (jargon.length) violations.push(`jargon: ${jargon.join(", ")}`);
  const links = full.match(/(https?:\/\/)?(www\.)?[a-z0-9-]+\.[a-z]{2,}(\/[^\s)]*)?/gi) ?? [];
  const badLinks = links.filter((u) => !u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").startsWith(CONFIG.allowedLink));
  if (badLinks.length) violations.push(`links other than ${CONFIG.allowedLink}: ${badLinks.join(", ")}`);
  if (!lower.includes(CONFIG.allowedLink)) violations.push(`missing the ${CONFIG.allowedLink} link`);
  // Numbers: every number in the email must appear in what the lead typed or the tool returned.
  const toNums = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.$/, ""));
  const srcNums = new Set(toNums(sourceText));
  const invented = toNums(full.replace(/myntmore\.com\/founder-meeting/gi, "")).filter((n) => !srcNums.has(n));
  if (invented.length) violations.push(`numbers not in the lead's data: ${invented.join(", ")}`);
  if (/\b(clients like|we helped|our clients|trusted by|\d+\+? (founders|clients|companies))\b/i.test(full))
    violations.push("social proof claim");
  return { ok: violations.length === 0, word_count: words, violations };
}

// Data Gemini sees. Suspicious text is withheld, not passed through.
export function geminiContext(l: Lead, flags: string[], extraSessions: Lead[] = []) {
  const sessions = [l, ...extraSessions].map((s) => ({
    tool: s.tool_slug,
    what_they_typed: flags.includes("suspicious_input") ? "[withheld: input looked like instructions, not data]" : txt(s.tool_input),
    what_the_tool_returned: txt(s.tool_output),
  }));
  return { first_name: l.first_name, designation: l.designation, company: l.company, sessions };
}
