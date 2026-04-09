import { computeSurgeScore } from "../services/scoring-engine.js";
import { resolveCompany, getOrCreateCompany, normalizeDomain } from "../services/company-resolver.js";
import { getSignalsForDomainTopic, getLastIngestTime } from "../services/signal-store.js";
import type { LookupSurgeInput } from "../schemas/surge.js";

export async function handleLookupSurge(params: Partial<LookupSurgeInput>) {
  const domain = normalizeDomain(params.domain || "salesforce.com");
  const topic = params.topic || "crm";

  const company = resolveCompany(domain) || getOrCreateCompany(domain);
  const signals = await getSignalsForDomainTopic(company.canonical_domain, topic);
  const cachedAt = getLastIngestTime();

  return computeSurgeScore(
    company.canonical_domain,
    topic,
    company.display_name,
    signals,
    cachedAt,
  );
}