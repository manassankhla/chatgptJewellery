/**
 * Image Proxy — /api/img?src=ENCODED_URL
 *
 * Fetches external images (e.g. Cloudinary) and serves them from our own
 * origin so ChatGPT's sandboxed MCP widget iframe can load them without
 * hitting CSP `img-src` restrictions.
 *
 * Usage (widget HTML):
 *   <img src="/api/img?src=https%3A%2F%2Fres.cloudinary.com%2F...">
 */

export const runtime = "edge";

const ALLOWED_ORIGINS = [
  "res.cloudinary.com",
  "chatgpt-jewellery.vercel.app",
];

function isAllowed(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_ORIGINS.some((o) => hostname === o || hostname.endsWith(`.${o}`));
  } catch {
    return false;
  }
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const src = searchParams.get("src");

  if (!src) {
    return new Response("Missing src parameter", { status: 400 });
  }

  if (!isAllowed(src)) {
    return new Response("Origin not allowed", { status: 403 });
  }

  try {
    const upstream = await fetch(src, {
      headers: { "User-Agent": "JewelleryStylist/1.0" },
    });

    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.status}`, {
        status: upstream.status,
      });
    }

    const contentType =
      upstream.headers.get("content-type") ?? "image/jpeg";
    const buffer = await upstream.arrayBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(`Proxy error: ${String(err)}`, { status: 502 });
  }
}
