import type { RawSignal } from "../../schemas/surge.js";
import { getOrCreateCompany, normalizeDomain } from "../company-resolver.js";
import type { CoveredTopic } from "../../constants.js";

const USER_AGENT = "SurgeSignal/1.0 (intent-data-aggregator)";

const G2_CATEGORY_MAP: Record<string, CoveredTopic[]> = {
  "crm": ["crm", "sales-engagement"],
  "marketing-automation": ["marketing-automation", "abm"],
  "data-integration-suites": ["data-integration", "etl"],
  "business-intelligence": ["business-intelligence", "product-analytics"],
  "help-desk": ["help-desk", "customer-success", "live-chat"],
  "project-management": ["project-management", "collaboration"],
  "endpoint-protection-suites": ["endpoint-security", "security-operations"],
  "payment-processing": ["payment-processing", "ecommerce-platform"],
  "it-infrastructure-monitoring": ["monitoring", "cloud-infrastructure"],
  "integration-platform-as-a-service-ipaas": ["workflow-automation", "integration-platform"],
};

const DOMAIN_PATTERN = /\b([a-z0-9-]+\.(com|io|co|ai|dev|app|so|org|net))\b/gi;

const BLOCKED_DOMAINS = new Set([
  "github.com", "google.com", "youtube.com", "linkedin.com",
  "facebook.com", "twitter.com", "x.com", "medium.com",
  "apple.com", "microsoft.com", "amazon.com", "g2.com",
  "capterra.com", "trustradius.com", "gartner.com",
  "cloudflare-dns.com", "cloudflare.com", "googleapis.com",
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractProductsFromHTML(html: string): Array<{
  name: string;
  rating: number;
  reviewCount: number;
  url: string;
}> {
  const products: Array<{ name: string; rating: number; reviewCount: number; url: string }> = [];

  const productPattern = /"name"\s*:\s*"([^"]+)"/g;
  const ratingPattern = /"ratingValue"\s*:\s*"?([0-9.]+)"?/g;
  const reviewPattern = /"reviewCount"\s*:\s*"?([0-9]+)"?/g;
  const urlPattern = /"url"\s*:\s*"(https:\/\/www\.g2\.com\/products\/[^"]+)"/g;

  const names: string[] = [];
  const ratings: number[] = [];
  const reviews: number[] = [];
  const urls: string[] = [];

  let match;
  while ((match = productPattern.exec(html)) !== null) names.push(match[1]);
  while ((match = ratingPattern.exec(html)) !== null) ratings.push(parseFloat(match[1]));
  while ((match = reviewPattern.exec(html)) !== null) reviews.push(parseInt(match[1]));
  while ((match = urlPattern.exec(html)) !== null) urls.push(match[1]);

  for (let i = 0; i < names.length; i++) {
    products.push({
      name: names[i],
      rating: ratings[i] || 0,
      reviewCount: reviews[i] || 0,
      url: urls[i] || "",
    });
  }

  return products;
}

async function fetchG2Category(category: string): Promise<Array<{
  name: string;
  rating: number;
  reviewCount: number;
  url: string;
}>> {
  const url = `https://www.g2.com/categories/${category}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html",
    },
  });

  if (!res.ok) {
    throw new Error(`Status ${res.status}`);
  }

  const html = await res.text();
  return extractProductsFromHTML(html);
}

export async function ingestG2Free(): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const categories = Object.keys(G2_CATEGORY_MAP);

  for (const category of categories) {
    try {
      const products = await fetchG2Category(category);
      const topics = G2_CATEGORY_MAP[category];
      if (!topics) continue;

      for (const product of products) {
        if (product.reviewCount < 5) continue;

        const productSlug = product.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        const domains = extractDomains(product.url + " " + product.name);
        const company = domains.length > 0
          ? getOrCreateCompany(domains[0])
          : getOrCreateCompany(`${productSlug}.com`, product.name);

        const recencyBoost = product.reviewCount > 100 ? 0.2 : 0;
        const ratingBoost = product.rating >= 4.5 ? 0.15 : product.rating >= 4.0 ? 0.1 : 0;
        const relevance = Math.min(1, 0.4 + recencyBoost + ratingBoost);

        for (const topic of topics) {
          signals.push({
            source: "g2",
            domain: company.canonical_domain,
            topic,
            score: relevance,
            timestamp: new Date().toISOString(),
            evidence_url: product.url || `https://www.g2.com/categories/${category}`,
            evidence_snippet: `${product.name}: ${product.rating} stars, ${product.reviewCount} reviews on G2`,
          });
        }
      }
    } catch (err) {
      console.error(`Failed to fetch G2 category "${category}":`, (err as Error).message);
    }

    await delay(3000);
  }

  return signals;
}
