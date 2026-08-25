import https from "node:https";

import { HttpsProxyAgent } from "https-proxy-agent";

export interface JsonHttpResponse {
  ok: boolean;
  status: number;
  text: string;
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  timeoutMs: number
): Promise<JsonHttpResponse> {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const proxyUrl = process.env.AI_HTTP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

  if (!proxyUrl || !url.startsWith("https://")) {
    const response = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
    return { ok: response.ok, status: response.status, text: Buffer.from(await response.arrayBuffer()).toString("utf8") };
  }

  return new Promise<JsonHttpResponse>((resolve, reject) => {
    const request = https.request(url, {
      method: "POST",
      agent: new HttpsProxyAgent(proxyUrl),
      headers: {
        ...headers,
        "Content-Length": body.byteLength.toString()
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        const status = response.statusCode || 0;
        resolve({ ok: status >= 200 && status < 300, status, text: Buffer.concat(chunks).toString("utf8") });
      });
    });

    request.setTimeout(timeoutMs, () => request.destroy(new Error(`上游请求超过 ${timeoutMs}ms`)));
    request.on("error", reject);
    request.end(body);
  });
}
