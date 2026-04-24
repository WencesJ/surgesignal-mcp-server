import type { RawSignal } from "../../schemas/surge.js";
import { getOrCreateCompany } from "../company-resolver.js";
import type { CoveredTopic } from "../../constants.js";

const BRIGHTDATA_API_TOKEN = process.env.BRIGHTDATA_API_TOKEN!;
const DATASET_ID = process.env.BRIGHTDATA_G2_DATASET_ID!;
const BASE_URL = "https://api.brightdata.com/datasets/v3";

const G2_PRODUCTS: {
  url: string;
  domain: string;
  topics: CoveredTopic[];
}[] = [
  // CRM & Sales
  { url: "https://www.g2.com/products/agentforce-sales-formerly-salesforce-sales-cloud/reviews", domain: "salesforce.com", topics: ["crm", "sales-engagement", "marketing-automation"] },
  { url: "https://www.g2.com/products/hubspot-sales-hub/reviews", domain: "hubspot.com", topics: ["crm", "sales-engagement"] },
  { url: "https://www.g2.com/products/hubspot-marketing-hub/reviews", domain: "hubspot.com", topics: ["marketing-automation", "abm", "email-deliverability"] },
  { url: "https://www.g2.com/products/pipedrive/reviews", domain: "pipedrive.com", topics: ["crm", "sales-engagement"] },
  { url: "https://www.g2.com/products/zoho-crm/reviews", domain: "zoho.com", topics: ["crm", "sales-engagement", "marketing-automation"] },
  { url: "https://www.g2.com/products/monday-sales-crm/reviews", domain: "monday.com", topics: ["crm", "sales-engagement"] },

  // Payment & Billing
  { url: "https://www.g2.com/products/stripe/reviews", domain: "stripe.com", topics: ["payment-processing", "billing", "subscription-management"] },
  { url: "https://www.g2.com/products/chargebee/reviews", domain: "chargebee.com", topics: ["billing", "subscription-management"] },
  { url: "https://www.g2.com/products/recurly/reviews", domain: "recurly.com", topics: ["subscription-management", "billing"] },
  { url: "https://www.g2.com/products/braintree/reviews", domain: "braintree.com", topics: ["payment-processing", "ecommerce-platform"] },

  // Monitoring & Observability
  { url: "https://www.g2.com/products/datadog/reviews", domain: "datadog.com", topics: ["monitoring", "cloud-infrastructure", "security-operations"] },
  { url: "https://www.g2.com/products/new-relic/reviews", domain: "newrelic.com", topics: ["monitoring", "cloud-infrastructure"] },
  { url: "https://www.g2.com/products/grafana/reviews", domain: "grafana.com", topics: ["monitoring", "business-intelligence"] },
  { url: "https://www.g2.com/products/dynatrace/reviews", domain: "dynatrace.com", topics: ["monitoring", "cloud-infrastructure"] },
  { url: "https://www.g2.com/products/pagerduty/reviews", domain: "pagerduty.com", topics: ["monitoring", "security-operations"] },

  // Data Warehouse & Analytics
  { url: "https://www.g2.com/products/snowflake/reviews", domain: "snowflake.com", topics: ["data-warehouse", "data-integration", "business-intelligence"] },
  { url: "https://www.g2.com/products/databricks/reviews", domain: "databricks.com", topics: ["data-warehouse", "data-integration", "etl"] },
  { url: "https://www.g2.com/products/google-bigquery/reviews", domain: "cloud.google.com", topics: ["data-warehouse", "data-integration", "business-intelligence"] },
  { url: "https://www.g2.com/products/amazon-redshift/reviews", domain: "aws.amazon.com", topics: ["data-warehouse", "cloud-infrastructure"] },
  { url: "https://www.g2.com/products/fivetran/reviews", domain: "fivetran.com", topics: ["data-integration", "etl"] },
  { url: "https://www.g2.com/products/dbt/reviews", domain: "getdbt.com", topics: ["etl", "data-integration", "data-warehouse"] },

  // Business Intelligence
  { url: "https://www.g2.com/products/tableau/reviews", domain: "tableau.com", topics: ["business-intelligence", "product-analytics"] },
  { url: "https://www.g2.com/products/looker/reviews", domain: "looker.com", topics: ["business-intelligence", "product-analytics"] },
  { url: "https://www.g2.com/products/power-bi/reviews", domain: "powerbi.microsoft.com", topics: ["business-intelligence", "product-analytics"] },
  { url: "https://www.g2.com/products/metabase/reviews", domain: "metabase.com", topics: ["business-intelligence", "product-analytics"] },

  // Customer Support
  { url: "https://www.g2.com/products/zendesk-support-suite/reviews", domain: "zendesk.com", topics: ["help-desk", "customer-success", "live-chat"] },
  { url: "https://www.g2.com/products/intercom/reviews", domain: "intercom.com", topics: ["live-chat", "customer-success", "chatbot"] },
  { url: "https://www.g2.com/products/freshdesk/reviews", domain: "freshdesk.com", topics: ["help-desk", "customer-success", "live-chat"] },
  { url: "https://www.g2.com/products/drift/reviews", domain: "drift.com", topics: ["live-chat", "chatbot", "abm"] },

  // Project Management & Collaboration
  { url: "https://www.g2.com/products/slack/reviews", domain: "slack.com", topics: ["collaboration", "video-conferencing"] },
  { url: "https://www.g2.com/products/notion/reviews", domain: "notion.so", topics: ["project-management", "collaboration", "wiki", "document-management"] },
  { url: "https://www.g2.com/products/asana/reviews", domain: "asana.com", topics: ["project-management", "collaboration", "workflow-automation"] },
  { url: "https://www.g2.com/products/monday-com/reviews", domain: "monday.com", topics: ["project-management", "collaboration", "workflow-automation"] },
  { url: "https://www.g2.com/products/linear/reviews", domain: "linear.app", topics: ["project-management", "collaboration"] },
  { url: "https://www.g2.com/products/jira/reviews", domain: "atlassian.com", topics: ["project-management", "collaboration", "ci-cd"] },
  { url: "https://www.g2.com/products/clickup/reviews", domain: "clickup.com", topics: ["project-management", "collaboration", "workflow-automation"] },

  // Product Analytics
  { url: "https://www.g2.com/products/mixpanel/reviews", domain: "mixpanel.com", topics: ["product-analytics", "ab-testing", "session-replay"] },
  { url: "https://www.g2.com/products/amplitude/reviews", domain: "amplitude.com", topics: ["product-analytics", "ab-testing", "feature-flags"] },
  { url: "https://www.g2.com/products/fullstory/reviews", domain: "fullstory.com", topics: ["session-replay", "product-analytics"] },
  { url: "https://www.g2.com/products/hotjar/reviews", domain: "hotjar.com", topics: ["session-replay", "product-analytics"] },
  { url: "https://www.g2.com/products/posthog/reviews", domain: "posthog.com", topics: ["product-analytics", "feature-flags", "session-replay"] },

  // Security
  { url: "https://www.g2.com/products/crowdstrike-falcon/reviews", domain: "crowdstrike.com", topics: ["endpoint-security", "security-operations", "siem"] },
  { url: "https://www.g2.com/products/okta/reviews", domain: "okta.com", topics: ["identity-verification", "security-operations"] },
  { url: "https://www.g2.com/products/splunk-enterprise/reviews", domain: "splunk.com", topics: ["siem", "security-operations", "monitoring"] },
  { url: "https://www.g2.com/products/sentinelone/reviews", domain: "sentinelone.com", topics: ["endpoint-security", "security-operations"] },

  // Cloud & DevOps
  { url: "https://www.g2.com/products/cloudflare/reviews", domain: "cloudflare.com", topics: ["cloud-infrastructure", "security-operations", "api-management"] },
  { url: "https://www.g2.com/products/vercel/reviews", domain: "vercel.com", topics: ["cloud-infrastructure", "ci-cd", "cms"] },
  { url: "https://www.g2.com/products/github/reviews", domain: "github.com", topics: ["ci-cd", "collaboration", "api-management"] },
  { url: "https://www.g2.com/products/circleci/reviews", domain: "circleci.com", topics: ["ci-cd", "cloud-infrastructure"] },

  // Workflow Automation
  { url: "https://www.g2.com/products/zapier/reviews", domain: "zapier.com", topics: ["workflow-automation", "integration-platform", "rpa"] },
  { url: "https://www.g2.com/products/make/reviews", domain: "make.com", topics: ["workflow-automation", "integration-platform"] },
  { url: "https://www.g2.com/products/workato/reviews", domain: "workato.com", topics: ["workflow-automation", "integration-platform", "rpa"] },
  { url: "https://www.g2.com/products/n8n/reviews", domain: "n8n.io", topics: ["workflow-automation", "integration-platform"] },

  // HR & Payroll
  { url: "https://www.g2.com/products/workday-human-capital-management/reviews", domain: "workday.com", topics: ["hr-software", "payroll", "employee-engagement"] },
  { url: "https://www.g2.com/products/bamboohr/reviews", domain: "bamboohr.com", topics: ["hr-software", "ats", "employee-engagement"] },
  { url: "https://www.g2.com/products/rippling/reviews", domain: "rippling.com", topics: ["hr-software", "payroll", "employee-engagement"] },
  { url: "https://www.g2.com/products/gusto/reviews", domain: "gusto.com", topics: ["payroll", "hr-software"] },

  // Messaging & Communication
  { url: "https://www.g2.com/products/twilio/reviews", domain: "twilio.com", topics: ["sms-platform", "voip", "api-management"] },
  { url: "https://www.g2.com/products/sendgrid/reviews", domain: "sendgrid.com", topics: ["email-deliverability", "sms-platform"] },
  { url: "https://www.g2.com/products/ringcentral/reviews", domain: "ringcentral.com", topics: ["voip", "video-conferencing"] },
  { url: "https://www.g2.com/products/zoom/reviews", domain: "zoom.us", topics: ["video-conferencing", "voip"] },

  // Ecommerce
  { url: "https://www.g2.com/products/shopify/reviews", domain: "shopify.com", topics: ["ecommerce-platform", "payment-processing"] },
  { url: "https://www.g2.com/products/woocommerce/reviews", domain: "woocommerce.com", topics: ["ecommerce-platform", "cms"] },

  // Data Integration
  { url: "https://www.g2.com/products/segment/reviews", domain: "segment.com", topics: ["data-integration", "product-analytics"] },
  { url: "https://www.g2.com/products/mongodb-atlas/reviews", domain: "mongodb.com", topics: ["data-warehouse", "cloud-infrastructure"] },
];

interface BrightDataG2Review {
  review_id: string;
  author: string;
  author_id: string;
  position: string;
  company_size: string | null;
  stars: number;
  date: string;
  title: string;
  text: string[];
  url: string;
}

function scoreReview(stars: number, title: string, text: string): number {
  const lower = `${title} ${text}`.toLowerCase();

  const strongSignals = [
    "switching from", "migrated from", "replaced", "alternative",
    "compared to", "evaluated", "chose", "selected", "implemented",
    "integrates with", "use case", "workflow", "roi", "saves time",
    "would recommend", "worth the price",
  ];

  let score = 0.3;

  if (stars >= 4) score += 0.1;
  if (stars === 5) score += 0.1;

  for (const signal of strongSignals) {
    if (lower.includes(signal)) score += 0.1;
  }

  return Math.min(1, score);
}

async function triggerSnapshot(inputs: { url: string; sort_filter: string; start_date: string }[]): Promise<string> {
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
    throw new Error(`Bright Data G2 trigger failed: ${res.status} — ${body}`);
  }

  const data = await res.json() as { snapshot_id: string };
  return data.snapshot_id;
}

async function pollSnapshot(snapshotId: string, maxWaitMs = 600000): Promise<BrightDataG2Review[]> {
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
    if (!res.ok) throw new Error(`Bright Data G2 poll failed: ${res.status}`);

    return res.json() as Promise<BrightDataG2Review[]>;
  }

  throw new Error("Bright Data G2 snapshot timed out");
}

export async function ingestG2BrightData(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const inputs = G2_PRODUCTS.map((p) => ({
    url: p.url,
    sort_filter: "Most Recent",
    start_date: thirtyDaysAgo,
  }));

  try {
    console.error(`[brightdata-g2] Triggering snapshot for ${inputs.length} G2 product pages...`);
    const snapshotId = await triggerSnapshot(inputs);
    console.error(`[brightdata-g2] Snapshot ID: ${snapshotId}, polling...`);

    const reviews = await pollSnapshot(snapshotId);
    console.error(`[brightdata-g2] Got ${reviews.length} reviews`);

    for (const review of reviews) {
      const reviewUrl = review.url || "";
      const productConfig = G2_PRODUCTS.find((p) =>
        reviewUrl.includes(p.url.replace("https://www.g2.com/products/", "").replace("/reviews", ""))
      );
      if (!productConfig) continue;

      const company = getOrCreateCompany(productConfig.domain);
      const textParts = Array.isArray(review.text) ? review.text : [String(review.text || "")];
      const fullText = textParts.join(" ").trim();
      if (!fullText || fullText.length < 20) continue;

      const relevance = scoreReview(review.stars || 3, review.title || "", fullText);
      const timestamp = review.date
        ? new Date(review.date).toISOString()
        : new Date().toISOString();

      const personHint = review.author
        ? `g2: ${review.author}${review.position ? `, ${review.position}` : ""}${review.company_size ? ` (${review.company_size})` : ""}`
        : undefined;

      for (const topic of productConfig.topics) {
        signals.push({
          source: "g2",
          domain: company.canonical_domain,
          topic,
          score: relevance,
          timestamp,
          evidence_url: reviewUrl || productConfig.url,
          evidence_snippet: `G2 Review: ${review.title || ""} — ${fullText.slice(0, 400)}`,
          person_hint: personHint,
        });
      }
    }
  } catch (err) {
    console.error(`[brightdata-g2] Failed: ${(err as Error).message}`);
  }

  return signals;
}