import {
  SOURCE_WEIGHTS,
  SIGNAL_SOURCES,
  RECENCY_DECAY_HOURS,
  SURGE_THRESHOLD,
  SURGE_MAX,
  TOPIC_KEYWORDS,
  B2B_SUBREDDIT_WHITELIST,
  type SignalSource,
  type CoveredTopic,
} from "../constants.js";
import type { RawSignal, SignalBreakdown, SurgeScore } from "../schemas/surge.js";

const NOISE_PATTERNS = [
  /sign in with/i,
  /privacy policy/i,
  /cookie policy/i,
  /user agreement/i,
  /by clicking continue/i,
  /accept.*cookies/i,
  /passkey/i,
  /looking for a silvestratus/i,
  /navigator of the sea/i,
  /working class keep the government/i,
  /r\u00f6stet mein depot/i,
  /kako u/i,
  /buy verified/i,
  /verified accounts/i,
  /aged accounts/i,
  /click on the link to sign in/i,
  /check your spam folder/i,
  /if you don't see the email in your inbox/i,
  /join now to see who you already know/i,
  /be seen by recruiters/i,
  /sign in to linkedin/i,
  /join linkedin/i,
  /create your free account/i,
  /linkedin corporation/i,
];

function isNoiseSignal(signal: RawSignal): boolean {
  const text = (signal.evidence_snippet || "").toLowerCase();
  return NOISE_PATTERNS.some((p) => p.test(text));
}

export function filterRelevantSignals(signals: RawSignal[], topic: string): RawSignal[] {
  return signals.filter((s) => !isNoiseSignal(s) && isTopicRelevant(s, topic));
}

function isTopicRelevant(signal: RawSignal, topic: string): boolean {
  const snippet = (signal.evidence_snippet || "").toLowerCase();

  // G2, LinkedIn, and Jobs signals are explicitly tagged with domain and topic
  // at ingestion time by structured ingestors — trust their classification.
  // Only Reddit and HackerNews need keyword verification since they scrape
  // broad feeds and tag signals opportunistically.
  if (signal.source === "g2" || signal.source === "jobs" || signal.source === "github") {
    return true;
  }

  if (signal.source === "reddit") {
    const subredditMatch = (signal.evidence_url || "").match(/reddit\.com\/r\/([^/]+)/i);
    if (subredditMatch) {
      const subreddit = subredditMatch[1].toLowerCase();
      if (!B2B_SUBREDDIT_WHITELIST.has(subreddit)) {
        return false;
      }
    }
  }

  const keywords = TOPIC_KEYWORDS[topic as CoveredTopic] ?? [];
  return keywords.some((kw) => snippet.includes(kw.toLowerCase()));
}

function recencyWeight(signalTimestamp: string): number {
  const ageMs = Date.now() - new Date(signalTimestamp).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours <= 0) return 1;
  if (ageHours >= RECENCY_DECAY_HOURS) return 0.05;
  const halfLife = 48;
  return Math.exp((-Math.LN2 * ageHours) / halfLife);
}

function aggregateSourceSignals(signals: RawSignal[]): {
  rawScore: number;
  signalCount: number;
  freshestSignal: string | undefined;
  topEvidence: string | undefined;
} {
  if (signals.length === 0) {
    return { rawScore: 0, signalCount: 0, freshestSignal: undefined, topEvidence: undefined };
  }

  const cleanSignals = signals.filter((s) => !isNoiseSignal(s));
  const scoringSignals = cleanSignals.length > 0 ? cleanSignals : signals;

  const sorted = [...scoringSignals].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  let weightedSum = 0;
  let weightTotal = 0;

  for (const signal of sorted) {
    const rw = recencyWeight(signal.timestamp);
    const signalScore = isNoiseSignal(signal) ? signal.score * 0.1 : signal.score;
    weightedSum += signalScore * rw;
    weightTotal += rw;
  }

  const rawScore = weightTotal > 0 ? weightedSum / weightTotal : 0;

  const volumeBonus =
    signals.length >= 15 ? 0.25
    : signals.length >= 10 ? 0.18
    : signals.length >= 5 ? 0.10
    : signals.length >= 2 ? 0.05
    : 0;

  return {
    rawScore: Math.min(1, rawScore + volumeBonus),
    signalCount: signals.length,
    freshestSignal: sorted[0]?.timestamp,
    topEvidence: sorted[0]?.evidence_snippet,
  };
}

export function computeSurgeScore(
  domain: string,
  topic: string,
  companyName: string | undefined,
  allSignals: RawSignal[],
  cachedAtMs?: number,
): SurgeScore {
  const now = new Date().toISOString();

  const relevantSignals = allSignals.filter(
    (s) => !isNoiseSignal(s) && isTopicRelevant(s, topic)
  );

  const bySource = new Map<SignalSource, RawSignal[]>();
  for (const src of SIGNAL_SOURCES) {
    bySource.set(src, []);
  }
  for (const signal of relevantSignals) {
    const arr = bySource.get(signal.source as SignalSource);
    if (arr) arr.push(signal);
  }

  const breakdown: SignalBreakdown[] = [];
  const activeSourceWeights: {
    source: SignalSource;
    rawScore: number;
    signalCount: number;
    weight: number;
    freshestSignal?: string;
    topEvidence?: string;
  }[] = [];

  for (const source of SIGNAL_SOURCES) {
    const signals = bySource.get(source) ?? [];
    const { rawScore, signalCount, freshestSignal, topEvidence } = aggregateSourceSignals(signals);

    if (signalCount > 0) {
      activeSourceWeights.push({
        source,
        rawScore,
        signalCount,
        weight: SOURCE_WEIGHTS[source],
        freshestSignal,
        topEvidence,
      });
    }

    breakdown.push({
      source,
      raw_score: Math.round(rawScore * 1000) / 1000,
      weight: SOURCE_WEIGHTS[source],
      weighted_score: 0,
      signal_count: signalCount,
      freshest_signal: freshestSignal,
      top_evidence: topEvidence,
    });
  }

  const totalActiveWeight = activeSourceWeights.reduce((sum, s) => sum + s.weight, 0);
  const weightNormalizer = totalActiveWeight > 0 ? 1 / totalActiveWeight : 1;

  let compositeScore = 0;
  const activeSources = activeSourceWeights.length;

  for (const active of activeSourceWeights) {
    const normalizedWeight = active.weight * weightNormalizer;
    const weightedScore = active.rawScore * normalizedWeight * SURGE_MAX;
    compositeScore += weightedScore;

    const entry = breakdown.find((b) => b.source === active.source);
    if (entry) {
      entry.weight = Math.round(normalizedWeight * 1000) / 1000;
      entry.weighted_score = Math.round(weightedScore * 10) / 10;
    }
  }

  const diversityBonus =
    activeSources >= 5 ? 12
    : activeSources >= 4 ? 8
    : activeSources >= 3 ? 4
    : activeSources >= 2 ? 2
    : 0;

  const totalSignalBonus =
    relevantSignals.length >= 50 ? 8
    : relevantSignals.length >= 30 ? 5
    : relevantSignals.length >= 20 ? 3
    : relevantSignals.length >= 10 ? 1
    : 0;

  const finalScore = Math.min(
    SURGE_MAX,
    Math.round(compositeScore + diversityBonus + totalSignalBonus)
  );

  const dataAgeMs = cachedAtMs ? Date.now() - cachedAtMs : 0;
  const freshnessSecs = Math.round(dataAgeMs / 1000);

  return {
    domain,
    company_name: companyName,
    topic: topic as SurgeScore["topic"],
    surge_score: finalScore,
    is_surging: finalScore >= SURGE_THRESHOLD,
    data_freshness: freshnessSecs < 7200 ? "fresh" : "stale",
    freshness_secs: freshnessSecs,
    signal_breakdown: breakdown.filter((b) => b.signal_count > 0),
    total_signals: relevantSignals.length,
    scored_at: now,
  };
}

export function explainScoringFormula(breakdown: SignalBreakdown[]): string {
  const parts = breakdown
    .filter((b) => b.signal_count > 0)
    .map(
      (b) =>
        `${b.source}(${b.signal_count} signals × ${b.raw_score} relevance × ${b.weight} effective_weight = ${b.weighted_score})`
    );

  if (parts.length === 0) {
    return "No topic-relevant signals detected. Composite score = 0.";
  }

  return `Composite = ${parts.join(" + ")} + source diversity bonus + volume bonus. Weights normalized to active sources only. Scores ≥ 60 indicate active buying intent.`;
}