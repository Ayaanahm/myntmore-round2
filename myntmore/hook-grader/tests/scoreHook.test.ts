import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreHook } from "../lib/scoreHook";
import { checkRewrite } from "../lib/writingRules";

const strong = "I lost our biggest client in week 1.\nHere is what I changed the next morning.";
const weak = "I'm excited to share some thoughts on how we leverage synergy in today's world of B2B marketing #growth #sales";

test("same hook always gets the same score", () => {
  const scores = Array.from({ length: 50 }, () => scoreHook(strong).score);
  assert.equal(new Set(scores).size, 1);
});

test("whitespace and line ending noise does not change the score", () => {
  assert.equal(scoreHook(strong).score, scoreHook("  I lost our biggest client in week 1.  \r\n\r\nHere is what I changed the next morning. ").score);
});

test("strong hook scores 100", () => assert.equal(scoreHook(strong).score, 100));

test("weak hook fails with one line per failed rule", () => {
  const r = scoreHook(weak);
  assert.ok(r.score < 40, `got ${r.score}`);
  for (const f of r.results.filter((x) => !x.passed)) assert.ok(f.message.length > 0 && !f.message.includes("\n"));
});

test("score is always 0 to 100", () => {
  for (const h of ["", "a", strong, weak, "x".repeat(900)]) {
    const s = scoreHook(h).score;
    assert.ok(s >= 0 && s <= 100);
  }
});

test("rewrite checker catches dashes, jargon and invented numbers", () => {
  const v = checkRewrite("We 10x'd revenue — leverage this", strong);
  assert.ok(v.some((x) => x.includes("dash")));
  assert.ok(v.some((x) => x.includes("jargon")));
  assert.ok(v.some((x) => x.includes("invented numbers")));
  assert.deepEqual(checkRewrite("I lost our biggest client in week 1.\nThe fix took one morning.", strong), []);
});
