"use client";

import { useEffect, useState } from "react";
import Core from "./Core";

type RuleResult = { id: string; label: string; points: number; max: number; passed: boolean; message: string };
type Rewrite = { angle: string; hook: string; why: string };
type Result = { score: number; verdict: string; results: RuleResult[]; rewrites: Rewrite[]; rewritesUnavailable: boolean };
type Step = "landing" | "contact" | "hook" | "results";

export default function Page() {
  const [step, setStep] = useState<Step>("landing");
  const [contact, setContact] = useState({ name: "", designation: "", company: "", email: "", company_url: "" });
  const [hook, setHook] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const lines = hook.split("\n");
  const firstLen = (lines[0] ?? "").trim().length;

  function submitContact(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (contact.name.trim().length < 2) errs.name = "Please add your name";
    if (!contact.designation.trim()) errs.designation = "Please add your designation";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact.email.trim())) errs.email = "Please use a valid email";
    setErrors(errs);
    if (!Object.keys(errs).length) setStep("hook");
  }

  async function grade(e: React.FormEvent) {
    e.preventDefault();
    if (hook.trim().length < 10) return setErrors({ hook: "Paste the first two lines of your post" });
    setLoading(true);
    setErrors({});
    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...contact, hook }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors(data.errors ?? { form: data.error ?? "Something went wrong. Please try again." });
        if (data.errors && (data.errors.name || data.errors.email || data.errors.designation)) setStep("contact");
        return;
      }
      setResult(data);
      setStep("results");
    } catch {
      setErrors({ form: "Network error. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string, i: number) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(i);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <main className="wrap">
      <Core mode={step === "landing" ? "hero" : step === "results" ? "result" : "side"} score={result?.score} />
      <header className="top">
        <span className="mark">Myntmore</span>
        <span className="lbl">Free AI tool · 10 of 10</span>
      </header>

      {step === "landing" && (
        <section className="hero">
          <span className="cap"><b>NEW</b>The 10th free tool from Myntmore</span>
          <h1>Will they click<br /><em>&ldquo;see more&rdquo;?</em></h1>
          <p className="sub">
            Paste the first two lines of a LinkedIn post. Get a score out of 100 from six clear rules, a line on
            every rule you miss, and three rewrites you can use today.
          </p>
          <div className="ctas">
            <button className="btn" onClick={() => setStep("contact")}>Grade my hook</button>
          </div>
          <div className="strip">
            <div><strong>6 rules</strong><span>same score, every time</span></div>
            <div><strong>3 rewrites</strong><span>by Gemini</span></div>
            <div><strong>20 sec</strong><span>free, no sign up</span></div>
          </div>
        </section>
      )}

      {step === "contact" && (
        <form className="card" onSubmit={submitContact} noValidate>
          <div className="steps"><span className="on" /><span /></div>
          <span className="lbl">Step 1 of 2</span>
          <h2>Where should we <em>send ideas?</em></h2>
          <Field label="Name" error={errors.name}>
            <input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} autoComplete="name" />
          </Field>
          <Field label="Designation" error={errors.designation}>
            <input value={contact.designation} placeholder="Founder, Head of Sales..." onChange={(e) => setContact({ ...contact, designation: e.target.value })} autoComplete="organization-title" />
          </Field>
          <Field label="Company (optional)">
            <input value={contact.company} placeholder="Where you work" onChange={(e) => setContact({ ...contact, company: e.target.value })} autoComplete="organization" />
          </Field>
          <Field label="Work email" error={errors.email}>
            <input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" />
          </Field>
          {/* honeypot for bots */}
          <input className="hp" tabIndex={-1} autoComplete="off" value={contact.company_url} onChange={(e) => setContact({ ...contact, company_url: e.target.value })} aria-hidden="true" />
          <p className="hint" style={{ margin: "0 0 18px" }}>
            Your details and hook are saved to our CRM, and your hook is sent to Google Gemini to write rewrites. Please do not enter confidential information.
          </p>
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setStep("landing")}>Back</button>
            <button className="btn">Continue</button>
          </div>
        </form>
      )}

      {step === "hook" && (
        <form className="card" onSubmit={grade} noValidate>
          <div className="steps"><span className="on" /><span className="on" /></div>
          <span className="lbl">Step 2 of 2</span>
          <h2>Paste your <em>first two lines.</em></h2>
          <Field label="Your hook" error={errors.hook}>
            <textarea
              rows={4}
              value={hook}
              maxLength={1000}
              placeholder={"I lost our biggest client in week one.\nHere is what I changed the next morning."}
              onChange={(e) => setHook(e.target.value)}
            />
          </Field>
          <p className="hint">
            First line: <strong className={firstLen > 60 ? "warn" : ""}>{firstLen}</strong> / 60 characters ·
            Lines: <strong>{lines.filter((l) => l.trim()).length}</strong>
          </p>
          {errors.form && <p className="error">{errors.form}</p>}
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setStep("contact")} disabled={loading}>Back</button>
            <button className="btn" disabled={loading}>{loading ? <><span className="spinner" />Grading your hook</> : "Grade my hook"}</button>
          </div>
        </form>
      )}

      {step === "results" && result && (
        <section className="results">
          <div className="card scorecard">
            <ScoreRing score={result.score} />
            <div>
              <span className="lbl">Your hook score</span>
              <h2 style={{ margin: "8px 0 0" }}><em>{result.verdict}</em></h2>
              <p className="lead small">Scored by six fixed rules. Paste the same hook again and you will get the same number.</p>
            </div>
          </div>

          <div className="card">
            <span className="lbl">Six rules</span>
            <h3 style={{ marginTop: 10 }}>Rule by <em>rule.</em></h3>
            <ul className="rules">
              {result.results.map((r) => (
                <li key={r.id} className={r.passed ? "pass" : "fail"}>
                  <span className="mark-dot" aria-hidden>{r.passed ? "✓" : "✕"}</span>
                  <div>
                    <div className="rule-head">
                      <span>{r.label}</span>
                      <span className="pts">{r.points}/{r.max}</span>
                    </div>
                    <div className="meter"><i style={{ width: `${(r.points / r.max) * 100}%` }} /></div>
                    {!r.passed && <p className="msg">{r.message}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <span className="lbl">Gemini · structured output</span>
            <h3 style={{ marginTop: 10 }}>Three <em>rewrites.</em></h3>
            {result.rewritesUnavailable ? (
              <p className="msg">Rewrites are not available right now. Your score above is complete and saved.</p>
            ) : (
              <div className="rewrites">
                {result.rewrites.map((r, i) => (
                  <article key={i} className="rewrite">
                    <p className="angle">{r.angle}</p>
                    <p className="hooktext">{r.hook}</p>
                    <p className="why">{r.why}</p>
                    <button className="btn small ghost" onClick={() => copy(r.hook, i)}>{copied === i ? "Copied" : "Copy"}</button>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="card cta">
            <h3>Want hooks like this <em>every week?</em></h3>
            <p className="lead small">We help founders turn LinkedIn into a steady source of sales meetings.</p>
            <p className="lead small">Thanks for trying the grader. Our team may follow up with ideas for your LinkedIn.</p>
            <div className="row">
              <a className="btn" href="https://myntmore.com/founder-meeting" target="_blank" rel="noreferrer">Book a founder meeting</a>
              <button className="btn ghost" onClick={() => { setHook(""); setResult(null); setStep("hook"); }}>Grade another hook</button>
            </div>
          </div>
        </section>
      )}
      <p className="foot">A free tool by Myntmore. Your hook is scored by fixed rules; rewrites by Gemini.</p>
    </main>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown(score), 60);
    return () => clearTimeout(t);
  }, [score]);
  const tone = score >= 80 ? "good" : score >= 55 ? "ok" : "bad";
  return (
    <div className={`ring ${tone}`} role="img" aria-label={`Score ${score} out of 100`}>
      <svg viewBox="0 0 120 120">
        <circle className="track" cx="60" cy="60" r={r} fill="none" strokeWidth="10" />
        <circle className="bar" cx="60" cy="60" r={r} fill="none" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * shown) / 100} />
      </svg>
      <div className="num"><b>{score}</b><small>out of 100</small></div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <span className="error">{error}</span>}
    </label>
  );
}
