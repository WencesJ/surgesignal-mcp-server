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
];

function isNoiseSignal(signal: RawSignal): boolean {
  const text = (signal.evidence_snippet || "").toLowerCase();
  return NOISE_PATTERNS.some((p) => p.test(text));
}

function isTopicRelevant(signal: RawSignal, topic: string): boolean {
  const snippet = (signal.evidence_snippet || "").toLowerCase();
  const url = (signal.evidence_url || "").toLowerCase();

  // Reddit: must be from a whitelisted B2B subreddit
  if (signal.source === "reddit") {
    const subredditMatch = (signal.evidence_url || "").match(/reddit\.com\/r\/([^/]+)/i);
    if (subredditMatch) {
      const subreddit = subredditMatch[1].toLowerCase();
      if (!B2B_SUBREDDIT_WHITELIST.has(subreddit)) {
        return false;
      }
    }
  }

  // Topic keywords must appear in the evidence snippet or URL.
  // NOTE: We intentionally do NOT fall back to domain name matching here.
  // The domain name (e.g. "stripe") appears in almost every signal for that company,
  // which would cause all topics for the same domain to return identical results.
  const keywords = TOPIC_KEYWORDS[topic as CoveredTopic] ?? [];
  return keywords.some((kw) => snippet.includes(kw.toLowerCase()) || url.includes(kw.toLowerCase()));
}

export function filterRelevantSignals(signals: RawSignal[], topic: string): RawSignal[] {
  return signals.filter((s) => !isNoiseSignal(s) && isTopicRelevant(s, topic));
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

  const sorted = [...signals].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  let weightedSum = 0;
  let weightTotal = 0;

  for (const signal of sorted) {
    const rw = recencyWeight(signal.timestamp);
    weightedSum += signal.score * rw;
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

  // Filter to only topic-relevant, non-noise signals
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

  // Normalize weights across active sources only
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

  // Confidence cap: thin single-source data should never score high.
  // A company with 1 signal from 1 source is weak evidence — cap at 30.
  // Require at least 3 signals across 2+ sources to score above 40.
  let confidenceCap = SURGE_MAX;
  if (relevantSignals.length === 1) {
    confidenceCap = 30;
  } else if (relevantSignals.length === 2 && activeSources === 1) {
    confidenceCap = 35;
  } else if (relevantSignals.length <= 3 && activeSources === 1) {
    confidenceCap = 40;
  }

  const finalScore = Math.min(
    confidenceCap,
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