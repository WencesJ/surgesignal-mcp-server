import type { RawSignal } from "../../schemas/surge.js";
import { getOrCreateCompany, normalizeDomain } from "../company-resolver.js";
import type { CoveredTopic } from "../../constants.js";

const BASE_URL = "https://hn.algolia.com/api/v1/search";

const COMPANY_SEARCHES: Record<string, { domain: string; topics: CoveredTopic[] }> = {
  "salesforce crm": { domain: "salesforce.com", topics: ["crm", "sales-engagement", "marketing-automation"] },
  "hubspot marketing": { domain: "hubspot.com", topics: ["crm", "marketing-automation", "sales-engagement"] },
  "stripe payment": { domain: "stripe.com", topics: ["payment-processing", "ecommerce-platform", "billing"] },
  "datadog monitoring": { domain: "datadog.com", topics: ["monitoring", "cloud-infrastructure"] },
  "snowflake data warehouse": { domain: "snowflake.com", topics: ["data-warehouse", "data-integration", "business-intelligence"] },
  "zendesk support": { domain: "zendesk.com", topics: ["help-desk", "customer-success", "live-chat"] },
  "twilio api": { domain: "twilio.com", topics: ["sms-platform", "voip", "api-management"] },
  "intercom chat": { domain: "intercom.com", topics: ["live-chat", "customer-success", "help-desk"] },
  "notion workspace": { domain: "notion.so", topics: ["project-management", "collaboration", "document-management"] },
  "figma design": { domain: "figma.com", topics: ["design-tools", "collaboration"] },
  "grafana observability": { domain: "grafana.com", topics: ["monitoring", "business-intelligence"] },
  "mongodb database": { domain: "mongodb.com", topics: ["data-warehouse", "cloud-infrastructure"] },
  "elastic search": { domain: "elastic.co", topics: ["monitoring", "security-operations", "siem"] },
  "vercel deployment": { domain: "vercel.com", topics: ["cloud-infrastructure", "ci-cd", "cms"] },
  "supabase backend": { domain: "supabase.com", topics: ["cloud-infrastructure", "data-warehouse"] },
  "amplitude analytics": { domain: "amplitude.com", topics: ["product-analytics", "ab-testing"] },
  "mixpanel analytics": { domain: "mixpanel.com", topics: ["product-analytics", "ab-testing"] },
  "linear project": { domain: "linear.app", topics: ["project-management", "collaboration"] },
  "segment data": { domain: "segment.com", topics: ["data-integration", "product-analytics"] },
  "slack collaboration": { domain: "slack.com", topics: ["collaboration", "video-conferencing"] },
};

const GENERIC_SEARCHES: Record<string, CoveredTopic[]> = {
  "evaluating CRM": ["crm", "sales-engagement"],
  "switching monitoring tool": ["monitoring", "cloud-infrastructure"],
  "data warehouse migration": ["data-warehouse", "data-integration"],
  "marketing automation platform": ["marketing-automation", "abm"],
  "help desk software": ["help-desk", "customer-success"],
  "payment processing api": ["payment-processing", "ecommerce-platform"],
  "project management tool": ["project-management", "collaboration"],
  "CI CD pipeline": ["ci-cd", "container-orchestration"],
  "security operations platform": ["security-operations", "siem"],
  "workflow automation": ["workflow-automation", "integration-platform"],
};

const DOMAIN_PATTERN = /\b([a-z0-9-]+\.(com|io|co|ai|dev|app|so|org|net))\b/gi;

const BLOCKED_DOMAINS = new Set([
  "github.com", "google.com", "youtube.com", "imgur.com",
  "medium.com", "twitter.com", "x.com", "linkedin.com",
  "facebook.com", "reddit.com", "amazonaws.com",
  "cloudflare.com", "wikipedia.org", "stackoverflow.com",
  "npmjs.com", "pypi.org", "apple.com", "microsoft.com",
  "amazon.com", "ycombinator.com", "news.ycombinator.com",
  "algolia.com", "archive.org", "nytimes.com", "wsj.com",
]);

function extractDomains(text: string): string[] {
  const matches = text.match(DOMAIN_PATTERN) || [];
  const domains = new Set<string>();
  for (const match of matches) {
    const normalized = normalizeDomain(match);
    if (normalized.includes(".") && !BLOCKED_DOMAINS.has(normalized)) {
      domains.add(normalized);
    }
  }
  return Array.from(domains);
}

function scoreRelevance(title: string, points: number, comments: number): number {
  const lower = title.toLowerCase();

  const strongSignals = [
    "switching to", "migrating from", "replacing", "alternative to",
    "vs ", "compared to", "evaluation", "looking for", "recommend",
    "anyone using", "experience with", "review of", "moved from",
    "pricing", "cost of", "implemented", "why we chose",
  ];

  const weakSignals = [
    "show hn", "launch", "released", "announced", "new feature",
  ];

  let score = 0.3;

  for (const signal of strongSignals) {
    if (lower.includes(signal)) score += 0.15;
  }

  for (const signal of weakSignals) {
    if (lower.includes(signal)) score += 0.05;
  }

  if (points > 100) score += 0.1;
  if (comments > 50) score += 0.1;

  return Math.min(1, score);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface HNHit {
  title: string;
  url: string | null;
  objectID: string;
  points: number;
  num_comments: number;
  created_at: string;
  author: string;
}

interface HNResponse {
  hits: HNHit[];
  nbHits: number;
}

async function searchHN(query: string, limit: number = 10): Promise<HNHit[]> {
  const params = new URLSearchParams({
    query,
    tags: "story",
    hitsPerPage: String(limit),
    numericFilters: "created_at_i>" + String(Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60),
  });

  const res = await fetch(`${BASE_URL}?${params}`, {
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Status ${res.status}`);
  }

  const data = await res.json() as HNResponse;
  return data.hits || [];
}

async function ingestTargetedCompanies(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const searches = Object.keys(COMPANY_SEARCHES);

  for (const query of searches) {
    const config = COMPANY_SEARCHES[query];
    if (!config) continue;

    try {
      const hits = await searchHN(query, 10);
      const company = getOrCreateCompany(config.domain);

      for (const hit of hits) {
        const relevance = scoreRelevance(hit.title, hit.points, hit.num_comments);

        for (const topic of config.topics) {
          signals.push({
            source: "hackernews",
            domain: company.canonical_domain,
            topic,
            score: relevance,
            timestamp: hit.created_at || new Date().toISOString(),
            evidence_url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
            evidence_snippet: `${hit.title} (${hit.points} points, ${hit.num_comments} comments)`,
          });
        }
      }
    } catch (err) {
      console.error(`Failed HN search for "${query}":`, (err as Error).message);
    }

    await delay(1000);
  }

  return signals;
}

async function ingestGenericSearches(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const searches = Object.keys(GENERIC_SEARCHES);

  for (const query of searches) {
    const topics = GENERIC_SEARCHES[query];
    if (!topics) continue;

    try {
      const hits = await searchHN(query, 10);

      for (const hit of hits) {
        const text = `${hit.title} ${hit.url || ""}`;
        const domains = extractDomains(text);
        const relevance = scoreRelevance(hit.title, hit.points, hit.num_comments);

        for (const domain of domains) {
          const company = getOrCreateCompany(domain);

          for (const topic of topics) {
            signals.push({
              source: "hackernews",
              domain: company.canonical_domain,
              topic,
              score: relevance,
              timestamp: hit.created_at || new Date().toISOString(),
              evidence_url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
              evidence_snippet: `${hit.title} (${hit.points} points, ${hit.num_comments} comments)`,
            });
          }
        }
      }
    } catch (err) {
      console.error(`Failed HN generic search for "${query}":`, (err as Error).message);
    }

    await delay(1000);
  }

  return signals;
}

export async function ingestHackerNews(): Promise<RawSignal[]> {
  const targetedSignals = await ingestTargetedCompanies();
  const genericSignals = await ingestGenericSearches();

  return [...targetedSignals, ...genericSignals];
}