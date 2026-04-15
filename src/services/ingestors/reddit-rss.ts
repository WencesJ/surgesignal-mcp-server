import type { RawSignal } from "../../schemas/surge.js";
import { getOrCreateCompany, normalizeDomain, getAllCompanies } from "../company-resolver.js";
import type { CoveredTopic } from "../../constants.js";

const USER_AGENT = "SurgeSignal/1.0 (intent-data-aggregator)";

const SUBREDDIT_TOPIC_MAP: Record<string, CoveredTopic[]> = {
  "dataengineering": ["data-integration", "etl", "data-warehouse"],
  "salesforce": ["crm", "sales-engagement"],
  "marketing": ["marketing-automation", "abm"],
  "devops": ["ci-cd", "container-orchestration", "monitoring"],
  "sysadmin": ["cloud-infrastructure", "monitoring", "endpoint-security"],
  "analytics": ["business-intelligence", "product-analytics"],
  "customerservice": ["help-desk", "customer-success", "live-chat"],
  "projectmanagement": ["project-management", "collaboration"],
  "humanresources": ["hr-software", "ats", "employee-engagement"],
  "accounting": ["accounting", "expense-management", "billing"],
  "ecommerce": ["ecommerce-platform", "payment-processing"],
  "netsec": ["security-operations", "siem", "vulnerability-management"],
  "webdev": ["cms", "design-tools", "api-management"],
  "SaaS": ["crm", "marketing-automation", "product-analytics"],
  "startups": ["crm", "sales-engagement", "product-analytics"],
  "sales": ["crm", "sales-engagement", "abm"],
  "ITManagers": ["cloud-infrastructure", "endpoint-security", "monitoring"],
  "businessintelligence": ["business-intelligence", "data-warehouse"],
  "chatbots": ["chatbot", "live-chat"],
  "automation": ["workflow-automation", "rpa", "integration-platform"],
};

const COMPANY_TOPIC_SEARCHES: Record<string, { domain: string; topics: CoveredTopic[] }> = {
  "salesforce": { domain: "salesforce.com", topics: ["crm", "sales-engagement", "marketing-automation"] },
  "hubspot": { domain: "hubspot.com", topics: ["crm", "marketing-automation", "sales-engagement"] },
  "stripe": { domain: "stripe.com", topics: ["payment-processing", "ecommerce-platform", "billing"] },
  "datadog": { domain: "datadog.com", topics: ["monitoring", "cloud-infrastructure", "security-operations"] },
  "snowflake": { domain: "snowflake.com", topics: ["data-warehouse", "data-integration", "business-intelligence"] },
  "twilio": { domain: "twilio.com", topics: ["sms-platform", "voip", "api-management"] },
  "zendesk": { domain: "zendesk.com", topics: ["help-desk", "customer-success", "live-chat"] },
  "intercom": { domain: "intercom.com", topics: ["live-chat", "customer-success", "help-desk"] },
  "slack": { domain: "slack.com", topics: ["collaboration", "video-conferencing"] },
  "notion": { domain: "notion.so", topics: ["project-management", "collaboration", "document-management", "wiki"] },
  "figma": { domain: "figma.com", topics: ["design-tools", "collaboration"] },
  "mongodb": { domain: "mongodb.com", topics: ["data-warehouse", "cloud-infrastructure"] },
  "grafana": { domain: "grafana.com", topics: ["monitoring", "business-intelligence"] },
  "supabase": { domain: "supabase.com", topics: ["cloud-infrastructure", "data-warehouse"] },
  "amplitude": { domain: "amplitude.com", topics: ["product-analytics", "ab-testing", "session-replay"] },
  "mixpanel": { domain: "mixpanel.com", topics: ["product-analytics", "ab-testing"] },
  "linear": { domain: "linear.app", topics: ["project-management", "collaboration"] },
  "vercel": { domain: "vercel.com", topics: ["cloud-infrastructure", "ci-cd", "cms"] },
  "elastic": { domain: "elastic.co", topics: ["monitoring", "security-operations", "siem"] },
  "segment": { domain: "segment.com", topics: ["data-integration", "product-analytics"] },
};

const DOMAIN_PATTERN = /\b([a-z0-9-]+\.(com|io|co|ai|dev|app|so|org|net))\b/gi;

const BLOCKED_DOMAINS = new Set([
  "github.com", "google.com", "youtube.com", "imgur.com",
  "medium.com", "twitter.com", "x.com", "linkedin.com",
  "facebook.com", "reddit.com", "amazonaws.com",
  "cloudflare.com", "wikipedia.org", "stackoverflow.com",
  "npmjs.com", "pypi.org", "docs.google.com", "drive.google.com",
  "apple.com", "microsoft.com", "amazon.com", "gist.github.com",
  "substack.com", "huggingface.co",
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

function scoreRelevance(title: string, snippet: string): number {
  const text = `${title} ${snippet}`.toLowerCase();

  const strongSignals = [
    "switching to", "migrating from", "replacing", "alternative to",
    "vs ", "compared to", "evaluation", "looking for", "recommend",
    "anyone using", "experience with", "review of", "moved from",
    "pricing", "cost of", "roi on", "implemented",
  ];

  const weakSignals = [
    "tutorial", "how to", "help with", "question about",
    "announcement", "released", "launched", "new feature",
  ];

  let score = 0.3;

  for (const signal of strongSignals) {
    if (text.includes(signal)) score += 0.15;
  }

  for (const signal of weakSignals) {
    if (text.includes(signal)) score += 0.05;
  }

  return Math.min(1, score);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RedditPost {
  title: string;
  selftext: string;
  url: string;
  permalink: string;
  created_utc: number;
}

async function fetchRedditJSON(url: string): Promise<RedditPost[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Status code ${res.status}`);
  }

  const json = await res.json() as {
    data: { children: Array<{ data: RedditPost }> };
  };

  return json.data.children.map((c) => c.data);
}

function processPostsForSignals(
  posts: RedditPost[],
  topics: CoveredTopic[],
  forceDomain?: string,
): RawSignal[] {
  const signals: RawSignal[] = [];

  for (const post of posts) {
    const text = `${post.title} ${post.selftext}`;
    const relevance = scoreRelevance(post.title, post.selftext);
    const timestamp = new Date(post.created_utc * 1000).toISOString();
    const link = `https://www.reddit.com${post.permalink}`;

    if (forceDomain) {
      const company = getOrCreateCompany(forceDomain);
      for (const topic of topics) {
        signals.push({
          source: "reddit",
          domain: company.canonical_domain,
          topic,
          score: relevance,
          timestamp,
          evidence_url: link,
          evidence_snippet: post.title.slice(0, 500),
        });
      }
    } else {
      const domains = extractDomains(text);
      if (domains.length === 0) continue;

      for (const domain of domains) {
        const company = getOrCreateCompany(domain);
        for (const topic of topics) {
          signals.push({
            source: "reddit",
            domain: company.canonical_domain,
            topic,
            score: relevance,
            timestamp,
            evidence_url: link,
            evidence_snippet: post.title.slice(0, 500),
          });
        }
      }
    }
  }

  return signals;
}

async function ingestSubreddits(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const subreddits = Object.keys(SUBREDDIT_TOPIC_MAP);

  for (const subreddit of subreddits) {
    try {
      const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=25`;
      const posts = await fetchRedditJSON(url);
      const topics = SUBREDDIT_TOPIC_MAP[subreddit];
      if (!topics) continue;

      signals.push(...processPostsForSignals(posts, topics));
    } catch (err) {
      console.error(`Failed to fetch r/${subreddit}:`, (err as Error).message);
    }

    await delay(1000);
  }

  return signals;
}

async function ingestTargetedCompanies(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const companies = Object.keys(COMPANY_TOPIC_SEARCHES);

  for (const companyName of companies) {
    const config = COMPANY_TOPIC_SEARCHES[companyName];
    if (!config) continue;

    try {
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(companyName)}&sort=new&limit=10&t=week`;
      const posts = await fetchRedditJSON(url);
      signals.push(...processPostsForSignals(posts, config.topics, config.domain));
    } catch (err) {
      console.error(`Failed targeted search for "${companyName}":`, (err as Error).message);
    }

    await delay(1000);
  }

  return signals;
}

export async function ingestRedditRSS(): Promise<RawSignal[]> {
  const subredditSignals = await ingestSubreddits();
  const targetedSignals = await ingestTargetedCompanies();

  return [...subredditSignals, ...targetedSignals];
}