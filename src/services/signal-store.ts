import type { RawSignal } from "../schemas/surge.js";
import type { SignalSource } from "../constants.js";
import { REDIS_SIGNAL_PREFIX, CACHE_TTL_SIGNAL } from "../constants.js";
import { getRedis, isRedisAvailable } from "./redis.js";
import { ingestRedditRSS } from "./ingestors/reddit-rss.js";
import { ingestGitHub } from "./ingestors/github.js";
import { ingestNewsData } from "./ingestors/newsdata.js";
import { ingestAdzuna } from "./ingestors/adzuna.js";
import { ingestLinkedIn } from "./ingestors/apify.js";
import { ingestG2Free } from "./ingestors/g2.js";

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

async function fanOutForDomain(domain: string, topic: string): Promise<RawSignal[]> {
  console.error(`[fan-out] Cache miss for ${domain}:${topic}, fetching live...`);

  const timeout = new Promise<RawSignal[]>((resolve) => {
    setTimeout(() => {
      console.error(`[fan-out] Timed out for ${domain}:${topic}`);
      resolve([]);
    }, 20000);
  });

  const fetchAll = async (): Promise<RawSignal[]> => {
    const allSignals: RawSignal[] = [];

    const sources = [
      { name: "reddit", fn: ingestRedditRSS },
      { name: "github", fn: ingestGitHub },
      { name: "news", fn: ingestNewsData },
      { name: "jobs", fn: ingestAdzuna },
    ];

    for (const source of sources) {
      try {
        const signals = await source.fn();
        allSignals.push(...signals);
      } catch {}
    }

    return allSignals.filter((s) => s.domain === domain && s.topic === topic);
  };

  return Promise.race([fetchAll(), timeout]);
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

export async function getSignalsForDomainTopic(domain: string, topic: string, allowFanOut: boolean = true): Promise<RawSignal[]> {
  if (useRedis) {
    const cached = await getSignalsFromRedis(signalKey(domain, topic));
    if (cached.length > 0) return cached;
  } else {
    const cached = memorySignals.filter((s) => s.domain === domain && s.topic === topic);
    if (cached.length > 0) return cached;
  }

  if (!allowFanOut) return [];

  const fresh = await fanOutForDomain(domain, topic);
  if (fresh.length > 0) {
    memorySignals.push(...fresh);
    lastIngestAt = Date.now();
    if (useRedis) {
      const redis = getRedis();
      await redis.set(signalKey(domain, topic), JSON.stringify(fresh), "EX", CACHE_TTL_SIGNAL);
    }
  }

  return fresh;
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

async function runSource(name: string, fn: () => Promise<RawSignal[]>): Promise<{ name: string; signals: RawSignal[] }> {
  try {
    const signals = await fn();
    console.error(`  ${name}: ${signals.length} signals`);
    return { name, signals };
  } catch (err) {
    console.error(`  ${name}: FAILED - ${(err as Error).message}`);
    return { name, signals: [] };
  }
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

  const allSignals: RawSignal[] = [];
  const bySources: Record<string, number> = {};

  const reddit = await runSource("reddit", ingestRedditRSS);
  allSignals.push(...reddit.signals);
  bySources["reddit"] = reddit.signals.length;

  const github = await runSource("github", ingestGitHub);
  allSignals.push(...github.signals);
  bySources["github"] = github.signals.length;

  const news = await runSource("news", ingestNewsData);
  allSignals.push(...news.signals);
  bySources["news"] = news.signals.length;

  const jobs = await runSource("jobs", ingestAdzuna);
  allSignals.push(...jobs.signals);
  bySources["jobs"] = jobs.signals.length;

  const linkedin = await runSource("linkedin", ingestLinkedIn);
  allSignals.push(...linkedin.signals);
  bySources["linkedin"] = linkedin.signals.length;

  const g2 = await runSource("g2", ingestG2Free);
  allSignals.push(...g2.signals);
  bySources["g2"] = g2.signals.length;

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

export function startCronSchedule(): void {
  const ONE_HOUR = 60 * 60 * 1000;
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  setInterval(async () => {
    console.error("[cron] Reddit ingestion starting...");
    try {
      const signals = await ingestRedditRSS();
      await mergeSignals("reddit", signals);
      console.error(`[cron] Reddit: ${signals.length} signals`);
    } catch (err) {
      console.error("[cron] Reddit failed:", (err as Error).message);
    }
  }, TWO_HOURS);

  setInterval(async () => {
    console.error("[cron] GitHub ingestion starting...");
    try {
      const signals = await ingestGitHub();
      await mergeSignals("github", signals);
      console.error(`[cron] GitHub: ${signals.length} signals`);
    } catch (err) {
      console.error("[cron] GitHub failed:", (err as Error).message);
    }
  }, FOUR_HOURS);

  setInterval(async () => {
    console.error("[cron] News ingestion starting...");
    try {
      const signals = await ingestNewsData();
      await mergeSignals("news", signals);
      console.error(`[cron] News: ${signals.length} signals`);
    } catch (err) {
      console.error("[cron] News failed:", (err as Error).message);
    }
  }, ONE_HOUR);

  setInterval(async () => {
    console.error("[cron] Jobs ingestion starting...");
    try {
      const signals = await ingestAdzuna();
      await mergeSignals("jobs", signals);
      console.error(`[cron] Jobs: ${signals.length} signals`);
    } catch (err) {
      console.error("[cron] Jobs failed:", (err as Error).message);
    }
  }, SIX_HOURS);

  setInterval(async () => {
    console.error("[cron] LinkedIn ingestion starting...");
    try {
      const signals = await ingestLinkedIn();
      await mergeSignals("linkedin", signals);
      console.error(`[cron] LinkedIn: ${signals.length} signals`);
    } catch (err) {
      console.error("[cron] LinkedIn failed:", (err as Error).message);
    }
  }, FOUR_HOURS);

  setInterval(async () => {
    console.error("[cron] G2 ingestion starting...");
    try {
      const signals = await ingestG2Free();
      await mergeSignals("g2", signals);
      console.error(`[cron] G2: ${signals.length} signals`);
    } catch (err) {
      console.error("[cron] G2 failed:", (err as Error).message);
    }
  }, SIX_HOURS);

  console.error("Cron schedule started: Reddit 2h, GitHub 4h, News 1h, Jobs 6h, LinkedIn 4h, G2 6h");
}