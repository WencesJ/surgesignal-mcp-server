import type { RawSignal } from "../schemas/surge.js";
import type { SignalSource } from "../constants.js";
import type { CoveredTopic } from "../constants.js";
import { REDIS_SIGNAL_PREFIX, CACHE_TTL_SIGNAL, COVERED_TOPICS } from "../constants.js";
import { getRedis, isRedisAvailable } from "./redis.js";
import { getOrCreateCompany } from "./company-resolver.js";
import { ingestRedditRSS, searchRedditForCompany } from "./ingestors/reddit-rss.js";
import { ingestGitHub, searchGitHubForCompany } from "./ingestors/github.js";
import { ingestAdzuna, searchJobsForCompany } from "./ingestors/adzuna.js";
import { ingestHackerNews, searchHNForCompany } from "./ingestors/hackernews.js";
import { ingestG2BrightData } from "./ingestors/g2.js";

let memorySignals: RawSignal[] = [];
let lastIngestAt: number = 0;
let useRedis: boolean = false;

function signalKey(domain: string, topic: string): string {
  return `${REDIS_SIGNAL_PREFIX}${domain}:${topic}`;
}

function allSignalsKey(): string {
  return `${REDIS_SIGNAL_PREFIX}all`;
}

function metaKey(): string {
  return `${REDIS_SIGNAL_PREFIX}meta:last_ingest`;
}

async function storeSignalsInRedis(signals: RawSignal[]): Promise<void> {
  const redis = getRedis();
  const pipeline = redis.pipeline();

  const byDomainTopic = new Map<string, RawSignal[]>();
  for (const signal of signals) {
    const key = signalKey(signal.domain, signal.topic);
    const arr = byDomainTopic.get(key) || [];
    arr.push(signal);
    byDomainTopic.set(key, arr);
  }

  for (const [key, sigs] of byDomainTopic) {
    pipeline.set(key, JSON.stringify(sigs), "EX", CACHE_TTL_SIGNAL);
  }

  pipeline.set(allSignalsKey(), JSON.stringify(signals), "EX", CACHE_TTL_SIGNAL);
  pipeline.set(metaKey(), String(Date.now()));

  await pipeline.exec();
}

async function getSignalsFromRedis(key: string): Promise<RawSignal[]> {
  const redis = getRedis();
  const raw = await redis.get(key);
  if (!raw) return [];
  return JSON.parse(raw) as RawSignal[];
}

function getTopicsForDomain(topic: string): CoveredTopic[] {
  if (COVERED_TOPICS.includes(topic as CoveredTopic)) {
    return [topic as CoveredTopic];
  }
  return ["crm"] as CoveredTopic[];
}

async function fanOutForDomain(domain: string, topic: string): Promise<RawSignal[]> {
  const company = getOrCreateCompany(domain);
  const companyName = company.display_name;
  const topics = getTopicsForDomain(topic);

  console.error(`[fan-out] Cache miss for ${domain}:${topic}, running dynamic lookup for "${companyName}"...`);

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Fan-out timeout after 40s")), 40000)
  );

  try {
    const searchPromise = (async () => {
      const results: RawSignal[] = [];

      const sources: { name: string; fn: () => Promise<RawSignal[]> }[] = [
        { name: "reddit", fn: () => searchRedditForCompany(companyName, domain, topics) },
        { name: "hackernews", fn: () => searchHNForCompany(companyName, domain, topics) },
        { name: "jobs", fn: () => searchJobsForCompany(companyName, domain, topics) },
        { name: "github", fn: () => searchGitHubForCompany(companyName, domain, topics) },
      ];

      for (const { name, fn } of sources) {
        const start = Date.now();
        try {
          const signals = await fn();
          results.push(...signals);
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          console.error(`  [fan-out] ${name}: ${signals.length} signals (${elapsed}s)`);
        } catch (err) {
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          console.error(`  [fan-out] ${name}: FAILED (${elapsed}s) - ${(err as Error).message}`);
        }
      }

      return results;
    })();

    const dynamicSignals = await Promise.race([searchPromise, timeout]);

    memorySignals = [...memorySignals, ...dynamicSignals];
    lastIngestAt = Date.now();

    if (useRedis) {
      const key = signalKey(domain, topic);
      const filtered = dynamicSignals.filter((s) => s.domain === domain && s.topic === topic);
      if (filtered.length > 0) {
        const redis = getRedis();
        await redis.set(key, JSON.stringify(filtered), "EX", CACHE_TTL_SIGNAL);
      }
    }

    return dynamicSignals.filter((s) => s.domain === domain && s.topic === topic);
  } catch (err) {
    console.error(`[fan-out] ${(err as Error).message}`);
    return [];
  }
}

export function getLastIngestTime(): number {
  return lastIngestAt;
}

export async function getAllSignals(): Promise<RawSignal[]> {
  if (useRedis) {
    return getSignalsFromRedis(allSignalsKey());
  }
  return memorySignals;
}

export async function getSignalsForDomainTopic(domain: string, topic: string): Promise<RawSignal[]> {
  if (useRedis) {
    const all = await getSignalsFromRedis(allSignalsKey());
    if (all.length > 0) {
      const filtered = all.filter((s) => s.domain === domain && s.topic === topic);
      if (filtered.length > 0) return filtered;
    } else {
      const cached = await getSignalsFromRedis(signalKey(domain, topic));
      if (cached.length > 0) return cached;
    }
  } else {
    const cached = memorySignals.filter((s) => s.domain === domain && s.topic === topic);
    if (cached.length > 0) return cached;
  }

  return await fanOutForDomain(domain, topic);
}

export async function getSignalsForTopic(topic: string): Promise<RawSignal[]> {
  if (useRedis) {
    const all = await getSignalsFromRedis(allSignalsKey());
    return all.filter((s) => s.topic === topic);
  }
  return memorySignals.filter((s) => s.topic === topic);
}

export async function getUniqueDomainsByTopic(topic: string): Promise<string[]> {
  const signals = await getSignalsForTopic(topic);
  const domains = new Set<string>();
  for (const s of signals) {
    domains.add(s.domain);
  }
  return Array.from(domains);
}

async function runSequentialIngestors(): Promise<{ allSignals: RawSignal[]; bySources: Record<string, number> }> {
  const ingestors: { name: string; fn: () => Promise<RawSignal[]> }[] = [
    { name: "reddit", fn: ingestRedditRSS },
    { name: "github", fn: ingestGitHub },
    { name: "jobs", fn: ingestAdzuna },
    { name: "hackernews", fn: ingestHackerNews },
    { name: "g2", fn: ingestG2BrightData },
  ];

  const allSignals: RawSignal[] = [];
  const bySources: Record<string, number> = {};

  for (const { name, fn } of ingestors) {
    const start = Date.now();
    try {
      const signals = await fn();
      allSignals.push(...signals);
      bySources[name] = signals.length;
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`  ${name}: ${signals.length} signals (${elapsed}s)`);
    } catch (err) {
      bySources[name] = 0;
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`  ${name}: FAILED (${elapsed}s) - ${(err as Error).message}`);
    }
  }

  return { allSignals, bySources };
}

export async function runFullIngestion(): Promise<{
  total: number;
  bySources: Record<string, number>;
}> {
  console.error("Starting full ingestion...");

  useRedis = await isRedisAvailable();
  if (useRedis) {
    console.error("  Redis connected — using Redis cache");
  } else {
    console.error("  Redis unavailable — using in-memory store");
  }

  const { allSignals, bySources } = await runSequentialIngestors();

  memorySignals = allSignals;
  lastIngestAt = Date.now();

  if (useRedis) {
    await storeSignalsInRedis(allSignals);
    console.error("  Signals stored in Redis");
  }

  console.error(`Ingestion complete: ${allSignals.length} total signals`);

  return { total: allSignals.length, bySources };
}

async function mergeSignals(source: string, newSignals: RawSignal[]): Promise<void> {
  memorySignals = memorySignals.filter((s) => s.source !== source);
  memorySignals.push(...newSignals);
  lastIngestAt = Date.now();

  if (useRedis) {
    await storeSignalsInRedis(memorySignals);
  }
}

let cronRunning = false;

async function runCronCycle(): Promise<void> {
  if (cronRunning) {
    console.error("[cron] Previous cycle still running, skipping...");
    return;
  }
  cronRunning = true;
  console.error("[cron] Starting sequential refresh cycle...");

  const sources: { name: string; fn: () => Promise<RawSignal[]> }[] = [
    { name: "reddit", fn: ingestRedditRSS },
    { name: "github", fn: ingestGitHub },
    { name: "jobs", fn: ingestAdzuna },
    { name: "hackernews", fn: ingestHackerNews },
  ];

  for (const { name, fn } of sources) {
    const start = Date.now();
    try {
      const signals = await fn();
      await mergeSignals(name, signals);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`[cron] ${name}: ${signals.length} signals (${elapsed}s)`);
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`[cron] ${name}: FAILED (${elapsed}s) - ${(err as Error).message}`);
    }
  }

  cronRunning = false;
  console.error("[cron] Refresh cycle complete.");
}

export function startCronSchedule(): void {
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  // Fast sources — every 4 hours
  setInterval(() => {
    runCronCycle().catch((err) =>
      console.error("[cron] Cycle error:", (err as Error).message)
    );
  }, FOUR_HOURS);

  // G2 — once per day
  setInterval(async () => {
    console.error("[cron] G2 daily refresh starting...");
    try {
      const signals = await ingestG2BrightData();
      await mergeSignals("g2", signals);
      console.error(`[cron] G2: ${signals.length} signals`);
    } catch (err) {
      console.error("[cron] G2 failed:", (err as Error).message);
    }
  }, TWENTY_FOUR_HOURS);

  console.error("Cron schedule started: Reddit/HN/Jobs/GitHub every 4h, G2 every 24h");
}