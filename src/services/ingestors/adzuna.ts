import type { RawSignal } from "../../schemas/surge.js";
import { getOrCreateCompany, normalizeDomain } from "../company-resolver.js";
import type { CoveredTopic } from "../../constants.js";

const APP_ID = process.env.ADZUNA_APP_ID || "";
const APP_KEY = process.env.ADZUNA_APP_KEY || "";
const BASE_URL = "https://api.adzuna.com/v1/api/jobs/us/search/1";

const KEYWORD_TOPIC_MAP: Record<string, CoveredTopic[]> = {
  "CRM engineer": ["crm", "sales-engagement"],
  "Salesforce developer": ["crm", "sales-engagement"],
  "Salesforce administrator": ["crm", "sales-engagement"],
  "HubSpot": ["crm", "marketing-automation"],
  "marketing automation": ["marketing-automation", "abm"],
  "data engineer Snowflake": ["data-warehouse", "data-integration"],
  "data engineer Databricks": ["data-warehouse", "etl"],
  "data engineer BigQuery": ["data-warehouse", "data-integration"],
  "dbt developer": ["etl", "data-integration", "data-warehouse"],
  "business intelligence analyst": ["business-intelligence", "product-analytics"],
  "Tableau developer": ["business-intelligence", "product-analytics"],
  "Looker developer": ["business-intelligence", "product-analytics"],
  "customer success manager": ["customer-success", "help-desk"],
  "Zendesk administrator": ["help-desk", "customer-success"],
  "DevOps engineer": ["ci-cd", "container-orchestration", "monitoring"],
  "Datadog engineer": ["monitoring", "cloud-infrastructure"],
  "cloud infrastructure engineer": ["cloud-infrastructure", "container-orchestration"],
  "security engineer": ["security-operations", "endpoint-security", "siem"],
  "Stripe integration": ["payment-processing", "ecommerce-platform"],
  "payment systems engineer": ["payment-processing", "ecommerce-platform"],
  "workflow automation": ["workflow-automation", "rpa", "integration-platform"],
  "Zapier automation": ["workflow-automation", "integration-platform"],
  "product analytics engineer": ["product-analytics", "ab-testing", "feature-flags"],
  "Mixpanel analyst": ["product-analytics", "ab-testing"],
  "Amplitude analyst": ["product-analytics", "ab-testing"],
  "HR technology": ["hr-software", "ats", "employee-engagement"],
  "Workday consultant": ["hr-software", "payroll"],
  "Rippling administrator": ["hr-software", "payroll"],
};

// Map tool/vendor mentions in job descriptions to canonical domains
const TOOL_DOMAIN_MAP: Record<string, string> = {
  "salesforce": "salesforce.com",
  "hubspot": "hubspot.com",
  "stripe": "stripe.com",
  "datadog": "datadog.com",
  "snowflake": "snowflake.com",
  "zendesk": "zendesk.com",
  "intercom": "intercom.com",
  "slack": "slack.com",
  "notion": "notion.so",
  "asana": "asana.com",
  "monday.com": "monday.com",
  "linear": "linear.app",
  "mixpanel": "mixpanel.com",
  "amplitude": "amplitude.com",
  "segment": "segment.com",
  "twilio": "twilio.com",
  "sendgrid": "sendgrid.com",
  "cloudflare": "cloudflare.com",
  "vercel": "vercel.com",
  "mongodb": "mongodb.com",
  "databricks": "databricks.com",
  "bigquery": "cloud.google.com",
  "looker": "looker.com",
  "tableau": "tableau.com",
  "dbt": "getdbt.com",
  "fivetran": "fivetran.com",
  "grafana": "grafana.com",
  "pagerduty": "pagerduty.com",
  "new relic": "newrelic.com",
  "newrelic": "newrelic.com",
  "okta": "okta.com",
  "crowdstrike": "crowdstrike.com",
  "splunk": "splunk.com",
  "zapier": "zapier.com",
  "workato": "workato.com",
  "rippling": "rippling.com",
  "gusto": "gusto.com",
  "bamboohr": "bamboohr.com",
  "workday": "workday.com",
  "shopify": "shopify.com",
  "pipedrive": "pipedrive.com",
  "freshdesk": "freshdesk.com",
  "zoom": "zoom.us",
  "ringcentral": "ringcentral.com",
  "clickup": "clickup.com",
  "jira": "atlassian.com",
  "confluence": "atlassian.com",
  "posthog": "posthog.com",
  "hotjar": "hotjar.com",
  "fullstory": "fullstory.com",
};

function extractToolDomains(text: string): string[] {
  const lower = text.toLowerCase();
  const domains = new Set<string>();

  for (const [tool, domain] of Object.entries(TOOL_DOMAIN_MAP)) {
    if (lower.includes(tool)) {
      domains.add(domain);
    }
  }

  return Array.from(domains);
}

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

        // First try to extract tool domains from job description
        const toolDomains = extractToolDomains(`${title} ${description}`);

        // Only create signals for known tool domains.
        // Do NOT fall back to the hiring company domain — that creates noise
        // (metropolis.com appearing in data-warehouse results because they're hiring).
        if (toolDomains.length > 0) {
          for (const domain of toolDomains) {
            const company = getOrCreateCompany(domain);
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
        }
      }
    } catch (err) {
      console.error(`Failed to fetch jobs for "${keyword}":`, (err as Error).message);
    }

    await delay(1500);
  }

  return signals;
}