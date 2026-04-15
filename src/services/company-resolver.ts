export interface CompanyIdentity {
  canonical_domain: string;
  display_name: string;
  aliases: string[];
  linkedin_slug?: string;
  github_org?: string;
}

const SUFFIXES_TO_STRIP = [
  "inc", "inc.", "incorporated", "corp", "corp.", "corporation",
  "llc", "l.l.c.", "ltd", "ltd.", "limited", "co", "co.",
  "gmbh", "ag", "sa", "bv", "nv", "plc", "pty", "pvt",
  "technologies", "technology", "software", "solutions", "systems",
  "group", "holdings", "international", "global",
];

export function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  d = d.replace(/\/.*$/, "");
  d = d.replace(/:\d+$/, "");
  return d;
}

export function normalizeCompanyName(raw: string): string {
  let name = raw.trim().toLowerCase();
  name = name.replace(/[^a-z0-9\s-]/g, "");
  const words = name.split(/\s+/);
  const filtered = words.filter((w) => !SUFFIXES_TO_STRIP.includes(w));
  return filtered.join(" ").trim();
}

export function deriveCompanyName(domain: string): string {
  const normalized = normalizeDomain(domain);
  const base = normalized.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function deriveLinkedInSlug(domain: string): string {
  const normalized = normalizeDomain(domain);
  return normalized.split(".")[0];
}

export function deriveGitHubOrg(domain: string): string {
  const normalized = normalizeDomain(domain);
  return normalized.split(".")[0];
}

const companyMap = new Map<string, CompanyIdentity>();
const aliasIndex = new Map<string, string>();

export function registerCompany(identity: CompanyIdentity): void {
  const domain = normalizeDomain(identity.canonical_domain);
  companyMap.set(domain, { ...identity, canonical_domain: domain });

  for (const alias of identity.aliases) {
    aliasIndex.set(normalizeCompanyName(alias), domain);
  }
  aliasIndex.set(normalizeCompanyName(identity.display_name), domain);
  aliasIndex.set(domain, domain);

  if (identity.linkedin_slug) {
    aliasIndex.set(identity.linkedin_slug.toLowerCase(), domain);
  }
  if (identity.github_org) {
    aliasIndex.set(identity.github_org.toLowerCase(), domain);
  }
}

export function resolveCompany(input: string): CompanyIdentity | null {
  const asDomain = normalizeDomain(input);
  if (companyMap.has(asDomain)) {
    return companyMap.get(asDomain)!;
  }

  const asName = normalizeCompanyName(input);
  const resolved = aliasIndex.get(asName);
  if (resolved) {
    return companyMap.get(resolved) ?? null;
  }

  return null;
}

export function getOrCreateCompany(domain: string, displayName?: string): CompanyIdentity {
  const normalized = normalizeDomain(domain);
  const existing = companyMap.get(normalized);
  if (existing) return existing;

  const identity: CompanyIdentity = {
    canonical_domain: normalized,
    display_name: displayName ?? deriveCompanyName(domain),
    aliases: [],
  };
  registerCompany(identity);
  return identity;
}

export function getAllCompanies(): CompanyIdentity[] {
  return Array.from(companyMap.values());
}

const SEED_COMPANIES: CompanyIdentity[] = [
  { canonical_domain: "stripe.com", display_name: "Stripe", aliases: ["stripe inc", "stripe payments"], linkedin_slug: "stripe-inc", github_org: "stripe" },
  { canonical_domain: "datadog.com", display_name: "Datadog", aliases: ["datadog inc"], linkedin_slug: "datadog", github_org: "DataDog" },
  { canonical_domain: "snowflake.com", display_name: "Snowflake", aliases: ["snowflake inc", "snowflake computing"], linkedin_slug: "snowflakecorp", github_org: "snowflakedb" },
  { canonical_domain: "hubspot.com", display_name: "HubSpot", aliases: ["hubspot inc"], linkedin_slug: "hubspotinc", github_org: "HubSpot" },
  { canonical_domain: "salesforce.com", display_name: "Salesforce", aliases: ["salesforce inc", "salesforce.com inc"], linkedin_slug: "salesforce", github_org: "salesforce" },
  { canonical_domain: "twilio.com", display_name: "Twilio", aliases: ["twilio inc"], linkedin_slug: "twilio", github_org: "twilio" },
  { canonical_domain: "slack.com", display_name: "Slack", aliases: ["slack technologies"], linkedin_slug: "slack", github_org: "slackapi" },
  { canonical_domain: "notion.so", display_name: "Notion", aliases: ["notion labs", "notion labs inc"], linkedin_slug: "notion", github_org: "makenotion" },
  { canonical_domain: "figma.com", display_name: "Figma", aliases: ["figma inc"], linkedin_slug: "figma", github_org: "figma" },
  { canonical_domain: "vercel.com", display_name: "Vercel", aliases: ["vercel inc"], linkedin_slug: "vercel", github_org: "vercel" },
  { canonical_domain: "supabase.com", display_name: "Supabase", aliases: ["supabase inc"], linkedin_slug: "supabase", github_org: "supabase" },
  { canonical_domain: "linear.app", display_name: "Linear", aliases: ["linear inc"], linkedin_slug: "linear-app", github_org: "linear" },
  { canonical_domain: "amplitude.com", display_name: "Amplitude", aliases: ["amplitude inc"], linkedin_slug: "amplitude", github_org: "amplitude" },
  { canonical_domain: "segment.com", display_name: "Segment", aliases: ["segment io", "twilio segment"], linkedin_slug: "segment", github_org: "segmentio" },
  { canonical_domain: "mixpanel.com", display_name: "Mixpanel", aliases: ["mixpanel inc"], linkedin_slug: "mixpanel", github_org: "mixpanel" },
  { canonical_domain: "intercom.com", display_name: "Intercom", aliases: ["intercom inc"], linkedin_slug: "intercom-software", github_org: "intercom" },
  { canonical_domain: "zendesk.com", display_name: "Zendesk", aliases: ["zendesk inc"], linkedin_slug: "zendesk", github_org: "zendesk" },
  { canonical_domain: "mongodb.com", display_name: "MongoDB", aliases: ["mongodb inc"], linkedin_slug: "mongodbinc", github_org: "mongodb" },
  { canonical_domain: "elastic.co", display_name: "Elastic", aliases: ["elastic nv", "elasticsearch"], linkedin_slug: "elastic-co", github_org: "elastic" },
  { canonical_domain: "grafana.com", display_name: "Grafana Labs", aliases: ["grafana labs"], linkedin_slug: "grafana-labs", github_org: "grafana" },
];

export function seedCompanies(): void {
  for (const company of SEED_COMPANIES) {
    registerCompany(company);
  }
}