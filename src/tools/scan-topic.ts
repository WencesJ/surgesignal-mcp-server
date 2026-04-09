import { computeSurgeScore } from "../services/scoring-engine.js";
import { resolveCompany, getOrCreateCompany } from "../services/company-resolver.js";
import { getSignalsForDomainTopic, getUniqueDomainsByTopic, getLastIngestTime } from "../services/signal-store.js";
import type { ScanTopicInput, SurgeScore } from "../schemas/surge.js";

export async function handleScanTopic(params: Partial<ScanTopicInput>) {
  const topic = params.topic || "crm";
  const minScore = params.min_score ?? 0;
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  const domains = await getUniqueDomainsByTopic(topic);
  const cachedAt = getLastIngestTime();

  const scored: SurgeScore[] = [];

  for (const domain of domains) {
    const company = resolveCompany(domain) || getOrCreateCompany(domain);
    const signals = await getSignalsForDomainTopic(company.canonical_domain, topic);

    const score = computeSurgeScore(
      company.canonical_domain,
      topic,
      company.display_name,
      signals,
      cachedAt,
    );

    if (score.surge_score >= minScore) {
      scored.push(score);
    }
  }

  scored.sort((a, b) => b.surge_score - a.surge_score);

  const total = scored.length;
  const page = scored.slice(offset, offset + limit);

  return {
    topic,
    total,
    count: page.length,
    offset,
    has_more: offset + limit < total,
    companies: page,
  };
}