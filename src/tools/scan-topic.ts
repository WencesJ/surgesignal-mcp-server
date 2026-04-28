import { computeSurgeScore } from "../services/scoring-engine.js";
import { resolveCompany, getOrCreateCompany } from "../services/company-resolver.js";
import { getAllSignals, getLastIngestTime } from "../services/signal-store.js";
import { FORTUNE500_BLOCKLIST, SEED_COMPANIES } from "../constants.js";
import type { ScanTopicInput, SurgeScore } from "../schemas/surge.js";

const NON_SAAS_TLDS = new Set([".edu", ".gov", ".mil", ".ac"]);
const NON_SAAS_KEYWORDS = ["university", "college", "hospital", "health", "medical", "bank", "insurance", "financial", "church", "school"];

// Domains that look like vendors but are not
const DOMAIN_BLOCKLIST = new Set([
  "forcedotcom.com",
  "saikatghosh.com",
  "github.io",
  "herokuapp.com",
  "vercel.app",
  "netlify.app",
]);

// Known B2B SaaS vendors — scan_topic shows vendors only, not buyers
const VENDOR_DOMAINS = new Set([
  ...SEED_COMPANIES,
  "pipedrive.com", "zoho.com", "chargebee.com", "recurly.com", "braintree.com",
  "newrelic.com", "grafana.com", "dynatrace.com", "pagerduty.com",
  "databricks.com", "cloud.google.com", "aws.amazon.com", "fivetran.com", "getdbt.com",
  "tableau.com", "looker.com", "powerbi.microsoft.com", "metabase.com",
  "zendesk.com", "intercom.com", "freshdesk.com", "drift.com",
  "notion.so", "asana.com", "monday.com", "linear.app", "atlassian.com", "clickup.com",
  "fullstory.com", "hotjar.com", "posthog.com",
  "crowdstrike.com", "okta.com", "splunk.com", "sentinelone.com",
  "cloudflare.com", "vercel.com", "github.com", "circleci.com",
  "zapier.com", "make.com", "workato.com", "n8n.io",
  "workday.com", "bamboohr.com", "rippling.com", "gusto.com",
  "ringcentral.com", "zoom.us", "shopify.com", "woocommerce.com",
  "supabase.com", "datadog.com", "hubspot.com", "salesforce.com",
  "stripe.com", "twilio.com", "sendgrid.com", "mongodb.com",
]);

function isSaaSDomain(domain: string): boolean {
  if (FORTUNE500_BLOCKLIST.has(domain)) return false;
  if (DOMAIN_BLOCKLIST.has(domain)) return false;
  if (NON_SAAS_TLDS.has("." + domain.split(".").pop())) return false;
  if (NON_SAAS_KEYWORDS.some((kw) => domain.includes(kw))) return false;
  return true;
}

export async function handleScanTopic(params: Partial<ScanTopicInput>) {
  const topic = params.topic || "crm";
  const minScore = params.min_score ?? 0;
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  const allSignals = await getAllSignals();
  const topicSignals = allSignals.filter(
    (s) => s.topic === topic && isSaaSDomain(s.domain) && VENDOR_DOMAINS.has(s.domain)
  );
  const cachedAt = getLastIngestTime();

  const domainSet = new Set<string>();
  for (const s of topicSignals) {
    domainSet.add(s.domain);
  }

  const scored: SurgeScore[] = [];

  for (const domain of domainSet) {
    const company = resolveCompany(domain) || getOrCreateCompany(domain);
    const signals = topicSignals.filter((s) => s.domain === domain);

    const score = computeSurgeScore(
      company.canonical_domain,
      topic,
      company.display_name,
      signals,
      cachedAt,
    );

    if (score.surge_score >= minScore && score.total_signals > 0) {
      scored.push(score);
    }
  }
  
  scored.sort((a, b) => b.surge_score - a.surge_score);

  const total = scored.length;
  const page = scored.slice(offset, offset + limit);

  return {
    topic,
    total,
    count: page.length,
    offset,
    has_more: offset + limit < total,
    companies: page,
  };
}