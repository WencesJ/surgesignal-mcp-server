import RedisModule from "ioredis";

const Redis = RedisModule.default;

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let client: ReturnType<typeof createClient> | null = null;

function createClient() {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
  });
}

export function getRedis() {
  if (!client) {
    client = createClient();
    client.on("error", (err: Error) => {
      console.error("Redis error:", err.message);
    });
  }
  return client;
}

export async function isRedisAvailable(): Promise<boolean> {
  try {
    const redis = getRedis();
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}