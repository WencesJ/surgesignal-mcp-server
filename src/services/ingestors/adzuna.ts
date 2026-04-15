import type { RawSignal } from "../../schemas/surge.js";
import { getOrCreateCompany, normalizeDomain } from "../company-resolver.js";
import type { CoveredTopic } from "../../constants.js";

const APP_ID = process.env.ADZUNA_APP_ID || "";
const APP_KEY = process.env.ADZUNA_APP_KEY || "";
const BASE_URL = "https://api.adzuna.com/v1/api/jobs/us/search/1";

const KEYWORD_TOPIC_MAP: Record<string, CoveredTopic[]> = {
  "CRM engineer": ["crm", "sales-engagement"],
  "marketing automation": ["marketing-automation", "abm"],
  "data engineer": ["data-integration", "etl", "data-warehouse"],
  "business intelligence analyst": ["business-intelligence", "product-analytics"],
  "customer success manager": ["customer-success", "help-desk"],
  "DevOps engineer": ["ci-cd", "container-orchestration", "monitoring"],
  "cloud infrastructure engineer": ["cloud-infrastructure", "container-orchestration"],
  "security engineer": ["security-operations", "endpoint-security", "siem"],
  "payment systems engineer": ["payment-processing", "ecommerce-platform"],
  "workflow automation": ["workflow-automation", "rpa", "integration-platform"],
  "product analytics engineer": ["product-analytics", "ab-testing", "feature-flags"],
  "HR technology": ["hr-software", "ats", "employee-engagement"],
};

const DOMAIN_PATTERN = /\b([a-z0-9-]+\.(com|io|co|ai|dev|app|so|org|net))\b/gi;

const BLOCKED_DOMAINS = new Set([
  "github.com", "google.com", "youtube.com", "linkedin.com",
  "facebook.com", "twitter.com", "x.com", "indeed.com",
  "adzuna.com", "glassdoor.com", "lever.co", "greenhouse.io",
  "apple.com", "microsoft.com", "amazon.com", "workday.com",
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

function scoreJobRelevance(title: string, description: string): number {
  const text = `${title} ${description}`.toLowerCase();

  const strongSignals = [
    "senior", "lead", "staff", "principal", "head of",
    "build", "scale", "migrate", "implement", "architect",
    "greenfield", "new team", "founding",
  ];

  const weakSignals = [
    "junior", "intern", "entry level", "associate",
  ];

  let score = 0.4;

  for (const signal of strongSignals) {
    if (text.includes(signal)) score += 0.1;
  }

  for (const signal of weakSignals) {
    if (text.includes(signal)) score -= 0.05;
  }

  return Math.max(0.1, Math.min(1, score));
}

interface AdzunaJob {
  title: string;
  description: string;
  redirect_url: string;
  created: string;
  company: { display_name: string };
}

interface AdzunaResponse {
  results: AdzunaJob[];
  count: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJobs(keyword: string): Promise<AdzunaJob[]> {
  const params = new URLSearchParams({
    app_id: APP_ID,
    app_key: APP_KEY,
    what: keyword,
    results_per_page: "20",
    max_days_old: "7",
    sort_by: "date",
  });

  const res = await fetch(`${BASE_URL}?${params}`, { signal: AbortSignal.timeout(15000) });

  if (!res.ok) {
    throw new Error(`Status ${res.status}`);
  }

  const json = await res.json() as AdzunaResponse;
  return json.results || [];
}

export async function searchJobsForCompany(companyName: string, domain: string, topics: CoveredTopic[]): Promise<RawSignal[]> {
  if (!APP_ID || !APP_KEY) return [];

  const signals: RawSignal[] = [];

  try {
    const jobs = await fetchJobs(companyName);
    const company = getOrCreateCompany(domain);

    for (const job of jobs) {
      const title = job.title || "";
      const description = job.description || "";
      const jobCompany = job.company?.display_name || "";
      const relevance = scoreJobRelevance(title, description);
      const timestamp = job.created
        ? new Date(job.created).toISOString()
        : new Date().toISOString();

      const companyNameLower = companyName.toLowerCase();
      const jobCompanyLower = jobCompany.toLowerCase();

      if (jobCompanyLower.includes(companyNameLower) || companyNameLower.includes(jobCompanyLower)) {
        for (const topic of topics) {
          signals.push({
            source: "jobs",
            domain: company.canonical_domain,
            topic,
            score: relevance,
            timestamp,
            evidence_url: job.redirect_url,
            evidence_snippet: `${jobCompany} hiring: ${title}`.slice(0, 500),
          });
        }
      }
    }
  } catch (err) {
    console.error(`[dynamic] Jobs search for "${companyName}": ${(err as Error).message}`);
  }

  return signals;
}

export async function ingestAdzuna(): Promise<RawSignal[]> {
  if (!APP_ID || !APP_KEY) {
    console.error("ADZUNA_APP_ID or ADZUNA_APP_KEY not set, skipping jobs ingestion");
    return [];
  }

  const signals: RawSignal[] = [];
  const keywords = Object.keys(KEYWORD_TOPIC_MAP);

  for (const keyword of keywords) {
    try {
      const jobs = await fetchJobs(keyword);
      const topics = KEYWORD_TOPIC_MAP[keyword];
      if (!topics) continue;

      for (const job of jobs) {
        const title = job.title || "";
        const description = job.description || "";
        const companyName = job.company?.display_name || "";

        if (!companyName) continue;

        const relevance = scoreJobRelevance(title, description);
        const timestamp = job.created
          ? new Date(job.created).toISOString()
          : new Date().toISOString();

        const domains = extractDomains(description);
        let company;

        if (domains.length > 0) {
          company = getOrCreateCompany(domains[0]);
        } else {
          const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
          company = getOrCreateCompany(`${slug}.com`, companyName);
        }

        for (const topic of topics) {
          signals.push({
            source: "jobs",
            domain: company.canonical_domain,
            topic,
            score: relevance,
            timestamp,
            evidence_url: job.redirect_url,
            evidence_snippet: `${companyName} hiring: ${title}`.slice(0, 500),
          });
        }
      }
    } catch (err) {
      console.error(`Failed to fetch jobs for "${keyword}":`, (err as Error).message);
    }

    await delay(1500);
  }

  return signals;
}