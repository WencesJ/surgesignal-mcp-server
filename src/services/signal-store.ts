import type { RawSignal } from "../schemas/surge.js";
import type { SignalSource } from "../constants.js";
import { REDIS_SIGNAL_PREFIX, CACHE_TTL_SIGNAL } from "../constants.js";
import { getRedis, isRedisAvailable } from "./redis.js";
import { ingestRedditRSS } from "./ingestors/reddit-rss.js";
import { ingestGitHub } from "./ingestors/github.js";
import { ingestNewsData } from "./ingestors/newsdata.js";
import { ingestAdzuna } from "./ingestors/adzuna.js";
import { ingestLinkedInDirect as ingestLinkedIn } from "./ingestors/linkedin.js";
import { ingestHackerNews } from "./ingestors/hackernews.js";

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

async function runSequentialIngestors(): Promise<{ allSignals: RawSignal[]; bySources: Record<string, number> }> {
  const ingestors: { name: string; fn: () => Promise<RawSignal[]> }[] = [
    { name: "reddit", fn: ingestRedditRSS },
    { name: "github", fn: ingestGitHub },
    { name: "news", fn: ingestNewsData },
    { name: "jobs", fn: ingestAdzuna },
    { name: "linkedin", fn: ingestLinkedIn },
    { name: "hackernews", fn: ingestHackerNews },
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

async function fanOutForDomain(domain: string, topic: string): Promise<RawSignal[]> {
  console.error(`[fan-out] Cache miss for ${domain}:${topic}, fetching live...`);

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Fan-out timeout after 20s")), 20000)
  );

  try {
    const { allSignals } = await Promise.race([runSequentialIngestors(), timeout]);

    memorySignals = allSignals;
    lastIngestAt = Date.now();

    if (useRedis) {
      await storeSignalsInRedis(allSignals);
    }

    return allSignals.filter((s) => s.domain === domain && s.topic === topic);
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
    const cached = await getSignalsFromRedis(signalKey(domain, topic));
    if (cached.length > 0) return cached;
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
    { name: "news", fn: ingestNewsData },
    { name: "jobs", fn: ingestAdzuna },
    { name: "linkedin", fn: ingestLinkedIn },
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
  const TWO_HOURS = 2 * 60 * 60 * 1000;

  setInterval(() => {
    runCronCycle().catch((err) =>
      console.error("[cron] Cycle error:", (err as Error).message)
    );
  }, TWO_HOURS);

  console.error("Cron schedule started: full sequential refresh every 2h");
}