import type { RawSignal } from "../../schemas/surge.js";
import { getOrCreateCompany, deriveLinkedInSlug } from "../company-resolver.js";
import { fetchWithProxy, isProxyConfigured } from "../proxy.js";
import type { CoveredTopic } from "../../constants.js";

const COMPANY_PAGES: Record<string, { domain: string; slug: string; topics: CoveredTopic[] }> = {
  "hubspot": { domain: "hubspot.com", slug: "hubspotinc", topics: ["crm", "marketing-automation", "sales-engagement"] },
  "stripe": { domain: "stripe.com", slug: "stripe-inc", topics: ["payment-processing", "ecommerce-platform", "billing"] },
  "datadog": { domain: "datadog.com", slug: "datadog", topics: ["monitoring", "cloud-infrastructure"] },
  "zendesk": { domain: "zendesk.com", slug: "zendesk", topics: ["help-desk", "customer-success", "live-chat"] },
  "intercom": { domain: "intercom.com", slug: "intercom-software", topics: ["live-chat", "customer-success", "help-desk"] },
  "grafana": { domain: "grafana.com", slug: "grafana-labs", topics: ["monitoring", "business-intelligence"] },
  "mongodb": { domain: "mongodb.com", slug: "mongodbinc", topics: ["data-warehouse", "cloud-infrastructure"] },
  "elastic": { domain: "elastic.co", slug: "elastic-co", topics: ["monitoring", "security-operations", "siem"] },
  "mixpanel": { domain: "mixpanel.com", slug: "mixpanel", topics: ["product-analytics", "ab-testing"] },
  "slack": { domain: "slack.com", slug: "slack", topics: ["collaboration", "video-conferencing"] },
  "snowflake": { domain: "snowflake.com", slug: "snowflakecorp", topics: ["data-warehouse", "data-integration", "business-intelligence"] },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractPostTexts(html: string): string[] {
  const texts: string[] = [];

  const patterns = [
    /class="[^"]*break-words[^"]*"[^>]*>([\s\S]*?)<\/span>/g,
    /class="[^"]*feed-shared-text[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
    /class="[^"]*update-components-text[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
    /<p[^>]*>([\s\S]*?)<\/p>/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const text = match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (text.length > 50 && text.length < 2000 && !texts.includes(text)) {
        texts.push(text);
      }
    }
  }

  return texts.slice(0, 15);
}

function scoreRelevance(text: string): number {
  const lower = text.toLowerCase();

  const strongSignals = [
    "evaluating", "comparing", "switching to", "implementing",
    "migrating", "replaced", "chose", "selected", "vendor",
    "rfp", "proof of concept", "poc", "pilot", "demo",
    "new feature", "integration", "partnership", "customer",
  ];

  const weakSignals = [
    "announced", "launched", "released", "hired", "joined",
    "excited", "proud", "thrilled",
  ];

  let score = 0.3;

  for (const signal of strongSignals) {
    if (lower.includes(signal)) score += 0.1;
  }

  for (const signal of weakSignals) {
    if (lower.includes(signal)) score += 0.05;
  }

  return Math.min(1, score);
}

async function fetchCompanyPosts(slug: string): Promise<string[]> {
  const url = `https://www.linkedin.com/company/${slug}/posts/`;

  const res = await fetchWithProxy(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
  });

  if (!res.ok) {
    throw new Error(`Status ${res.status}`);
  }

  const html = await res.text();
  return extractPostTexts(html);
}

export async function searchLinkedInForCompany(companyName: string, domain: string, topics: CoveredTopic[]): Promise<RawSignal[]> {
  if (!isProxyConfigured()) return [];

  const signals: RawSignal[] = [];
  const company = getOrCreateCompany(domain);

  const knownSlug = company.linkedin_slug || deriveLinkedInSlug(domain);

  try {
    const postTexts = await fetchCompanyPosts(knownSlug);

    for (const text of postTexts) {
      const relevance = scoreRelevance(text);

      for (const topic of topics) {
        signals.push({
          source: "linkedin",
          domain: company.canonical_domain,
          topic,
          score: relevance,
          timestamp: new Date().toISOString(),
          evidence_url: `https://www.linkedin.com/company/${knownSlug}/posts/`,
          evidence_snippet: text.slice(0, 500),
        });
      }
    }
  } catch (err) {
    console.error(`[dynamic] LinkedIn for "${companyName}" (slug: ${knownSlug}): ${(err as Error).message}`);
  }

  return signals;
}

export async function ingestLinkedInDirect(): Promise<RawSignal[]> {
  if (!isProxyConfigured()) {
    console.error("Proxy not configured, skipping LinkedIn direct ingestion");
    return [];
  }

  const signals: RawSignal[] = [];
  const companies = Object.keys(COMPANY_PAGES);

  for (const companyName of companies) {
    const config = COMPANY_PAGES[companyName];
    if (!config) continue;

    try {
      const postTexts = await fetchCompanyPosts(config.slug);
      const company = getOrCreateCompany(config.domain);

      for (const text of postTexts) {
        const relevance = scoreRelevance(text);

        for (const topic of config.topics) {
          signals.push({
            source: "linkedin",
            domain: company.canonical_domain,
            topic,
            score: relevance,
            timestamp: new Date().toISOString(),
            evidence_url: `https://www.linkedin.com/company/${config.slug}/posts/`,
            evidence_snippet: text.slice(0, 500),
          });
        }
      }
    } catch (err) {
      console.error(`Failed LinkedIn company "${companyName}":`, (err as Error).message);
    }

    await delay(3000);
  }

  return signals;
}