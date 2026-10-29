import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreHook } from "@/lib/scoreHook";
import { getRewrites } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars are not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Honeypot: real visitors never fill the hidden "company_url" field.
  if (body.company_url) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const name = String(body.name ?? "").trim().slice(0, 120);
  const designation = String(body.designation ?? "").trim().slice(0, 120);
  const company = String(body.company ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
  const hook = String(body.hook ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 1000);

  const errors: Record<string, string> = {};
  if (name.length < 2) errors.name = "Please add your name";
  if (!designation) errors.designation = "Please add your designation";
  if (!EMAIL_RE.test(email)) errors.email = "Please use a valid email";
  if (hook.length < 10) errors.hook = "Paste the first two lines of your post";
  if (Object.keys(errors).length) return NextResponse.json({ errors }, { status: 422 });

  // 1. Rules first. Pure code, so the visitor always gets a score.
  const graded = scoreHook(hook);
  const failed = graded.results.filter((r) => !r.passed);

  // 2. Save the session before calling Gemini, so nothing is lost if Gemini fails.
  const supabase = db();
  const { data: row, error: insertError } = await supabase
    .from("hook_sessions")
    .insert({ name, designation, email, hook_text: hook, rule_score: graded.score, rule_results: graded.results })
    .select("id")
    .single();
  if (insertError) {
    // Loud, not silent: this is exactly the Task 3a failure mode.
    console.error("hook_sessions insert failed", insertError);
    return NextResponse.json({ error: "We could not save your session. Please try again." }, { status: 500 });
  }

  // 3. Gemini rewrites. A failure is recorded and shown, the score still returns.
  let rewrites: { angle: string; hook: string; why: string }[] = [];
  let aiError: string | null = null;
  try {
    const out = await getRewrites(hook, failed);
    rewrites = out.rewrites;
    if (out.problems.length) aiError = `rewrites kept some rule issues: ${out.problems.join("; ")}`;
  } catch (e) {
    aiError = e instanceof Error ? e.message : "Gemini failed";
  }
  await supabase.from("hook_sessions").update({ rewrites, ai_error: aiError }).eq("id", row.id);

  // 4. Hand the session to the Task 01 engine (Make or n8n webhook).
  const webhook = process.env.MAKE_WEBHOOK_URL;
  let webhookStatus = "skipped";
  let webhookError: string | null = webhook ? null : "MAKE_WEBHOOK_URL not set";
  if (webhook) {
    const payload = {
      source_tool: "hook_grader",
      hook_session_id: row.id,
      name,
      designation,
      company: company || undefined,
      email,
      tool_input: hook,
      tool_output:
        `Hook score ${graded.score}/100 (${graded.verdict}). ` +
        (failed.length ? `Missed: ${failed.map((r) => r.label.toLowerCase()).join(", ")}.` : "Passed every rule."),
      score: graded.score,
      rule_results: graded.results,
      rewrites,
    };
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      webhookStatus = res.ok ? "sent" : "failed";
      if (!res.ok) webhookError = `HTTP ${res.status}`;
    } catch (e) {
      webhookStatus = "failed";
      webhookError = e instanceof Error ? e.message : "webhook error";
    }
  }
  await supabase.from("hook_sessions").update({ webhook_status: webhookStatus, webhook_error: webhookError }).eq("id", row.id);
  if (webhookStatus === "failed") {
    await supabase.from("pipeline_errors").insert({
      stage: "webhook", payload: { hook_session_id: row.id }, error: webhookError ?? "webhook failed",
    });
  }

  return NextResponse.json({
    score: graded.score,
    verdict: graded.verdict,
    results: graded.results,
    rewrites,
    rewritesUnavailable: rewrites.length === 0,
  });
}
