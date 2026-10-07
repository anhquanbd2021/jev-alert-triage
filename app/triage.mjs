// triage.mjs — the article's triage pipeline, with a local deterministic
// stand-in for the /v1/systemone model call.
//
//   alert -> enrich -> decide -> route
//
// decide() mimics the System One contract: closed answer spaces (choice),
// calibrated-looking probabilities (noul), all questions answered in one
// pass. The weights are hand-tuned for the article's scenarios — the point is
// the architecture, not the model quality.

// --- sample alerts: the same firing condition, different runtime context ---
export const ALERTS = [
  {
    id: "a-loadtest",
    name: "HighCPU",
    staticSeverity: "critical", // what the YAML said last year
    raw: "cpu > 90% for 10m",
    context: { namespace: "loadtest-staging", tier: "staging", deployed_2h_ago: false, slo_burn_rate: "none", same_alert_last_24h: 0, runbook: true },
  },
  {
    id: "a-payments",
    name: "HighCPU",
    staticSeverity: "critical",
    raw: "cpu > 90% for 10m",
    context: { namespace: "payments-prod", tier: "prod", deployed_2h_ago: true, slo_burn_rate: "fast", same_alert_last_24h: 0, runbook: false },
  },
  {
    id: "a-flake",
    name: "HighCPU",
    staticSeverity: "critical",
    raw: "cpu > 90% for 10m",
    context: { namespace: "batch-jobs", tier: "prod", deployed_2h_ago: false, slo_burn_rate: "none", same_alert_last_24h: 9, runbook: true },
  },
  {
    id: "a-weird",
    name: "UnknownLatencySpike",
    staticSeverity: "warning",
    raw: "p99 latency +400% on undocumented endpoint",
    context: { namespace: "checkout-prod", tier: "prod", deployed_2h_ago: false, slo_burn_rate: "slow", same_alert_last_24h: 0, runbook: false },
  },
];

// --- decide(): the model stand-in ------------------------------------------
// Returns { severity: {p1,p2,p3}, confidence, pageable, team, deploy_related }.

export function decide(state) {
  const prod = state.tier === "prod" || /-prod$/.test(state.namespace || "");
  const burning = state.slo_burn_rate === "fast";
  const novel = (state.same_alert_last_24h ?? 0) === 0;
  const knownWorkload = !!state.runbook || /loadtest|staging|batch/.test(state.namespace || "");

  // severity distribution — logistic scoring keeps the top answer decisive
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  const s1 = -2.0 + (prod ? 1.2 : 0) + (burning ? 2.2 : 0) + (novel ? 0.6 : 0)
    + (!novel && !burning ? -0.8 : 0) + (knownWorkload && !prod ? -1.5 : 0);
  const p1 = sigmoid(s1);
  const s3 = 1.0 + (!prod ? 1.0 : 0) + (knownWorkload ? 1.2 : 0) + (novel ? -0.5 : 0) + (burning ? -1.5 : 0);
  const p3 = sigmoid(s3) * (1 - p1);
  const p2 = 1 - p1 - p3;

  const severity = { p1: +p1.toFixed(2), p2: +p2.toFixed(2), p3: +p3.toFixed(2) };
  const confidence = +Math.max(p1, p2, p3).toFixed(2);
  const pageable = +Math.min(0.97, Math.max(0.02,
    0.15 + (prod ? 0.25 : -0.1) + (burning ? 0.45 : 0) + (novel ? 0.05 : -0.15) + (knownWorkload ? -0.25 : 0.05) + (p1 > 0.8 ? 0.05 : 0),
  )).toFixed(2);

  let team = { payments: 0.2, platform: 0.3, product: 0.5 };
  if (/payments|checkout|billing/.test(state.namespace || "")) team = { payments: 0.82, platform: 0.1, product: 0.08 };
  else if (/ingress|cluster|infra|loadtest|batch/.test(state.namespace || "")) team = { payments: 0.05, platform: 0.85, product: 0.1 };

  const deploy_related = state.deployed_2h_ago ? 0.88 : 0.06;

  return { severity, confidence, pageable, team, deploy_related };
}

// --- route(): plain-code policy over the model's answers -------------------
// Thresholds live here, in reviewed code — not in a prompt.

export const POLICY = { pageConfidence: 0.85, pagePageable: 0.9, channelConfidence: 0.6 };

export function route(answers) {
  const topSeverity = Object.entries(answers.severity).sort((a, b) => b[1] - a[1])[0][0];
  if (answers.confidence >= POLICY.pageConfidence && answers.pageable >= POLICY.pagePageable) {
    return { action: "page", target: topTeam(answers.team), severity: topSeverity };
  }
  if (answers.confidence >= POLICY.channelConfidence) {
    return { action: "channel", target: topTeam(answers.team), severity: topSeverity };
  }
  return { action: "triage-queue", target: "duty-engineer", severity: topSeverity };
}

function topTeam(team) {
  return Object.entries(team).sort((a, b) => b[1] - a[1])[0][0];
}

// --- the pipeline -----------------------------------------------------------

export function triage(alert) {
  const state = {
    alert: `${alert.name} on ${alert.context.namespace}, ${alert.raw}`,
    namespace: alert.context.namespace,
    deployed_2h_ago: alert.context.deployed_2h_ago,
    slo_burn_rate: alert.context.slo_burn_rate,
    same_alert_last_24h: alert.context.same_alert_last_24h,
    tier: alert.context.tier,
    runbook: alert.context.runbook,
  };
  const answers = decide(state);
  return { alert, state, answers, route: route(answers), staticSeverity: alert.staticSeverity };
}

export function replayAll() {
  return ALERTS.map(triage);
}
