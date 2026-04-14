import type { RawSignal } from "../../schemas/surge.js";
import { getOrCreateCompany, normalizeDomain } from "../company-resolver.js";
import type { CoveredTopic } from "../../constants.js";

const API_KEY = process.env.NEWSDATA_API_KEY || "";
const BASE_URL = "https://newsdata.io/api/1/latest";

const KEYWORD_TOPIC_MAP: Record<string, CoveredTopic[]> = {
  "CRM software": ["crm", "sales-engagement"],
  "marketing automation": ["marketing-automation", "abm"],
  "data warehouse": ["data-warehouse", "data-integration", "etl"],
  "business intelligence": ["business-intelligence", "product-analytics"],
  "customer support software": ["help-desk", "customer-success", "live-chat"],
  "project management tool": ["project-management", "collaboration"],
  "HR software": ["hr-software", "ats", "employee-engagement"],
  "cloud infrastructure": ["cloud-infrastructure", "container-orchestration"],
  "cybersecurity platform": ["security-operations", "endpoint-security", "siem"],
  "payment processing": ["payment-processing", "ecommerce-platform"],
  "workflow automation": ["workflow-automation", "rpa", "integration-platform"],
  "API management": ["api-management", "integration-platform"],
};

const COMPANY_NEWS_SEARCHES: Record<string, { domain: string; topics: CoveredTopic[] }> = {
  "Salesforce CRM": { domain: "salesforce.com", topics: ["crm", "sales-engagement", "marketing-automation"] },
  "HubSpot": { domain: "hubspot.com", topics: ["crm", "marketing-automation", "sales-engagement"] },
  "Stripe payments": { domain: "stripe.com", topics: ["payment-processing", "ecommerce-platform", "billing"] },
  "Datadog monitoring": { domain: "datadog.com", topics: ["monitoring", "cloud-infrastructure"] },
  "Snowflake data": { domain: "snowflake.com", topics: ["data-warehouse", "data-integration", "business-intelligence"] },
  "Zendesk support": { domain: "zendesk.com", topics: ["help-desk", "customer-success", "live-chat"] },
  "Twilio": { domain: "twilio.com", topics: ["sms-platform", "voip", "api-management"] },
  "MongoDB": { domain: "mongodb.com", topics: ["data-warehouse", "cloud-infrastructure"] },
  "Grafana": { domain: "grafana.com", topics: ["monitoring", "business-intelligence"] },
  "Intercom": { domain: "intercom.com", topics: ["live-chat", "customer-success", "help-desk"] },
};

const DOMAIN_PATTERN = /\b([a-z0-9-]+\.(com|io|co|ai|dev|app|so|org|net))\b/gi;

const BLOCKED_DOMAINS = new Set([
  "github.com", "google.com", "youtube.com", "imgur.com",
  "medium.com", "twitter.com", "x.com", "linkedin.com",
  "facebook.com", "reddit.com", "amazonaws.com",
  "cloudflare.com", "wikipedia.org", "stackoverflow.com",
  "apple.com", "microsoft.com", "amazon.com", "newsdata.io",
  "reuters.com", "bloomberg.com", "techcrunch.com", "bbc.com",
  "cxotoday.com", "computerweekly.com", "globenewswire.com",
  "techradar.com", "zdnet.com", "theverge.com", "wired.com",
  "venturebeat.com", "businesswire.com", "prnewswire.com",
  "frontpageafricaonline.com", "virginmediao2.co",
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

function scoreRelevance(title: string, description: string): number {
  const text = `${title} ${description}`.toLowerCase();

  const strongSignals = [
    "raises", "funding", "series a", "series b", "series c",
    "acquisition", "acquires", "partnership", "integrates with",
    "launches", "new product", "expands", "hires", "appoints",
    "revenue", "growth", "customers", "enterprise",
  ];

  const weakSignals = [
    "report", "study", "survey", "trend", "market",
  ];

  let score = 0.3;

  for (const signal of strongSignals) {
    if (text.includes(signal)) score += 0.12;
  }

  for (const signal of weakSignals) {
    if (text.includes(signal)) score += 0.04;
  }

  return Math.min(1, score);
}

interface NewsDataArticle {
  title: string;
  description: string | null;
  link: string;
  pubDate: string;
  source_name: string;
}

interface NewsDataResponse {
  status: string;
  totalResults: number;
  results: NewsDataArticle[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchNews(keyword: string): Promise<NewsDataArticle[]> {
  const params = new URLSearchParams({
    apikey: API_KEY,
    q: keyword,
    language: "en",
    size: "10",
  });

  const res = await fetch(`${BASE_URL}?${params}`);

  if (!res.ok) {
    throw new Error(`Status ${res.status}`);
  }

  const json = await res.json() as NewsDataResponse;
  return json.results || [];
}

async function ingestGenericNews(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const keywords = Object.keys(KEYWORD_TOPIC_MAP);

  for (const keyword of keywords) {
    try {
      const articles = await fetchNews(keyword);
      const topics = KEYWORD_TOPIC_MAP[keyword];
      if (!topics) continue;

      for (const article of articles) {
        const title = article.title || "";
        const description = article.description || "";
        const text = `${title} ${description}`;

        const domains = extractDomains(text);
        if (domains.length === 0) continue;

        const relevance = scoreRelevance(title, description);
        const timestamp = article.pubDate
          ? new Date(article.pubDate).toISOString()
          : new Date().toISOString();

        for (const domain of domains) {
          const company = getOrCreateCompany(domain);

          for (const topic of topics) {
            signals.push({
              source: "news",
              domain: company.canonical_domain,
              topic,
              score: relevance,
              timestamp,
              evidence_url: article.link,
              evidence_snippet: title.slice(0, 500),
            });
          }
        }
      }
    } catch (err) {
      console.error(`Failed to fetch news for "${keyword}":`, (err as Error).message);
    }

    await delay(1500);
  }

  return signals;
}

async function ingestTargetedCompanyNews(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const companies = Object.keys(COMPANY_NEWS_SEARCHES);

  for (const searchTerm of companies) {
    const config = COMPANY_NEWS_SEARCHES[searchTerm];
    if (!config) continue;

    try {
      const articles = await fetchNews(searchTerm);

      for (const article of articles) {
        const title = article.title || "";
        const description = article.description || "";
        const relevance = scoreRelevance(title, description);
        const timestamp = article.pubDate
          ? new Date(article.pubDate).toISOString()
          : new Date().toISOString();

        const company = getOrCreateCompany(config.domain);

        for (const topic of config.topics) {
          signals.push({
            source: "news",
            domain: company.canonical_domain,
            topic,
            score: relevance,
            timestamp,
            evidence_url: article.link,
            evidence_snippet: title.slice(0, 500),
          });
        }
      }
    } catch (err) {
      console.error(`Failed targeted news for "${searchTerm}":`, (err as Error).message);
    }

    await delay(1500);
  }

  return signals;
}

export async function ingestNewsData(): Promise<RawSignal[]> {
  if (!API_KEY) {
    console.error("NEWSDATA_API_KEY not set, skipping news ingestion");
    return [];
  }

  const [genericSignals, targetedSignals] = await Promise.all([
    ingestGenericNews(),
    ingestTargetedCompanyNews(),
  ]);

  return [...genericSignals, ...targetedSignals];
}