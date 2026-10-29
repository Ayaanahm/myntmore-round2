// lead-engine: the rule-based half of the Lead Follow-Up Engine.
// Make and n8n call this with { action, ... }. Gemini is called by the workflow
// itself, so every AI step is visible in the scenario.
//
// Actions
//   pending  -> list lead ids waiting to be processed (oldest first)
//   ingest   -> save a new session from a tool (e.g. the Hook Grader), return lead_id
//   prepare  -> clean + dedupe + rule score; says whether Gemini is needed
//   score    -> combine rule score with Gemini score, decide tier
//   email    -> validate Gemini's email against the writing rules and save it
//   crm      -> Zoho CRM record for any lead
//   mark     -> record that the CRM sync / hot alert happened, or log a workflow error
//
// Every failure is written to pipeline_errors and to leads.last_error.

import { createClient } from "npm:@supabase/supabase-js@2";
import { clean, domainOf, finalize, geminiContext, normEmail, ruleScore, validateEmail, type Enrichment, type Lead } from "./rules.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const SECRET = Deno.env.get("ENGINE_SECRET");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function logError(stage: string, lead_id: string | null, payload: unknown, error: string) {
  await db.from("pipeline_errors").insert({ stage, lead_id, payload, error });
  if (lead_id) await db.from("leads").update({ process_status: "error", last_error: `${stage}: ${error}` }).eq("id", lead_id);
}

async function getLead(id: string) {
  const { data, error } = await db.from("leads").select("*").eq("id", id).single();
  if (error || !data) throw new Error(`lead ${id} not found: ${error?.message}`);
  return data as Lead & Record<string, any>;
}

// Enrichment lookup: by company name, or by the stem of the company's domain.
async function findEnrichment(l: Lead & Record<string, any>) {
  const keys = new Set<string>();
  if (l.company) keys.add(String(l.company).trim().toLowerCase());
  const d = domainOf(l);
  if (d) keys.add(d.split(".")[0]);
  if (!keys.size) return null;
  const { data } = await db.from("company_enrichment").select("*").in("key", [...keys]).limit(1);
  return (data?.[0] ?? null) as (Enrichment & Record<string, any>) | null;
}

async function sameEmailSessions(l: Lead & Record<string, any>) {
  const e = normEmail(l.email);
  if (!e) return [];
  const { data } = await db.from("leads").select("*").eq("email_normalized", e).order("session_at", { ascending: true });
  return (data ?? []) as (Lead & Record<string, any>)[];
}

const handlers: Record<string, (b: any) => Promise<unknown>> = {
  async pending(b) {
    const { data, error } = await db.from("leads").select("id, external_lead_id, name")
      .in("process_status", b.include_errors ? ["new", "error"] : ["new"])
      .order("session_at", { ascending: true }).limit(b.limit ?? 50);
    if (error) throw error;
    return { count: data.length, leads: data };
  },

  async ingest(b) {
    // Accepts the Hook Grader payload (or any tool) and stores it as a lead session.
    const tool = String(b.source_tool ?? "").trim();
    const { data: alias } = await db.from("tool_aliases").select("tool_slug").eq("alias", tool).maybeSingle();
    const [first, ...rest] = String(b.name ?? "").trim().split(/\s+/);
    // Company: typed on the form, or derived from a work email domain (never from gmail etc).
    const domain = normEmail(b.email).split("@")[1] ?? "";
    const workDomain = domain && !/(gmail|yahoo|outlook|hotmail|icloud|proton|live|rediffmail)\./.test(domain) ? domain : null;
    const derivedCompany = workDomain
      ? workDomain.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : null;
    const typedCompany = b.company ? String(b.company).trim() || null : null;
    const row = {
      origin: b.origin ?? "webhook",
      source_tool_raw: tool || "unknown",
      tool_slug: alias?.tool_slug ?? null,
      first_name: b.first_name ?? first ?? null,
      last_name: b.last_name ?? (rest.join(" ") || null),
      name: b.name ?? null,
      designation: b.designation ?? null,
      email: b.email ?? null,
      company: typedCompany ?? derivedCompany,
      company_website: b.company_website ?? workDomain,
      linkedin_url: b.linkedin_url ?? null,
      tool_input: b.tool_input ? { text: String(b.tool_input) } : null,
      tool_output: b.tool_output ? { text: String(b.tool_output) } : null,
      session_at: b.session_at ?? new Date().toISOString(),
      raw_payload: b,
      flags: [...(alias ? [] : ["unknown_tool"]), ...(!typedCompany && derivedCompany ? ["company_from_email"] : [])], // saved anyway, never rejected
    };
    const { data, error } = await db.from("leads").insert(row).select("id").single();
    if (error) throw error;
    if (b.hook_session_id) await db.from("hook_sessions").update({ lead_id: data.id }).eq("id", b.hook_session_id);
    return { lead_id: data.id, unknown_tool: !alias };
  },

  async prepare(b) {
    const l = await getLead(b.lead_id);
    await db.from("leads").update({ process_status: "processing", attempts: (l.attempts ?? 0) + 1 }).eq("id", l.id);

    if (!l.tool_slug) {
      const { data: alias } = await db.from("tool_aliases").select("tool_slug").eq("alias", l.source_tool_raw).maybeSingle();
      l.tool_slug = alias?.tool_slug ?? null;
    }
    const sessions = await sameEmailSessions(l);
    const first = sessions[0];
    const earlier = first && first.id !== l.id ? first : null;
    const later = earlier ? [] : sessions.filter((s) => s.id !== l.id);

    const c = clean(l, earlier);
    if (!l.tool_slug && !c.flags.includes("unknown_tool")) c.flags.push("unknown_tool");
    const enrichment = c.clean_status === "clean" ? await findEnrichment(l) : null;
    if (enrichment) {
      c.flags.push("enriched");
      if (!l.company_website && enrichment.domain) l.company_website = enrichment.domain; // fills R2 from enrichment
    }
    const r = ruleScore(l, c.flags, c.clean_status === "clean" ? later : [], enrichment);

    const update: Record<string, unknown> = {
      tool_slug: l.tool_slug,
      company_website: l.company_website ?? null,
      account_domain: domainOf(l),
      flags: c.flags,
      clean_status: c.clean_status,
      clean_reason: c.clean_reason,
      duplicate_of: earlier?.id ?? null,
      rule_score: r.rule_score,
      rule_breakdown: r.rule_breakdown,
      matched_service: r.matched_service,
      enrichment: enrichment
        ? { company: enrichment.company, hq: enrichment.hq, employees: enrichment.employees, funding_stage: enrichment.funding_stage,
            last_round_usd: enrichment.last_round_usd, last_round_date: enrichment.last_round_date, investors: enrichment.investors,
            sells: enrichment.sells, sources: enrichment.sources, enriched_at: enrichment.enriched_at }
        : null,
    };

    if (c.clean_status !== "clean") {
      // Not emailed. Duplicates are merged (no tier of their own); everything else is tagged not a fit.
      Object.assign(update, c.clean_status === "duplicate"
        ? { tier: null, not_fit_reason: null, score_reason: c.clean_reason, process_status: "done" }
        : { tier: "not_a_fit", not_fit_reason: c.clean_reason, final_score: Math.max(1, r.rule_score),
            score_reason: c.clean_reason, process_status: "done" });
      const { error } = await db.from("leads").update(update).eq("id", l.id);
      if (error) throw error;
      return { lead_id: l.id, next: "stop", clean_status: c.clean_status, reason: c.clean_reason };
    }

    // Account context: other people from the same company (e.g. Neha + Aditi at Stackwise HR).
    let colleagues: { name: string; designation: string }[] = [];
    if (update.account_domain) {
      const { data } = await db.from("leads").select("name, designation")
        .eq("account_domain", update.account_domain).neq("id", l.id).neq("email_normalized", normEmail(l.email));
      colleagues = (data ?? []) as any;
    }

    const { error } = await db.from("leads").update(update).eq("id", l.id);
    if (error) throw error;
    return {
      lead_id: l.id,
      next: "gemini",
      rule_score: r.rule_score,
      rule_breakdown: r.rule_breakdown,
      matched_service: r.matched_service,
      flags: c.flags,
      context: { ...geminiContext(l, c.flags, later), colleagues_who_used_tools: colleagues },
    };
  },

  async score(b) {
    const l = await getLead(b.lead_id);
    const ai = b.ai_score == null ? null : Math.max(1, Math.min(10, Math.round(Number(b.ai_score))));
    const sen = (l.rule_breakdown ?? []).find((x: any) => x.rule === "R1 seniority")?.points ?? 0;
    const f = finalize(l.rule_score ?? 0, ai, l.flags ?? [], sen);
    const services = ["personal_branding", "linkedin_outreach", "cold_email", "lead_generation"];
    const service = services.includes(b.matched_service) ? b.matched_service : l.matched_service;
    const reason = [String(b.ai_reason ?? "").slice(0, 200), ...f.notes].filter(Boolean).join(" | ")
      || `Rule score ${l.rule_score}/10`;
    const update: Record<string, unknown> = {
      ai_score: ai,
      ai_reason: b.ai_reason ?? (ai == null ? "Gemini unavailable, rule score used" : null),
      final_score: f.final_score,
      score_reason: reason,
      matched_service: service,
      tier: f.tier,
      not_fit_reason: f.tier === "not_a_fit" ? reason : null,
      process_status: f.tier === "not_a_fit" ? "done" : "processing",
    };
    const { error } = await db.from("leads").update(update).eq("id", l.id);
    if (error) throw error;
    return {
      lead_id: l.id,
      tier: f.tier,
      final_score: f.final_score,
      score_reason: reason,
      matched_service: service,
      next: f.tier === "not_a_fit" ? "stop" : "write_email",
      can_email: Boolean(normEmail(l.email)),
    };
  },

  async email(b) {
    const l = await getLead(b.lead_id);
    const sessions = await sameEmailSessions(l);
    const source = [l, ...sessions].map((s) => `${s.tool_input?.text ?? ""} ${s.tool_output?.text ?? ""}`).join(" ");
    const subject = String(b.subject ?? "").trim();
    const body = String(b.body ?? "").trim();
    const v = validateEmail(subject, body, source);
    const attempt = Number(b.attempt ?? 1);

    if (!v.ok && attempt < 2) {
      // Workflow sends these violations back to Gemini once.
      return { lead_id: l.id, ok: false, retry: true, violations: v.violations };
    }
    const update: Record<string, unknown> = {
      email_subject: subject,
      email_body: body,
      email_word_count: v.word_count,
      email_checks: { passed: v.ok, violations: v.violations, attempts: attempt },
      process_status: v.ok ? "done" : "error",
      last_error: v.ok ? null : `email failed checks after ${attempt} tries: ${v.violations.join("; ")}`,
    };
    const { error } = await db.from("leads").update(update).eq("id", l.id);
    if (error) throw error;
    if (!v.ok) await db.from("pipeline_errors").insert({ stage: "email", lead_id: l.id, payload: { subject, body }, error: v.violations.join("; ") });
    return {
      lead_id: l.id,
      ok: v.ok,
      retry: false,
      violations: v.violations,
      tier: l.tier,
      alert: l.tier === "hot",
    };
  },

  // Zoho CRM record for any lead, whatever its tier. Drafts are stored, never sent.
  async crm(b) {
    const l = await getLead(b.lead_id);
    const tierLabel = l.clean_status === "duplicate" ? "Duplicate (merged)"
      : l.tier === "hot" ? "Hot" : l.tier === "warm" ? "Warm" : "Not a fit";
    const lines = [
      `Tier: ${tierLabel} | Score: ${l.final_score ?? "-"}/10 (rules ${l.rule_score ?? "-"}, Gemini ${l.ai_score ?? "-"})`,
      `Service: ${l.matched_service ?? "-"} | Tool: ${l.tool_slug ?? l.source_tool_raw}`,
      `Reason: ${l.not_fit_reason ?? l.score_reason ?? l.clean_reason ?? "-"}`,
      `Flags: ${(l.flags ?? []).join(", ") || "none"}`,
      l.enrichment
        ? `Enrichment: ${l.enrichment.company}, ${l.enrichment.funding_stage ?? "funding n/a"}` +
          (l.enrichment.last_round_usd ? ` ($${Math.round(l.enrichment.last_round_usd / 1e6)}M, ${String(l.enrichment.last_round_date).slice(0, 7)})` : "") +
          (l.enrichment.employees ? `, ~${l.enrichment.employees} staff` : "") +
          (l.enrichment.hq ? `, ${l.enrichment.hq}` : "") +
          (l.enrichment.investors?.length ? `. Investors: ${l.enrichment.investors.slice(0, 2).join(", ")}` : "")
        : "Enrichment: none",
      l.email_body ? `\nDRAFT EMAIL (not sent)\nSubject: ${l.email_subject}\n\n${l.email_body}` : "\nNo email drafted.",
    ];
    return {
      lead_id: l.id,
      tier: tierLabel,
      zoho: {
        First_Name: l.first_name ?? "",
        Last_Name: l.last_name || l.first_name || "Unknown",
        Email: l.email ?? "",
        Company: l.company || "Unknown",
        Designation: l.designation ?? "",
        Website: l.company_website ?? "",
        // Picklists (Rating, Lead_Status) reject unknown values, so the tier travels as a Tag.
        Tag: [{ name: tierLabel }, { name: `tool-${l.tool_slug ?? "unknown"}` }],
        Description: lines.join("\n"),
      },
    };
  },

  async mark(b) {
    const patch: Record<string, unknown> = {};
    if (b.crm_synced) patch.crm_synced_at = new Date().toISOString();
    if (b.alert_sent) patch.alert_sent_at = new Date().toISOString();
    if (b.error) return logError(b.stage ?? "workflow", b.lead_id, b, String(b.error)).then(() => ({ logged: true }));
    const { error } = await db.from("leads").update(patch).eq("id", b.lead_id);
    if (error) throw error;
    return { ok: true };
  },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SECRET || req.headers.get("x-engine-secret") !== SECRET) return json({ error: "unauthorized" }, 401);
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const fn = handlers[body.action];
  if (!fn) return json({ error: `unknown action '${body.action}'`, actions: Object.keys(handlers) }, 400);
  try {
    return json(await fn(body));
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    await logError(body.action, body.lead_id ?? null, body, msg).catch(() => {});
    return json({ error: msg, action: body.action, lead_id: body.lead_id ?? null }, 500);
  }
});
