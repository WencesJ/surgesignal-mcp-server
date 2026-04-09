import type { RawSignal } from "../../schemas/surge.js";
import { getOrCreateCompany, normalizeDomain } from "../company-resolver.js";
import type { CoveredTopic } from "../../constants.js";

const API_TOKEN = process.env.APIFY_API_TOKEN || "";
const BASE_URL = "https://api.apify.com/v2";

const DOMAIN_PATTERN = /\b([a-z0-9-]+\.(com|io|co|ai|dev|app|so|org|net))\b/gi;

const BLOCKED_DOMAINS = new Set([
  "github.com", "google.com", "youtube.com", "linkedin.com",
  "facebook.com", "twitter.com", "x.com", "medium.com",
  "apple.com", "microsoft.com", "amazon.com", "apify.com",
  "g2.com", "capterra.com", "trustradius.com",
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LINKEDIN_KEYWORDS: Record<string, CoveredTopic[]> = {
  "evaluating CRM": ["crm", "sales-engagement"],
  "marketing automation platform": ["marketing-automation", "abm"],
  "data pipeline migration": ["data-integration", "etl", "data-warehouse"],
  "monitoring observability": ["monitoring", "cloud-infrastructure"],
  "customer success platform": ["customer-success", "help-desk"],
  "security operations center": ["security-operations", "siem"],
  "payment infrastructure": ["payment-processing", "ecommerce-platform"],
  "workflow automation tool": ["workflow-automation", "integration-platform"],
  "product analytics implementation": ["product-analytics", "ab-testing"],
  "HR technology stack": ["hr-software", "ats"],
};

const G2_CATEGORIES: Record<string, CoveredTopic[]> = {
  "crm": ["crm", "sales-engagement"],
  "marketing-automation": ["marketing-automation", "abm"],
  "data-integration": ["data-integration", "etl"],
  "business-intelligence": ["business-intelligence", "product-analytics"],
  "help-desk": ["help-desk", "customer-success", "live-chat"],
  "project-management": ["project-management", "collaboration"],
  "endpoint-security": ["endpoint-security", "security-operations"],
  "payment-processing": ["payment-processing", "ecommerce-platform"],
  "monitoring": ["monitoring", "cloud-infrastructure"],
  "workflow-automation": ["workflow-automation", "rpa"],
};

async function runActorAndGetResults(
  actorId: string,
  input: Record<string, unknown>,
  maxItems: number = 10,
): Promise<Record<string, unknown>[]> {
  const runRes = await fetch(
    `${BASE_URL}/acts/${actorId}/runs?token=${API_TOKEN}&waitForFinish=120`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );

  if (!runRes.ok) {
    throw new Error(`Actor run failed: Status ${runRes.status}`);
  }

  const runData = await runRes.json() as {
    data: { id: string; defaultDatasetId: string; status: string };
  };
  const datasetId = runData.data.defaultDatasetId;

  const dataRes = await fetch(
    `${BASE_URL}/datasets/${datasetId}/items?token=${API_TOKEN}&limit=${maxItems}`,
  );

  if (!dataRes.ok) {
    throw new Error(`Dataset fetch failed: Status ${dataRes.status}`);
  }

  const items = await dataRes.json() as Record<string, unknown>[];
  return items || [];
}

function scoreLinkedInRelevance(text: string): number {
  const lower = text.toLowerCase();

  const strongSignals = [
    "evaluating", "comparing", "switching to", "implementing",
    "migrating", "replaced", "chose", "selected", "vendor",
    "rfp", "proof of concept", "poc", "pilot",
  ];

  const weakSignals = [
    "announced", "launched", "released", "hired",
  ];

  let score = 0.3;

  for (const signal of strongSignals) {
    if (lower.includes(signal)) score += 0.15;
  }

  for (const signal of weakSignals) {
    if (lower.includes(signal)) score += 0.05;
  }

  return Math.min(1, score);
}

export async function ingestLinkedIn(): Promise<RawSignal[]> {
  if (!API_TOKEN) {
    console.error("APIFY_API_TOKEN not set, skipping LinkedIn ingestion");
    return [];
  }

  const signals: RawSignal[] = [];
  const actorId = "harvestapi~linkedin-post-search";
  const keywords = Object.keys(LINKEDIN_KEYWORDS);

  for (const keyword of keywords) {
    try {
      const results = await runActorAndGetResults(
        actorId,
        { searchQueries: [keyword], resultsPerQuery: 10 },
        10,
      );

      const topics = LINKEDIN_KEYWORDS[keyword];
      if (!topics) continue;

      for (const item of results) {
        const text = String(item.content || "");
        const author = item.author as Record<string, unknown> | undefined;
        const authorName = String(author?.name || "");
        const authorTitle = String(author?.headline || "");
        const postUrl = String(item.linkedinUrl || "");
        let dateStr: string;
        try {
          const raw = item.postedAt || item.publishedAt || item.date;
          dateStr = raw ? new Date(String(raw)).toISOString() : new Date().toISOString();
        } catch {
          dateStr = new Date().toISOString();
        }

        const domains = extractDomains(text);
        const relevance = scoreLinkedInRelevance(text);

        for (const domain of domains) {
          const company = getOrCreateCompany(domain);

          for (const topic of topics) {
            signals.push({
              source: "linkedin",
              domain: company.canonical_domain,
              topic,
              score: relevance,
              timestamp: dateStr,
              evidence_url: postUrl,
              evidence_snippet: text.slice(0, 500),
              person_hint: `${authorName} — ${authorTitle}`.slice(0, 200),
            });
          }
        }
      }
    } catch (err) {
      console.error(`Failed LinkedIn search for "${keyword}":`, (err as Error).message);
    }

    await delay(3000);
  }

  return signals;
}

export async function ingestG2(): Promise<RawSignal[]> {
  if (!API_TOKEN) {
    console.error("APIFY_API_TOKEN not set, skipping G2 ingestion");
    return [];
  }

  const signals: RawSignal[] = [];
  const actorId = "powerai~g2-product-reviews-scraper";
  const categories = Object.keys(G2_CATEGORIES);

  for (const category of categories) {
    try {
      const results = await runActorAndGetResults(
        actorId,
        { startUrls: [{ url: `https://www.g2.com/categories/${category}` }] },
        20,
      );

      const topics = G2_CATEGORIES[category];
      if (!topics) continue;

      for (const item of results) {
        const productName = String(item.productName || item.name || item.product || "");
        const reviewText = String(item.reviewText || item.text || item.content || item.review || "");
        const reviewerCompany = String(item.reviewerCompany || item.company || item.userCompany || "");
        const reviewUrl = String(item.url || item.reviewUrl || "");
        const dateStr = String(item.date || item.reviewDate || item.publishedAt || new Date().toISOString());

        if (!reviewerCompany) continue;

        const slug = reviewerCompany.toLowerCase().replace(/[^a-z0-9]/g, "");
        const company = getOrCreateCompany(`${slug}.com`, reviewerCompany);

        const lower = reviewText.toLowerCase();
        const relevance = lower.includes("switching") ||
          lower.includes("evaluating") ||
          lower.includes("comparing") ||
          lower.includes("migrating")
          ? 0.8 : 0.5;

        for (const topic of topics) {
          signals.push({
            source: "g2",
            domain: company.canonical_domain,
            topic,
            score: relevance,
            timestamp: new Date(dateStr).toISOString(),
            evidence_url: reviewUrl,
            evidence_snippet: `${reviewerCompany} reviewing ${productName}: ${reviewText}`.slice(0, 500),
          });
        }
      }
    } catch (err) {
      console.error(`Failed G2 scrape for "${category}":`, (err as Error).message);
    }

    await delay(5000);
  }

  return signals;
}