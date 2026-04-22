import { computeSurgeScore } from "../services/scoring-engine.js";
import { resolveCompany, getOrCreateCompany } from "../services/company-resolver.js";
import { getAllSignals, getLastIngestTime } from "../services/signal-store.js";
import { FORTUNE500_BLOCKLIST } from "../constants.js";
import type { ScanTopicInput, SurgeScore } from "../schemas/surge.js";

const NON_SAAS_TLDS = new Set([".edu", ".gov", ".mil", ".ac"]);
const NON_SAAS_KEYWORDS = ["university", "college", "hospital", "health", "medical", "bank", "insurance", "financial", "church", "school"];

function isSaaSDomain(domain: string): boolean {
  if (FORTUNE500_BLOCKLIST.has(domain)) return false;
  if (NON_SAAS_TLDS.has("." + domain.split(".").pop())) return false;
  if (NON_SAAS_KEYWORDS.some((kw) => domain.includes(kw))) return false;
  return true;
}

export async function handleScanTopic(params: Partial<ScanTopicInput>) {
  const topic = params.topic || "crm";
  const minScore = params.min_score ?? 0;
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  const allSignals = await getAllSignals();
  const topicSignals = allSignals.filter(
    (s) => s.topic === topic && isSaaSDomain(s.domain)
  );
  const cachedAt = getLastIngestTime();

  const domainSet = new Set<string>();
  for (const s of topicSignals) {
    domainSet.add(s.domain);
  }

  const scored: SurgeScore[] = [];

  for (const domain of domainSet) {
    const company = resolveCompany(domain) || getOrCreateCompany(domain);
    const signals = topicSignals.filter((s) => s.domain === domain);

    const score = computeSurgeScore(
      company.canonical_domain,
      topic,
      company.display_name,
      signals,
      cachedAt,
    );

    if (score.surge_score >= minScore && score.total_signals > 0) {
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