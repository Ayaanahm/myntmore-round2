# Bonus: enrichment on 3 real companies

The sample leads are fictional, so here is what the `enrichment` column would hold for three real companies that look like Myntmore's best-fit leads (B2B, funded, founder-led, selling to businesses). Data was pulled from public funding coverage on 29 Oct 2026.

| Company | What they sell | Size | Funding | Why it matters for scoring |
|---|---|---|---|---|
| **Spyne** (Gurugram) | AI car photos and retail tools for auto dealers | ~180 people, growing to 220-230 with a US team | $16M Series A (Feb 2025, Vertex Ventures, with Accel, Storm Ventures, Alteria). About 1,200 dealer customers | Fresh round and a US push: a strong case for outbound to US dealer groups → +1 to the rule score, service = lead_generation |
| **Zluri** (Santa Clara, built in Bengaluru) | SaaS management and access governance for IT teams | ~150 people at Series B | $20M Series B (Jul 2023, Lightspeed) | Sells to CIOs and IT heads in mid-market, which fits LinkedIn outreach plus founder branding |
| **Leucine** (New York, team in India) | Compliance cloud for pharma manufacturing | Not public | $7M Series A (Oct 2023, Ecolab, with Pravega, Axilor, Techstars). 30+ customers, 300+ plants, 10 countries | Niche, high-value buyers (plant and quality heads) → account-based outreach and cold email |

**Stored as**

```json
{
  "company_size": "~180",
  "funding_stage": "Series A",
  "last_round_usd": 16000000,
  "last_round_date": "2025-02",
  "investors": ["Vertex Ventures", "Accel"],
  "linkedin_activity": "not fetched",
  "source_urls": ["https://inc42.com/buzz/spyne-bags-16-mn-to-build-genai-suite-for-automotive-dealers"],
  "enriched_at": "2026-10-29"
}
```

**How it plugs into the engine.** Enrichment is one more step after `prepare`: a lookup by `account_domain` (Apollo or Clearbit free tier for size, Crunchbase or news search for funding). Its results feed one extra rule: **R6 growth signal, +1 if funded in the last 18 months or more than 50 staff.** For LinkedIn activity, I'd use a compliant data provider rather than scraping LinkedIn, since scraping breaks LinkedIn's terms. That's why the field reads "not fetched" here.

Sources: [Inc42 on Spyne](https://inc42.com/buzz/spyne-bags-16-mn-to-build-genai-suite-for-automotive-dealers), [Built In on Zluri](https://builtin.com/articles/zluri-raises-20m-series-b-hiring), [TechCrunch on Leucine](https://techcrunch.com/2023/10/16/leucine/)
