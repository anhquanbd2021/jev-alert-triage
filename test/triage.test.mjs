import test from "node:test";
import assert from "node:assert/strict";
import { ALERTS, decide, route, triage, replayAll, POLICY } from "../app/triage.mjs";

test("same firing condition, different severity — context is the product", () => {
  const loadtest = triage(ALERTS.find((a) => a.id === "a-loadtest"));
  const payments = triage(ALERTS.find((a) => a.id === "a-payments"));
  const ltTop = Object.entries(loadtest.answers.severity).sort((a, b) => b[1] - a[1])[0][0];
  const payTop = Object.entries(payments.answers.severity).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(ltTop, "p3", "staging load test should downgrade");
  assert.equal(payTop, "p1", "prod payments burning SLO should escalate");
});

test("severity is a closed answer space summing to ~1", () => {
  for (const a of ALERTS) {
    const s = triage(a).answers.severity;
    assert.deepEqual(Object.keys(s).sort(), ["p1", "p2", "p3"]);
    assert.ok(Math.abs(s.p1 + s.p2 + s.p3 - 1) < 0.02);
  }
});

test("flapping known-workload alert does not page", () => {
  const r = triage(ALERTS.find((a) => a.id === "a-flake"));
  assert.notEqual(r.route.action, "page");
});

test("prod + fast burn + recent deploy pages the owning team", () => {
  const r = triage(ALERTS.find((a) => a.id === "a-payments"));
  assert.equal(r.route.action, "page");
  assert.equal(r.route.target, "payments");
});

test("novelty routes to humans — low confidence is the design", () => {
  const r = triage(ALERTS.find((a) => a.id === "a-weird"));
  assert.ok(r.answers.confidence < POLICY.pageConfidence || r.answers.pageable < POLICY.pagePageable);
  assert.equal(r.route.action === "page", false);
});

test("routing policy honors the article's thresholds", () => {
  assert.equal(route({ severity: { p1: 0.9, p2: 0.05, p3: 0.05 }, confidence: 0.9, pageable: 0.95, team: { payments: 1 } }).action, "page");
  assert.equal(route({ severity: { p1: 0.9, p2: 0.05, p3: 0.05 }, confidence: 0.7, pageable: 0.95, team: { payments: 1 } }).action, "channel");
  assert.equal(route({ severity: { p1: 0.9, p2: 0.05, p3: 0.05 }, confidence: 0.4, pageable: 0.95, team: { payments: 1 } }).action, "triage-queue");
});

test("decide() is deterministic", () => {
  const s = { namespace: "x-prod", tier: "prod", deployed_2h_ago: true, slo_burn_rate: "fast", same_alert_last_24h: 0 };
  assert.deepEqual(decide(s), decide(s));
});

test("replayAll covers every fixture", () => {
  assert.equal(replayAll().length, ALERTS.length);
});
