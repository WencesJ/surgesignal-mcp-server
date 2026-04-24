export const REDIS_KEY_PREFIX = "surge:";
export const REDIS_SIGNAL_PREFIX = "signal:";
export const REDIS_COMPANY_PREFIX = "company:";

export const SURGE_THRESHOLD = 60;
export const SURGE_MAX = 100;
export const SURGE_MIN = 0;

export const SIGNAL_SOURCES = [
  "reddit",
  "linkedin",
  "hackernews",
  "jobs",
  "github",
  "g2",
] as const;

export type SignalSource = (typeof SIGNAL_SOURCES)[number];

export const SOURCE_WEIGHTS: Record<SignalSource, number> = {
  reddit: 0.20,
  linkedin: 0.15,
  hackernews: 0.10,
  jobs: 0.20,
  github: 0.15,
  g2: 0.20,
};

export const RECENCY_DECAY_HOURS = 168;

export const CACHE_TTL_SURGE = 3600;
export const CACHE_TTL_SIGNAL = 10800;

export const CHARACTER_LIMIT = 50_000;
export const DEFAULT_SCAN_LIMIT = 20;
export const MAX_SCAN_LIMIT = 100;

export const COVERED_TOPICS = [
  "crm", "marketing-automation", "sales-engagement", "abm",
  "data-integration", "etl", "data-warehouse", "business-intelligence",
  "product-analytics", "session-replay", "ab-testing", "feature-flags",
  "customer-success", "help-desk", "live-chat", "chatbot",
  "project-management", "collaboration", "document-management", "wiki",
  "hr-software", "ats", "payroll", "employee-engagement",
  "accounting", "expense-management", "billing", "subscription-management",
  "ecommerce-platform", "payment-processing", "fraud-detection", "identity-verification",
  "cloud-infrastructure", "container-orchestration", "ci-cd", "monitoring",
  "security-operations", "siem", "endpoint-security", "vulnerability-management",
  "api-management", "integration-platform", "workflow-automation", "rpa",
  "video-conferencing", "voip", "email-deliverability", "sms-platform",
  "cms", "design-tools",
] as const;

export type CoveredTopic = (typeof COVERED_TOPICS)[number];

export const TOPIC_KEYWORDS: Record<CoveredTopic, string[]> = {
  "crm": ["crm", "customer relationship", "salesforce", "hubspot", "pipeline", "contact management", "lead management", "deal tracking", "sales pipeline", "account management"],
  "marketing-automation": ["marketing automation", "email campaign", "lead nurturing", "drip campaign", "marketo", "pardot", "klaviyo", "mailchimp", "automation workflow", "marketing platform"],
  "sales-engagement": ["sales engagement", "outreach", "salesloft", "sales cadence", "cold email", "prospecting", "sales sequence", "sdr", "bdr", "sales development"],
  "abm": ["account-based marketing", "abm", "target account", "intent data", "account targeting", "b2b marketing", "account intelligence", "demandbase", "terminus", "6sense"],
  "data-integration": ["data integration", "etl pipeline", "data pipeline", "fivetran", "stitch", "airbyte", "data sync", "connector", "data ingestion", "integration platform"],
  "etl": ["etl", "extract transform load", "data pipeline", "data warehouse", "dbt", "airflow", "data transformation", "batch processing", "data flow", "data movement"],
  "data-warehouse": ["data warehouse", "snowflake", "bigquery", "redshift", "databricks", "data lake", "analytical database", "columnar storage", "cloud warehouse", "data platform", "lakehouse", "delta lake", "iceberg", "clickhouse", "olap", "dbt", "data vault"],
  "business-intelligence": ["business intelligence", "bi tool", "dashboard", "tableau", "power bi", "looker", "metabase", "reporting", "data visualization", "analytics platform"],
  "product-analytics": ["product analytics", "mixpanel", "amplitude", "heap", "user behavior", "funnel analysis", "retention", "cohort", "event tracking", "product metrics"],
  "session-replay": ["session replay", "heatmap", "hotjar", "fullstory", "mouseflow", "ux recording", "user session", "click tracking", "scroll map", "user recording"],
  "ab-testing": ["a/b testing", "ab test", "split test", "experimentation", "optimizely", "vwo", "feature experiment", "conversion optimization", "multivariate", "hypothesis test"],
  "feature-flags": ["feature flag", "feature toggle", "launchdarkly", "split.io", "feature rollout", "canary release", "dark launch", "progressive delivery", "flag management", "feature gate"],
  "customer-success": ["customer success", "churn", "retention", "gainsight", "totango", "customer health", "onboarding", "nps", "customer engagement", "renewal"],
  "help-desk": ["help desk", "ticketing", "zendesk", "freshdesk", "support ticket", "customer support", "service desk", "support platform", "issue tracking", "customer service"],
  "live-chat": ["live chat", "intercom", "drift", "crisp", "chat widget", "website chat", "real-time support", "messaging", "chat support", "in-app chat"],
  "chatbot": ["chatbot", "conversational ai", "bot", "virtual agent", "automated response", "nlp", "dialogue flow", "chatgpt integration", "ai assistant", "chat automation"],
  "project-management": ["project management", "jira", "asana", "monday.com", "trello", "linear", "task management", "sprint", "agile", "kanban"],
  "collaboration": ["collaboration", "slack", "teams", "notion", "confluence", "team workspace", "async communication", "knowledge sharing", "team productivity", "remote work"],
  "document-management": ["document management", "dms", "docusign", "sharepoint", "document storage", "file management", "document workflow", "e-signature", "document automation", "contract management"],
  "wiki": ["wiki", "knowledge base", "confluence", "notion", "internal docs", "documentation", "knowledge management", "company wiki", "team handbook", "information hub"],
  "hr-software": ["hr software", "hris", "workday", "bamboohr", "human resources", "people management", "hr platform", "employee management", "workforce management", "people ops"],
  "ats": ["applicant tracking", "ats", "recruiting software", "greenhouse", "lever", "hiring platform", "talent acquisition", "job application", "recruitment", "candidate pipeline"],
  "payroll": ["payroll", "gusto", "adp", "rippling", "payroll software", "wage processing", "payroll automation", "tax filing", "compensation management", "payroll platform"],
  "employee-engagement": ["employee engagement", "culture amp", "lattice", "15five", "employee feedback", "pulse survey", "performance review", "okr", "employee satisfaction", "engagement platform"],
  "accounting": ["accounting", "quickbooks", "xero", "sage", "general ledger", "accounts payable", "accounts receivable", "financial reporting", "bookkeeping", "accounting software"],
  "expense-management": ["expense management", "expensify", "concur", "ramp", "brex", "spend management", "expense report", "corporate card", "receipt tracking", "reimbursement"],
  "billing": ["billing", "invoicing", "chargebee", "zuora", "stripe billing", "invoice automation", "subscription billing", "revenue recognition", "payment collection", "billing platform"],
  "subscription-management": ["subscription management", "recurly", "chargebee", "zuora", "subscription billing", "recurring revenue", "mrr", "arr", "subscriber management", "subscription platform"],
  "ecommerce-platform": ["ecommerce", "shopify", "woocommerce", "magento", "online store", "shopping cart", "storefront", "product catalog", "checkout", "ecommerce platform"],
  "payment-processing": ["payment processing", "payment gateway", "stripe", "paypal", "braintree", "adyen", "checkout", "transaction", "merchant account", "payment api"],
  "fraud-detection": ["fraud detection", "fraud prevention", "sift", "kount", "chargeback", "risk scoring", "transaction monitoring", "identity fraud", "account takeover", "fraud analytics"],
  "identity-verification": ["identity verification", "kyc", "know your customer", "id verification", "onfido", "jumio", "document verification", "biometric", "aml", "compliance verification"],
  "cloud-infrastructure": ["cloud infrastructure", "aws", "azure", "gcp", "cloud computing", "iaas", "virtual machine", "cloud provider", "infrastructure as code", "cloud platform"],
  "container-orchestration": ["kubernetes", "k8s", "docker", "container orchestration", "eks", "aks", "gke", "helm", "pod", "container platform"],
  "ci-cd": ["ci/cd", "continuous integration", "continuous deployment", "github actions", "jenkins", "circleci", "deployment pipeline", "devops", "build automation", "release pipeline"],
  "monitoring": ["monitoring", "observability", "datadog", "new relic", "newrelic", "grafana", "prometheus", "alerting", "apm", "log management", "infrastructure monitoring", "uptime", "metrics", "tracing", "opentelemetry", "dynatrace", "pagerduty", "incident management", "dashboards", "logging"],
  "security-operations": ["security operations", "soc", "threat detection", "incident response", "security monitoring", "splunk", "security platform", "threat hunting", "security analytics", "cyber threat"],
  "siem": ["siem", "security information", "event management", "log analysis", "threat intelligence", "security correlation", "splunk", "ibm qradar", "microsoft sentinel", "security events"],
  "endpoint-security": ["endpoint security", "edr", "antivirus", "crowdstrike", "sentinelone", "endpoint protection", "malware detection", "threat prevention", "device security", "endpoint detection"],
  "vulnerability-management": ["vulnerability management", "vulnerability scanner", "tenable", "qualys", "rapid7", "cve", "patch management", "security scanning", "penetration testing", "risk assessment"],
  "api-management": ["api management", "api gateway", "apigee", "kong", "mulesoft", "api platform", "rest api", "graphql", "developer portal", "api security"],
  "integration-platform": ["integration platform", "ipaas", "zapier", "make", "workato", "mulesoft", "middleware", "system integration", "data connector", "workflow integration"],
  "workflow-automation": ["workflow automation", "process automation", "zapier", "make", "n8n", "robotic process", "business process", "automation platform", "no-code automation", "workflow builder"],
  "rpa": ["rpa", "robotic process automation", "uipath", "automation anywhere", "blue prism", "bot automation", "process robot", "attended automation", "unattended automation", "desktop automation"],
  "video-conferencing": ["video conferencing", "zoom", "teams", "google meet", "webex", "video call", "virtual meeting", "online meeting", "webinar", "video platform"],
  "voip": ["voip", "voice over ip", "business phone", "aircall", "ringcentral", "dialpad", "cloud phone", "sip", "pbx", "phone system"],
  "email-deliverability": ["email deliverability", "sendgrid", "mailgun", "postmark", "email infrastructure", "email reputation", "spam filter", "inbox placement", "email api", "transactional email"],
  "sms-platform": ["sms platform", "twilio", "messagebird", "vonage", "text messaging", "sms api", "bulk sms", "sms marketing", "mobile messaging", "sms gateway"],
  "cms": ["cms", "content management", "wordpress", "contentful", "sanity", "strapi", "headless cms", "content platform", "website builder", "content editor"],
  "design-tools": ["design tools", "figma", "sketch", "adobe xd", "canva", "ui design", "ux design", "prototyping", "design system", "vector graphics"],
};

export const B2B_SUBREDDIT_WHITELIST = new Set([
  "sales", "marketing", "b2bmarketing", "sales_advice", "salestechniques",
  "salesforce", "hubspot", "marketo", "outreach", "salesloft",
  "demandgeneration", "leadgeneration", "emailmarketing", "contentmarketing",
  "growthhacking", "digitalmarketing", "ppc", "seo",
  "saas", "startups", "entrepreneur", "smallbusiness", "business",
  "productmanagement", "product_management", "producthunt",
  "entrepreneurship", "indiehackers", "nocode", "lowcode",
  "programming", "softwaredevelopment", "software", "webdev", "devops",
  "kubernetes", "docker", "aws", "googlecloud", "azure", "cloudcomputing",
  "dataengineering", "datascience", "machinelearning", "artificialintelligence",
  "openai", "chatgpt", "llm", "python", "javascript", "typescript", "golang",
  "rust", "java", "dotnet", "reactjs", "node", "postgresql", "mysql",
  "mongodb", "redis", "elasticsearch", "kafka", "spark", "dbt", "airflow",
  "github", "gitlab", "cicd", "sre", "platform_engineering",
  "fintech", "payments", "stripe", "paypal", "banking", "finance",
  "cryptocurrency", "defi", "investing", "accounting", "quickbooks",
  "netsec", "cybersecurity", "netsecurity", "sysadmin", "homelab",
  "crowdstrike", "splunk", "paloalto",
  "humanresources", "remotework", "wfh", "recruiting", "hiring",
  "careerguidance", "cscareerquestions",
  "customersuccess", "crm", "zendesk", "intercom",
  "analytics", "businessintelligence", "tableau", "powerbi", "looker",
  "snowflake", "databricks", "bigquery",
  "consulting", "management", "projectmanagement", "agile", "scrum",
  "productivity", "tools", "techsupport", "msp",
  "slack", "notion", "asana", "jira", "confluence", "atlassian",
  "datadog", "newrelic", "grafana", "prometheus",
  "shopify", "woocommerce", "ecommerce",
  "twilio", "sendgrid", "mailchimp",
  "workday", "bamboohr", "gusto", "rippling",
]);

export const SEED_COMPANIES = [
  "salesforce.com",
  "hubspot.com",
  "stripe.com",
  "datadog.com",
  "zendesk.com",
  "intercom.com",
  "notion.so",
  "slack.com",
  "asana.com",
  "monday.com",
  "linear.app",
  "mixpanel.com",
  "amplitude.com",
  "segment.com",
  "twilio.com",
  "sendgrid.com",
  "cloudflare.com",
  "vercel.com",
  "snowflake.com",
  "mongodb.com",
] as const;

export type SeedCompany = (typeof SEED_COMPANIES)[number];

export const FORTUNE500_BLOCKLIST = new Set([
  "capitalone.com", "generalmotors.com", "cvshealth.com", "blackveatch.com",
  "deloitte.com", "ey.com", "pwc.com", "kpmg.com", "mckinsey.com", "bcg.com",
  "accenture.com", "ibm.com", "oracle.com", "sap.com", "cisco.com",
  "intel.com", "hp.com", "dell.com", "walmart.com", "target.com",
  "homedepot.com", "lowes.com", "costco.com", "kroger.com", "walgreens.com",
  "unitedhealth.com", "anthem.com", "cigna.com", "aetna.com", "humana.com",
  "jpmorgan.com", "bankofamerica.com", "wellsfargo.com", "citigroup.com",
  "goldmansachs.com", "morganstanley.com", "blackrock.com", "fidelity.com",
  "verizon.com", "att.com", "tmobile.com", "comcast.com", "charter.com",
  "exxon.com", "chevron.com", "bp.com", "shell.com", "conocophillips.com",
  "boeing.com", "lockheedmartin.com", "raytheon.com", "generaldynamics.com",
  "ford.com", "gm.com", "stellantis.com", "toyota.com", "honda.com",
  "johnson.com", "pfizer.com", "abbvie.com", "merck.com", "bristolmyers.com",
  "ups.com", "fedex.com", "dhl.com", "usps.com",
  "mcdonalds.com", "starbucks.com", "yum.com", "restaurant.com",
  "disney.com", "comcastnbcuniversal.com", "warnerbrosdiscovery.com",
  "newscorp.com", "foxcorp.com", "nytimes.com", "wsj.com",
  "ge.com", "3m.com", "honeywell.com", "caterpillar.com", "deere.com",
]);