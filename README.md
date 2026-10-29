# Myntmore: Systems & AI Automation Intern, Round 2
Live Hook Grader: https://myntmore-hook-grader.vercel.app
| Task | Where |
|---|---|
| 01 Lead Follow-Up Engine | `supabase/` (schema + rules engine), `automation/` (n8n workflow, Make build sheet, Gemini prompts) |
| 02 LinkedIn Hook Grader | `hook-grader/` (Next.js, deploy on Vercel) |
| Bonus enrichment | `docs/enrichment.md` |

## How it fits together

```
leads.csv ─┐                          ┌─ RULES: clean, dedupe, score (lead-engine)
Hook Grader ─ webhook ─► Make / n8n ──┼─ GEMINI: fit score + reason
                                      ├─ RULES: final score, tier
                                      ├─ GEMINI: email (only Hot / Warm)
                                      ├─ RULES: check writing rules, one retry
                                      └─ Zoho CRM (every lead) + internal alert (Hot)
                         Supabase: leads, hook_sessions, pipeline_errors
```

**Rules vs Gemini.** All cleaning, the 0 to 10 rule score, tiering and email checks are plain code in `supabase/functions/lead-engine/rules.ts`. Gemini does two things: judge fit (1 to 10 with a reason) and write the email. Final score = round(0.6 × rules + 0.4 × Gemini). Full table in `automation/gemini_prompts.md`.

## Scoring rules (out of 10)

| Rule | Points |
|---|---|
| R1 Seniority: founder, CEO, MD, C-level = 4 · VP, Head, Director = 3 · Manager = 1 | 0 to 4 |
| R2 Real company: name and website present | 0 to 1 |
| R3 B2B buyer: sells to businesses (CFOs, HR heads, importers...), ROI calculator users count | 0 to 2 |
| R4 Intent: ROI calculator or more than one tool = 2, one completed tool = 1, empty or failed = 0 | 0 to 2 |
| R5 Visible pain: the tool showed a gap (score under 50, "gaps", "needs work") | 0 to 1 |

Tiers: Hot ≥ 8, Warm 5 to 7, Not a fit < 5. Hard gates before scoring: test entry, duplicate (merged into the first session), student or job seeker, competitor. Prompt-like input is withheld from Gemini and capped at 4.

## Messy rows in leads.csv

| Row | Handling |
|---|---|
| L04, L10, L18 | `*_generator` tool names mapped by `tool_aliases` (the 3a bug) |
| L05 | Empty session: senior title, so Warm with a generic nurture |
| L07 | Test entry |
| L09, L14 | Student / job seeker: Not a fit |
| L11 | Same email as L03: duplicate, both sessions feed one email |
| L15 | Same company as L02: linked by `account_domain`, passed to Gemini as context |
| L16 | Ghostwriter: competitor |
| L18 | No email: still scored, alert says find email, no draft |
| L19 | Prompt injection: input withheld from Gemini, capped, human review |
| L20 | AED figures: email may only reuse numbers the lead typed |

## Setup

1. **Supabase:** run `supabase/schema.sql`, then `supabase/import_leads.sql`. Deploy `supabase/functions/lead-engine` and set the secret `ENGINE_SECRET` in *Edge Functions › Secrets*.
2. **n8n:** import `automation/n8n_workflow.json` and create 4 credentials: engine secret (Header Auth `x-engine-secret`), Gemini (Header Auth `x-goog-api-key`), Zoho OAuth2, Gmail. **Or Make:** follow `automation/make_scenario.md`.
3. **Hook Grader:** `cd hook-grader && npm i && npm test`. Deploy to Vercel with root directory `hook-grader` and env vars from `.env.example`.

No keys are committed. Every secret lives in Supabase secrets, workflow credentials or Vercel env vars.
