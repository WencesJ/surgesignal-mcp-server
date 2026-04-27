import type { RawSignal } from "../../schemas/surge.js";
import { getOrCreateCompany } from "../company-resolver.js";
import type { CoveredTopic } from "../../constants.js";

const BRIGHTDATA_API_TOKEN = process.env.BRIGHTDATA_API_TOKEN!;
const DATASET_ID = process.env.BRIGHTDATA_LINKEDIN_DATASET_ID!;
const BASE_URL = "https://api.brightdata.com/datasets/v3";

const COMPANY_PAGES: {
  url: string;
  domain: string;
  topics: CoveredTopic[];
}[] = [
  { url: "https://www.linkedin.com/company/hubspotinc", domain: "hubspot.com", topics: ["crm", "marketing-automation", "sales-engagement"] },
  { url: "https://www.linkedin.com/company/stripe-inc", domain: "stripe.com", topics: ["payment-processing", "ecommerce-platform", "billing"] },
  { url: "https://www.linkedin.com/company/datadog", domain: "datadog.com", topics: ["monitoring", "cloud-infrastructure"] },
  { url: "https://www.linkedin.com/company/zendesk", domain: "zendesk.com", topics: ["help-desk", "customer-success", "live-chat"] },
  { url: "https://www.linkedin.com/company/intercom-software", domain: "intercom.com", topics: ["live-chat", "customer-success", "help-desk"] },
  { url: "https://www.linkedin.com/company/grafana-labs", domain: "grafana.com", topics: ["monitoring", "business-intelligence"] },
  { url: "https://www.linkedin.com/company/mongodbinc", domain: "mongodb.com", topics: ["data-warehouse", "cloud-infrastructure"] },
  { url: "https://www.linkedin.com/company/elastic-co", domain: "elastic.co", topics: ["monitoring", "security-operations", "siem"] },
  { url: "https://www.linkedin.com/company/mixpanel", domain: "mixpanel.com", topics: ["product-analytics", "ab-testing"] },
  { url: "https://www.linkedin.com/company/slack", domain: "slack.com", topics: ["collaboration", "video-conferencing"] },
  { url: "https://www.linkedin.com/company/snowflakecorp", domain: "snowflake.com", topics: ["data-warehouse", "data-integration", "business-intelligence"] },
  { url: "https://www.linkedin.com/company/salesforce", domain: "salesforce.com", topics: ["crm", "sales-engagement", "marketing-automation"] },
  { url: "https://www.linkedin.com/company/asana", domain: "asana.com", topics: ["project-management", "collaboration"] },
  { url: "https://www.linkedin.com/company/notionhq", domain: "notion.so", topics: ["project-management", "collaboration", "wiki"] },
  { url: "https://www.linkedin.com/company/linear-app", domain: "linear.app", topics: ["project-management", "collaboration"] },
  { url: "https://www.linkedin.com/company/amplitude-analytics", domain: "amplitude.com", topics: ["product-analytics", "ab-testing"] },
  { url: "https://www.linkedin.com/company/segment-io", domain: "segment.com", topics: ["data-integration", "product-analytics"] },
  { url: "https://www.linkedin.com/company/databricks", domain: "databricks.com", topics: ["data-warehouse", "data-integration", "etl"] },
  { url: "https://www.linkedin.com/company/okta", domain: "okta.com", topics: ["identity-verification", "security-operations"] },
  { url: "https://www.linkedin.com/company/crowdstrike", domain: "crowdstrike.com", topics: ["endpoint-security", "security-operations", "siem"] },
  { url: "https://www.linkedin.com/company/pagerduty", domain: "pagerduty.com", topics: ["monitoring", "security-operations"] },
  { url: "https://www.linkedin.com/company/clickup", domain: "clickup.com", topics: ["project-management", "collaboration", "workflow-automation"] },
  { url: "https://www.linkedin.com/company/zapier", domain: "zapier.com", topics: ["workflow-automation", "integration-platform"] },
  { url: "https://www.linkedin.com/company/rippling", domain: "rippling.com", topics: ["hr-software", "payroll", "employee-engagement"] },
  { url: "https://www.linkedin.com/company/fivetran", domain: "fivetran.com", topics: ["data-integration", "etl"] },
];

interface BrightDataLinkedInPost {
  url: string;
  id: string;
  user_id: string;
  use_url: string;
  title: string;
  headline: string;
  post_text: string;
  date: string;
  likes: number;
  comments: number;
  shares: number;
}

const STRONG_INTENT_SIGNALS = [
  "evaluating", "comparing", "switching to", "implementing",
  "migrating", "replaced", "chose", "selected", "vendor",
  "rfp", "proof of concept", "poc", "pilot", "demo",
  "new customer", "customer story", "case study",
  "integration", "partnership", "launch", "product update",
];

const BOILERPLATE_PATTERNS = [
  /click on the link to sign in/i,
  /check your spam folder/i,
  /if you don't see the email in your inbox/i,
  /join now to see who you already know/i,
  /be seen by recruiters/i,
  /linkedin corporation/i,
  /cookie policy/i,
  /privacy policy/i,
  /user agreement/i,
  /sign in with/i,
  /create your free account/i,
];

function isBoilerplate(text: string): boolean {
  return BOILERPLATE_PATTERNS.some((p) => p.test(text));
}

function scorePost(text: string, likes: number, comments: number): number {
  if (!text || text.length < 50) return 0;
  if (isBoilerplate(text)) return 0;

  const lower = text.toLowerCase();
  let score = 0.25;

  for (const signal of STRONG_INTENT_SIGNALS) {
    if (lower.includes(signal)) score += 0.1;
  }

  if (likes > 100) score += 0.1;
  if (comments > 20) score += 0.1;

  return Math.min(1, score);
}

async function triggerSnapshot(inputs: { url: string; start_date: string; end_date: string }[]): Promise<string> {
  const res = await fetch(
    `${BASE_URL}/trigger?dataset_id=${DATASET_ID}&notify=false&include_errors=false`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${BRIGHTDATA_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(inputs),
      signal: AbortSignal.timeout(60000),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bright Data LinkedIn trigger failed: ${res.status} — ${body}`);
  }

  const data = await res.json() as { snapshot_id: string };
  return data.snapshot_id;
}

async function pollSnapshot(snapshotId: string, maxWaitMs = 300000): Promise<BrightDataLinkedInPost[]> {
  const start = Date.now();
  const pollInterval = 8000;

  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const res = await fetch(
      `${BASE_URL}/snapshot/${snapshotId}?format=json`,
      {
        headers: { "Authorization": `Bearer ${BRIGHTDATA_API_TOKEN}` },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (res.status === 202) continue;
    if (!res.ok) throw new Error(`Bright Data LinkedIn poll failed: ${res.status}`);

    return res.json() as Promise<BrightDataLinkedInPost[]>;
  }

  throw new Error("Bright Data LinkedIn snapshot timed out");
}

export async function searchLinkedInForCompany(companyName: string, domain: string, topics: CoveredTopic[]): Promise<RawSignal[]> {
  // Dynamic lookup not supported via dataset API — return empty for fan-out
  return [];
}

export async function ingestLinkedInDirect(): Promise<RawSignal[]> {
  if (!BRIGHTDATA_API_TOKEN || !DATASET_ID) {
    console.error("Bright Data LinkedIn credentials not configured, skipping");
    return [];
  }

  const signals: RawSignal[] = [];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const inputs = COMPANY_PAGES.map((p) => ({
    url: p.url,
    start_date: thirtyDaysAgo,
    end_date: now,
  }));

  try {
    console.error(`[brightdata-linkedin] Triggering snapshot for ${inputs.length} LinkedIn company pages...`);
    const snapshotId = await triggerSnapshot(inputs);
    console.error(`[brightdata-linkedin] Snapshot ID: ${snapshotId}, polling...`);

    const posts = await pollSnapshot(snapshotId);
    console.error(`[brightdata-linkedin] Got ${posts.length} posts`);

    for (const post of posts) {
      const postUrl = post.url || "";
      const productConfig = COMPANY_PAGES.find((p) =>
        postUrl.includes(p.url.replace("https://www.linkedin.com/company/", ""))
      );
      if (!productConfig) continue;

      const text = post.post_text || post.headline || post.title || "";
      if (!text || text.length < 50) continue;
      if (isBoilerplate(text)) continue;

      const relevance = scorePost(text, post.likes || 0, post.comments || 0);
      if (relevance === 0) continue;

      const company = getOrCreateCompany(productConfig.domain);
      const timestamp = post.date
        ? new Date(post.date).toISOString()
        : new Date().toISOString();

      for (const topic of productConfig.topics) {
        signals.push({
          source: "linkedin",
          domain: company.canonical_domain,
          topic,
          score: relevance,
          timestamp,
          evidence_url: post.use_url || post.url || productConfig.url,
          evidence_snippet: text.slice(0, 500),
        });
      }
    }
  } catch (err) {
    console.error(`[brightdata-linkedin] Failed: ${(err as Error).message}`);
  }

  return signals;
}