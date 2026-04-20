import { computeSurgeScore, explainScoringFormula, filterRelevantSignals } from "../services/scoring-engine.js";
import { resolveCompany, getOrCreateCompany, normalizeDomain } from "../services/company-resolver.js";
import { getSignalsForDomainTopic, getLastIngestTime } from "../services/signal-store.js";
import { SIGNAL_SOURCES } from "../constants.js";
import type { ExplainSignalsInput } from "../schemas/surge.js";

export async function handleExplainSignals(params: Partial<ExplainSignalsInput>) {
  const domain = normalizeDomain(params.domain || "salesforce.com");
  const topic = params.topic || "crm";

  const company = resolveCompany(domain) || getOrCreateCompany(domain);
  const rawSignals = await getSignalsForDomainTopic(company.canonical_domain, topic);
  const cachedAt = getLastIngestTime();

  const signals = filterRelevantSignals(rawSignals, topic);

  const score = computeSurgeScore(
    company.canonical_domain,
    topic,
    company.display_name,
    rawSignals,
    cachedAt,
  );

  const sortedSignals = [...signals].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const countBySource: Record<string, number> = {};
  for (const source of SIGNAL_SOURCES) {
    countBySource[source] = signals.filter((s) => s.source === source).length;
  }

  return {
    domain: company.canonical_domain,
    company_name: company.display_name,
    topic,
    surge_score: score.surge_score,
    is_surging: score.is_surging,
    signals: sortedSignals,
    signal_count_by_source: countBySource,
    scoring_formula: explainScoringFormula(score.signal_breakdown),
  };
}