import { ProxyAgent, fetch as undiciFetch } from "undici";

const PROXY_HOST = process.env.PROXY_HOST || "";
const PROXY_PORT = process.env.PROXY_PORT || "";
const PROXY_USERNAME = process.env.PROXY_USERNAME || "";
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || "";

export function isProxyConfigured(): boolean {
  return !!(PROXY_HOST && PROXY_PORT && PROXY_USERNAME && PROXY_PASSWORD);
}

export async function fetchWithProxy(url: string, options: Record<string, unknown> = {}): Promise<Response> {
  if (!isProxyConfigured()) {
    return fetch(url, { ...options, signal: AbortSignal.timeout(15000) } as RequestInit);
  }

  const proxyUrl = `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;
  const agent = new ProxyAgent(proxyUrl);

  const res = await undiciFetch(url, {
    ...options,
    dispatcher: agent,
  } as Parameters<typeof undiciFetch>[1]);

  return res as unknown as Response;
}