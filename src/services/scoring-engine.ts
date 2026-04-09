import {
  SOURCE_WEIGHTS,
  SIGNAL_SOURCES,
  RECENCY_DECAY_HOURS,
  SURGE_THRESHOLD,
  SURGE_MAX,
  type SignalSource,
} from "../constants.js";
import type { RawSignal, SignalBreakdown, SurgeScore } from "../schemas/surge.js";

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
  const volumeMultiplier = Math.min(1.3, 1 + Math.log2(signals.length) * 0.1);

  return {
    rawScore: Math.min(1, rawScore * volumeMultiplier),
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

  const bySource = new Map<SignalSource, RawSignal[]>();
  for (const src of SIGNAL_SOURCES) {
    bySource.set(src, []);
  }
  for (const signal of allSignals) {
    const arr = bySource.get(signal.source as SignalSource);
    if (arr) arr.push(signal);
  }

  const breakdown: SignalBreakdown[] = [];
  let compositeScore = 0;

  for (const source of SIGNAL_SOURCES) {
    const signals = bySource.get(source) ?? [];
    const { rawScore, signalCount, freshestSignal, topEvidence } = aggregateSourceSignals(signals);
    const weight = SOURCE_WEIGHTS[source];
    const weightedScore = rawScore * weight * SURGE_MAX;

    compositeScore += weightedScore;

    breakdown.push({
      source,
      raw_score: Math.round(rawScore * 1000) / 1000,
      weight,
      weighted_score: Math.round(weightedScore * 10) / 10,
      signal_count: signalCount,
      freshest_signal: freshestSignal,
      top_evidence: topEvidence,
    });
  }

  const finalScore = Math.min(SURGE_MAX, Math.round(compositeScore));
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
    signal_breakdown: breakdown,
    total_signals: allSignals.length,
    scored_at: now,
  };
}

export function explainScoringFormula(breakdown: SignalBreakdown[]): string {
  const parts = breakdown
    .filter((b) => b.signal_count > 0)
    .map(
      (b) =>
        `${b.source}(${b.signal_count} signals × ${b.raw_score} relevance × ${b.weight} weight = ${b.weighted_score})`
    );

  if (parts.length === 0) {
    return "No signals detected. Composite score = 0.";
  }

  return `Composite = ${parts.join(" + ")}. Scores ≥ 60 indicate active buying intent.`;
}