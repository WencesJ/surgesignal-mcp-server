export const REDIS_KEY_PREFIX = "surge:";
export const REDIS_SIGNAL_PREFIX = "signal:";
export const REDIS_COMPANY_PREFIX = "company:";

export const SURGE_THRESHOLD = 60;
export const SURGE_MAX = 100;
export const SURGE_MIN = 0;

export const SIGNAL_SOURCES = [
  "reddit",
  "linkedin",
  "g2",
  "jobs",
  "news",
  "github",
] as const;

export type SignalSource = (typeof SIGNAL_SOURCES)[number];

export const SOURCE_WEIGHTS: Record<SignalSource, number> = {
  reddit: 0.20,
  linkedin: 0.15,
  g2: 0.20,
  jobs: 0.20,
  news: 0.10,
  github: 0.15,
};

// Active weights (excluding disabled sources) must sum to 1.0.
// reddit 0.25 + g2 0.25 + jobs 0.25 + news 0.15 + github 0.10 = 1.0

export const RECENCY_DECAY_HOURS = 168;

export const CACHE_TTL_SURGE = 3600;
export const CACHE_TTL_SIGNAL = 7200;

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