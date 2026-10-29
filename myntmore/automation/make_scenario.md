# Make.com scenario: Myntmore Lead Follow-Up Engine

Same flow as `n8n_workflow.json`. The rules live in one place (the `lead-engine` Supabase function), so Make and n8n can never disagree about a score.

**Before you start, create these in Make (never paste secrets into module fields):**
- A **Custom keychain / API key** connection called `Myntmore engine` that sends header `x-engine-secret`.
- An **API key** connection called `Gemini` that sends header `x-goog-api-key` (key from Google AI Studio).
- A **Zoho CRM** connection (use the `.in` data centre if your Zoho account is Indian).
- A **Gmail** connection to *your own* inbox for internal hot-lead alerts.

Engine URL for every "RULES" module: `https://ckgpeqtehyrloviqyfab.supabase.co/functions/v1/lead-engine` (POST, body type JSON, parse response = Yes).

---

## Scenario A: batch run on leads.csv (Run once)

| # | Module | Settings | Rules or Gemini |
|---|---|---|---|
| 1 | HTTP › Make a request | RULES. Body `{"action":"pending","limit":50}` | Rules |
| 2 | Iterator | Array = `1.data.leads` | |
| 3 | HTTP › Make a request | RULES. Body `{"action":"prepare","lead_id":"{{2.id}}"}`. Error handler: **Resume** (engine already logged it) | Rules: clean, dedupe, score |
| 4 | Router | Route A filter: `3.data.next` = `gemini`. Route B (fallback): go straight to module 13 | |
| 5 | HTTP › Make a request | `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, connection `Gemini`, body = **Call 1** from `gemini_prompts.md`, with `{{toString(3.data.context)}}` inside `<lead_data>`. Error handler: **Resume** with empty output. Retries: 3 | **Gemini: fit score** |
| 6 | JSON › Parse JSON | String = `5.data.candidates[].content.parts[].text` (first) | |
| 7 | HTTP › Make a request | RULES. Body `{"action":"score","lead_id":"{{3.data.lead_id}}","ai_score":{{ifempty(6.ai_score; null)}},"ai_reason":"{{6.reason}}","matched_service":"{{6.matched_service}}"}` | Rules: blend, caps, tier |
| 8 | Router | Filter: `7.data.next` = `write_email` AND `7.data.can_email` = true. Fallback → module 13 | |
| 9 | HTTP › Make a request | Gemini, body = **Call 2**, replace `__SERVICE__` with `7.data.matched_service` and `__TIER__` with `7.data.tier`, detail = `6.personal_detail` | **Gemini: email** |
| 10 | JSON › Parse JSON | first `parts[].text` of 9 | |
| 11 | HTTP › Make a request | RULES. Body `{"action":"email","lead_id":"{{3.data.lead_id}}","subject":"{{10.subject}}","body":"{{10.body}}","attempt":1}` | Rules: writing checks |
| 12 | Router | If `11.data.retry` = true: Gemini Call 2 again with the line `Your last draft broke these rules, fix every one: {{join(11.data.violations; "; ")}}`, Parse JSON, then RULES `email` with `"attempt":2`. Else continue | **Gemini rewrite** + Rules |
| 13 | HTTP › Make a request | RULES. Body `{"action":"crm","lead_id":"{{3.data.lead_id}}"}` | Rules |
| 14 | Zoho CRM › Create a Record (Leads) | Map `13.data.zoho` fields: First Name, Last Name, Email, Company, Designation, Website, Description. Tags = `13.data.tier`. Error handler → module 14e | |
| 14e | HTTP (error route) | RULES. Body `{"action":"mark","lead_id":"{{3.data.lead_id}}","stage":"crm","error":"{{14.error.message}}"}`, then **Resume** | Makes the failure visible |
| 15 | HTTP | RULES. `{"action":"mark","lead_id":"{{3.data.lead_id}}","crm_synced":true}` | |
| 16 | Router | Filter `13.data.tier` = `Hot` | |
| 17 | Gmail › Send an email | **To your own address only.** Subject `Hot lead: {{13.data.zoho.First_Name}} {{13.data.zoho.Last_Name}}, {{13.data.zoho.Company}}`. Body `13.data.zoho.Description` | Alert (internal) |
| 18 | HTTP | RULES. `{"action":"mark","lead_id":"{{3.data.lead_id}}","alert_sent":true}` | |

Scenario settings: **Sequential processing = on** (duplicates are decided by order), **Allow storing incomplete executions = on** (failed runs can be retried from Make's history).

## Scenario B: live leads from the Hook Grader

| # | Module | Settings |
|---|---|---|
| 1 | Webhooks › Custom webhook | Name `myntmore-hook-grader`. Copy the URL into Vercel as `MAKE_WEBHOOK_URL`. |
| 2 | HTTP | RULES. Body: `{"action":"ingest","origin":"hook_grader","source_tool":"hook_grader","name":"{{1.name}}","designation":"{{1.designation}}","email":"{{1.email}}","tool_input":"{{1.tool_input}}","tool_output":"{{1.tool_output}}","hook_session_id":"{{1.hook_session_id}}"}` |
| 3 to 18 | Same as Scenario A modules 3 to 18, using `2.data.lead_id` as the lead id | |

Tip: build Scenario A first, then right-click module 3 › **Copy** and paste modules 3 to 18 into Scenario B.

## Why this is easy to extend
- **New tool:** one row in `tools` and `tool_aliases`. No scenario change.
- **New rule or threshold:** edit `CONFIG` in `rules.ts`, redeploy. Both Make and n8n pick it up.
- **Failures:** every failed step lands in `pipeline_errors`, the lead gets `process_status = error` and `last_error`, and the `leads_needing_attention` view lists them. Rerun with `{"action":"pending","include_errors":true}`.
