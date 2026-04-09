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
    display_name: displayName ?? normalized.split(".")[0],
    aliases: [],
  };
  registerCompany(identity);
  return identity;
}

export function getAllCompanies(): CompanyIdentity[] {
  return Array.from(companyMap.values());
}

const SEED_COMPANIES: CompanyIdentity[] = [
  { canonical_domain: "stripe.com", display_name: "Stripe", aliases: ["stripe inc", "stripe payments"], github_org: "stripe" },
  { canonical_domain: "datadog.com", display_name: "Datadog", aliases: ["datadog inc"], github_org: "DataDog" },
  { canonical_domain: "snowflake.com", display_name: "Snowflake", aliases: ["snowflake inc", "snowflake computing"], github_org: "snowflakedb" },
  { canonical_domain: "hubspot.com", display_name: "HubSpot", aliases: ["hubspot inc"], github_org: "HubSpot" },
  { canonical_domain: "salesforce.com", display_name: "Salesforce", aliases: ["salesforce inc", "salesforce.com inc"], github_org: "salesforce" },
  { canonical_domain: "twilio.com", display_name: "Twilio", aliases: ["twilio inc"], github_org: "twilio" },
  { canonical_domain: "slack.com", display_name: "Slack", aliases: ["slack technologies"], github_org: "slackapi" },
  { canonical_domain: "notion.so", display_name: "Notion", aliases: ["notion labs", "notion labs inc"], github_org: "makenotion" },
  { canonical_domain: "figma.com", display_name: "Figma", aliases: ["figma inc"], github_org: "figma" },
  { canonical_domain: "vercel.com", display_name: "Vercel", aliases: ["vercel inc"], github_org: "vercel" },
  { canonical_domain: "supabase.com", display_name: "Supabase", aliases: ["supabase inc"], github_org: "supabase" },
  { canonical_domain: "linear.app", display_name: "Linear", aliases: ["linear inc"], github_org: "linear" },
  { canonical_domain: "amplitude.com", display_name: "Amplitude", aliases: ["amplitude inc"], github_org: "amplitude" },
  { canonical_domain: "segment.com", display_name: "Segment", aliases: ["segment io", "twilio segment"], github_org: "segmentio" },
  { canonical_domain: "mixpanel.com", display_name: "Mixpanel", aliases: ["mixpanel inc"], github_org: "mixpanel" },
  { canonical_domain: "intercom.com", display_name: "Intercom", aliases: ["intercom inc"], github_org: "intercom" },
  { canonical_domain: "zendesk.com", display_name: "Zendesk", aliases: ["zendesk inc"], github_org: "zendesk" },
  { canonical_domain: "mongodb.com", display_name: "MongoDB", aliases: ["mongodb inc"], github_org: "mongodb" },
  { canonical_domain: "elastic.co", display_name: "Elastic", aliases: ["elastic nv", "elasticsearch"], github_org: "elastic" },
  { canonical_domain: "grafana.com", display_name: "Grafana Labs", aliases: ["grafana labs"], github_org: "grafana" },
];

export function seedCompanies(): void {
  for (const company of SEED_COMPANIES) {
    registerCompany(company);
  }
}