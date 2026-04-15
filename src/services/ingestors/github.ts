import type { RawSignal } from "../../schemas/surge.js";
import { getOrCreateCompany, deriveGitHubOrg } from "../company-resolver.js";
import type { CoveredTopic } from "../../constants.js";

const USER_AGENT = "SurgeSignal/1.0 (intent-data-aggregator)";

const REPO_TOPIC_MAP: Record<string, CoveredTopic[]> = {
  "supabase/supabase": ["cloud-infrastructure", "data-warehouse"],
  "grafana/grafana": ["monitoring", "business-intelligence"],
  "apache/airflow": ["etl", "data-integration", "workflow-automation"],
  "PostHog/posthog": ["product-analytics", "session-replay", "ab-testing", "feature-flags"],
  "openai/openai-python": ["api-management", "integration-platform"],
  "langchain-ai/langchain": ["api-management", "integration-platform"],
  "n8n-io/n8n": ["workflow-automation", "integration-platform", "rpa"],
  "calcom/cal.com": ["collaboration", "video-conferencing"],
  "medusajs/medusa": ["ecommerce-platform", "payment-processing"],
  "saleor/saleor": ["ecommerce-platform", "payment-processing"],
  "chatwoot/chatwoot": ["live-chat", "help-desk", "customer-success"],
  "mattermost/mattermost": ["collaboration", "live-chat"],
  "nocodb/nocodb": ["project-management", "collaboration"],
  "appwrite/appwrite": ["cloud-infrastructure", "api-management"],
  "directus/directus": ["cms", "api-management"],
  "strapi/strapi": ["cms", "api-management"],
  "plausible/analytics": ["product-analytics", "session-replay"],
  "umami-software/umami": ["product-analytics"],
  "keycloak/keycloak": ["identity-verification", "security-operations"],
  "gravitl/netmaker": ["cloud-infrastructure", "endpoint-security"],
};

interface GitHubIssue {
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
  user: { login: string } | null;
}

interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  open_issues_count: number;
  stargazers_count: number;
  updated_at: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scoreIssueRelevance(title: string, body: string): number {
  const text = `${title} ${body}`.toLowerCase();

  const strongSignals = [
    "migration", "migrate from", "switching from", "replacing",
    "integration with", "connect to", "support for", "compatibility",
    "enterprise", "production", "deploy", "scale",
  ];

  const weakSignals = [
    "bug", "error", "fix", "typo", "docs", "documentation",
  ];

  let score = 0.25;

  for (const signal of strongSignals) {
    if (text.includes(signal)) score += 0.15;
  }

  for (const signal of weakSignals) {
    if (text.includes(signal)) score += 0.03;
  }

  return Math.min(1, score);
}

function extractCompanyFromUser(login: string): string | null {
  const botSuffixes = ["-bot", "[bot]", "-ci", "-automation"];
  if (botSuffixes.some((s) => login.toLowerCase().endsWith(s))) return null;

  const orgPatterns = /^([a-z0-9-]+)-(eng|dev|team|ops|infra|platform)$/i;
  const match = login.match(orgPatterns);
  if (match) return match[1];

  return null;
}

async function fetchRecentIssues(repo: string): Promise<GitHubIssue[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const url = `https://api.github.com/repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=30&since=${since}`;

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": "application/vnd.github.v3+json",
  };

  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });

  if (!res.ok) {
    throw new Error(`Status ${res.status}`);
  }

  return res.json() as Promise<GitHubIssue[]>;
}

async function fetchOrgRepos(org: string): Promise<GitHubRepo[]> {
  const url = `https://api.github.com/orgs/${org}/repos?sort=updated&per_page=5&type=public`;

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": "application/vnd.github.v3+json",
  };

  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });

  if (!res.ok) {
    throw new Error(`Status ${res.status}`);
  }

  return res.json() as Promise<GitHubRepo[]>;
}

export async function searchGitHubForCompany(companyName: string, domain: string, topics: CoveredTopic[]): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const company = getOrCreateCompany(domain);
  const org = company.github_org || deriveGitHubOrg(domain);

  try {
    const repos = await fetchOrgRepos(org);

    for (const repo of repos) {
      if (repo.open_issues_count === 0) continue;

      try {
        const issues = await fetchRecentIssues(repo.full_name);

        for (const issue of issues) {
          const title = issue.title || "";
          const body = issue.body || "";
          const relevance = scoreIssueRelevance(title, body);

          for (const topic of topics) {
            signals.push({
              source: "github",
              domain: company.canonical_domain,
              topic,
              score: Math.min(1, relevance * 0.5),
              timestamp: issue.created_at,
              evidence_url: issue.html_url,
              evidence_snippet: `Issue on ${repo.full_name}: ${title.slice(0, 200)}`,
            });
          }
        }
      } catch (err) {
        console.error(`[dynamic] GitHub issues for ${repo.full_name}: ${(err as Error).message}`);
      }

      await delay(500);
    }
  } catch (err) {
    console.error(`[dynamic] GitHub org "${org}" for "${companyName}": ${(err as Error).message}`);
  }

  return signals;
}

export async function ingestGitHub(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const repos = Object.keys(REPO_TOPIC_MAP);

  for (const repo of repos) {
    try {
      const issues = await fetchRecentIssues(repo);
      const topics = REPO_TOPIC_MAP[repo];
      if (!topics) continue;

      for (const issue of issues) {
        const title = issue.title || "";
        const body = issue.body || "";
        const relevance = scoreIssueRelevance(title, body);
        const login = issue.user?.login || "";

        const companyHint = extractCompanyFromUser(login);
        if (companyHint) {
          const company = getOrCreateCompany(`${companyHint}.com`, companyHint);

          for (const topic of topics) {
            signals.push({
              source: "github",
              domain: company.canonical_domain,
              topic,
              score: relevance,
              timestamp: issue.created_at,
              evidence_url: issue.html_url,
              evidence_snippet: title.slice(0, 500),
              person_hint: login,
            });
          }
        }

        const repoOwner = repo.split("/")[0];
        const repoCompany = getOrCreateCompany(`${repoOwner}.com`, repoOwner);

        for (const topic of topics) {
          signals.push({
            source: "github",
            domain: repoCompany.canonical_domain,
            topic,
            score: Math.min(1, relevance * 0.5),
            timestamp: issue.created_at,
            evidence_url: issue.html_url,
            evidence_snippet: `Issue activity on ${repo}: ${title.slice(0, 200)}`,
          });
        }
      }
    } catch (err) {
      console.error(`Failed to fetch issues for ${repo}:`, (err as Error).message);
    }

    await delay(1000);
  }

  return signals;
}