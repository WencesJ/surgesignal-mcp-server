import type { RawSignal } from "../../schemas/surge.js";
import { getOrCreateCompany, normalizeDomain } from "../company-resolver.js";
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

const DOMAIN_PATTERN = /\b([a-z0-9-]+\.(com|io|co|ai|dev|app|so|org|net))\b/gi;
const BLOCKED_DOMAINS = new Set([
  "github.com", "google.com", "youtube.com", "imgur.com",
  "medium.com", "twitter.com", "x.com", "linkedin.com",
  "facebook.com", "reddit.com", "redd.it", "amazonaws.com",
  "cloudflare.com", "wikipedia.org", "stackoverflow.com",
  "npmjs.com", "pypi.org", "docs.google.com", "drive.google.com",
  "apple.com", "microsoft.com", "amazon.com", "gist.github.com",
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

async function fetchSubredditJSON(subreddit: string): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=25`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`Status code ${res.status}`);
  }

  const json = await res.json() as {
    data: { children: Array<{ data: RedditPost }> };
  };

  return json.data.children.map((c) => c.data);
}

export async function ingestRedditRSS(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const subreddits = Object.keys(SUBREDDIT_TOPIC_MAP);

  for (const subreddit of subreddits) {
    try {
      const posts = await fetchSubredditJSON(subreddit);
      const topics = SUBREDDIT_TOPIC_MAP[subreddit];
      if (!topics) continue;

      for (const post of posts) {
        const text = `${post.title} ${post.selftext}`;
        const domains = extractDomains(text);
        if (domains.length === 0) continue;

        const relevance = scoreRelevance(post.title, post.selftext);
        const timestamp = new Date(post.created_utc * 1000).toISOString();
        const link = `https://www.reddit.com${post.permalink}`;

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
    } catch (err) {
      console.error(`Failed to fetch r/${subreddit}:`, (err as Error).message);
    }

    await delay(2000);
  }

  return signals;
}