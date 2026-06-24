/**
 * MCP Route — Jewellery Stylist
 *
 * SDK version: @modelcontextprotocol/sdk 1.29.0
 * Protocol:    2025-11-25 (negotiated to 2025-03-26 with ChatGPT)
 *
 * ─── WHY IMAGES WERE NOT RENDERING ────────────────────────────────────────
 *
 * 1. `{ type:"image", data:base64, mimeType }` blocks ARE spec-compliant and
 *    get sent correctly in the MCP JSON-RPC response.
 *
 * 2. However ChatGPT's connector does NOT render MCP image-content blocks as
 *    visual thumbnails inside the chat UI. It passes them to the model's
 *    context as vision tokens — invisible to the user.
 *
 * 3. Markdown `![alt](url)` inside a TEXT content block ALSO does not auto-
 *    render, because ChatGPT treats the tool result as raw context, not as
 *    something to display verbatim.
 *
 * ─── CORRECT APPROACH ─────────────────────────────────────────────────────
 *
 * The only reliable way to make images appear in the chat is to have
 * ChatGPT's own reply text include an image reference. We do this by:
 *
 *   a) Embedding `![name](cloudinaryUrl)` directly inside the TEXT content
 *      that we return — ChatGPT reads this, understands it should show the
 *      image, and includes the rendered image in its response.
 *
 *   b) ALSO returning base64 `{ type:"image" }` blocks so ChatGPT's vision
 *      model has the pixel data — critical for accurate try-on compositing.
 *
 *   c) Instructing ChatGPT via the tool description that it MUST reproduce
 *      the image markdown verbatim in its reply.
 *
 * ─── SCHEMA (from SDK types.d.ts lines 2501-2603) ─────────────────────────
 *
 *   CallToolResult.content = Array<
 *     | { type:"text";  text:string }                          ← TextContent
 *     | { type:"image"; data:string; mimeType:string }         ← ImageContent (base64)
 *     | { type:"resource_link"; uri:string; name:string; ... } ← ResourceLink
 *     | { type:"resource"; resource:{ uri, text|blob } }       ← EmbeddedResource
 *   >
 *   CallToolResult.structuredContent?: Record<string,unknown>  ← optional JSON
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { recommendJewellery } from "@/lib/recommendation";

// ── CORS ──────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

type TextBlock  = { type: "text";  text: string };
type ImageBlock = { type: "image"; data: string; mimeType: string };
type ContentBlock = TextBlock | ImageBlock;

/**
 * Fetch an image from any URL and return a base64 ImageBlock.
 * Returns null on failure (network error, non-2xx, timeout).
 * Logs every stage so you can trace issues in Vercel function logs.
 */
async function fetchBase64Block(
  url: string,
  label: string
): Promise<ImageBlock | null> {
  console.log(`[IMG] Fetching ${label}: ${url}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    console.log(`[IMG] ${label} — HTTP ${res.status} ${res.statusText}`);
    if (!res.ok) return null;

    const buf = await res.arrayBuffer();
    console.log(`[IMG] ${label} — downloaded ${buf.byteLength} bytes`);

    const base64 = Buffer.from(buf).toString("base64");
    const mimeType =
      res.headers.get("content-type")?.split(";")[0] ?? "image/png";

    console.log(`[IMG] ${label} — base64 length ${base64.length}, mime ${mimeType}`);
    return { type: "image", data: base64, mimeType };
  } catch (err) {
    console.error(`[IMG] ${label} — fetch error:`, err);
    return null;
  }
}

// ── MCP Server ────────────────────────────────────────────────────────────
function buildServer(): McpServer {
  const server = new McpServer({
    name: "Jewellery Stylist",
    version: "1.0.0",
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TOOL 1 — recommend_jewellery
  // ══════════════════════════════════════════════════════════════════════════
  server.registerTool(
    "recommend_jewellery",
    {
      title: "Recommend Jewellery",
      description: [
        "Suggests the best jewellery from our catalogue based on occasion, outfit colour, outfit type, and style.",
        "Returns up to 3 ranked products.",
        "",
        "CRITICAL DISPLAY RULES — follow exactly:",
        "1. For EACH recommendation you MUST display the jewellery image to the user.",
        "   The tool response text contains markdown image syntax like ![Name](url).",
        "   You MUST copy this markdown verbatim into your reply so the image renders.",
        "2. After displaying all recommendations, ask: 'Which one do you like? (1, 2, or 3)'",
        "3. After user picks one, ask: '✨ Would you like to try this on?'",
        "4. If yes, offer TWO options:",
        "   Option A — 'Upload your portrait photo and I'll place the jewellery on you'",
        "   Option B — 'Upload your outfit photo + face photo for a full look try-on'",
        "5. After user uploads photo(s), use YOUR BUILT-IN IMAGE GENERATION to composite",
        "   the selected jewellery (you already have it as a vision image in context)",
        "   onto the user's photo. Preserve everything — only add the jewellery.",
      ].join("\n"),
      inputSchema: {
        occasion: z.string().optional().describe(
          "The occasion — e.g. 'wedding', 'engagement', 'reception', 'party'"
        ),
        outfitColor: z.string().optional().describe(
          "Dominant outfit colour — e.g. 'red', 'navy', 'white', 'black'"
        ),
        outfitType: z.string().optional().describe(
          "Outfit type — e.g. 'saree', 'lehenga', 'gown', 'western_dress', 'indo_western'"
        ),
        style: z.string().optional().describe(
          "Jewellery style — e.g. 'bridal', 'royal', 'modern', 'elegant', 'luxury', 'antique'"
        ),
      },
    },
    async (args) => {
      console.log("[TOOL] recommend_jewellery called with:", JSON.stringify(args));

      const results = recommendJewellery(args);
      console.log(`[TOOL] Found ${results.length} matching products`);

      if (results.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No matching jewellery found. Try broadening your criteria (e.g. remove some filters).",
          }],
        };
      }

      // Fetch all images in parallel
      const base64Blocks = await Promise.all(
        results.map((p, i) => fetchBase64Block(p.image, `Option ${i + 1} — ${p.name}`))
      );

      // Build content blocks
      const content: ContentBlock[] = [];

      // Header text
      content.push({
        type: "text",
        text: "✨ Here are your top jewellery recommendations:\n",
      });

      // One section per product: text details + markdown image + base64 block
      results.forEach((p, i) => {
        const num = i + 1;

        // ── Text block with embedded markdown image ────────────────────────
        // ChatGPT MUST reproduce the ![...](url) in its reply for the image
        // to be visible. The description instructs it to do so.
        const detailText = [
          `**Option ${num}: ${p.name}**`,
          `💰 Price: ₹${p.price.toLocaleString("en-IN")}`,
          `🎨 Style: ${p.aiTags.styleTags.join(", ")}`,
          `🎉 Occasions: ${p.aiTags.occasionTags.join(", ")}`,
          `👗 Best with: ${p.aiTags.bestOutfitColours.join(", ")}`,
          `👘 Outfit types: ${p.aiTags.bestOutfitTypes.join(", ")}`,
          `✨ Look intensity: ${p.aiTags.lookIntensity}`,
          `⭐ Match score: ${p.score}/100`,
          ``,
          // Markdown image — ChatGPT fetches & renders this in its reply
          `![${p.name}](${p.image})`,
        ].join("\n");

        content.push({ type: "text", text: detailText });

        // ── Base64 image block ─────────────────────────────────────────────
        // ChatGPT's vision model processes this as actual pixel data.
        // It won't be shown to the user directly, but it lets ChatGPT
        // "see" the jewellery for accurate try-on compositing later.
        const b64 = base64Blocks[i];
        if (b64) {
          content.push(b64);
          console.log(`[TOOL] Appended base64 block for Option ${num}`);
        } else {
          console.warn(`[TOOL] No base64 for Option ${num} — image fetch failed`);
        }
      });

      // Footer instructions
      content.push({
        type: "text",
        text: [
          "",
          "---",
          "👆 **Images shown above are the actual jewellery pieces from our catalogue.**",
          "",
          "Which one do you like? Reply with **1**, **2**, or **3** and I'll offer you a virtual try-on.",
        ].join("\n"),
      });

      // Log the full response payload shape
      console.log(`[TOOL] Response: ${content.length} content blocks (${
        content.filter(c => c.type === "text").length} text, ${
        content.filter(c => c.type === "image").length} image)`);

      return { content };
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // TOOL 2 — test_jewellery_images
  // Diagnostic tool: returns one URL image (markdown), one base64 image,
  // and one text block. Use this to confirm which format ChatGPT renders.
  // ══════════════════════════════════════════════════════════════════════════
  server.registerTool(
    "test_jewellery_images",
    {
      title: "Test Jewellery Image Rendering",
      description: [
        "Diagnostic tool that returns THREE different content formats to identify",
        "which one ChatGPT renders as a visible image in the chat.",
        "IMPORTANT: Display ALL content from this tool exactly as received.",
        "For each image block, show it to the user and state which format it used.",
      ].join("\n"),
      inputSchema: {},
    },
    async () => {
      console.log("[TEST] test_jewellery_images called");

      // A real Cloudinary jewellery image from our catalogue
      const testImageUrl =
        "https://res.cloudinary.com/dnjouplkz/image/upload/v1782217413/three_gcdcw2.png";

      const content: ContentBlock[] = [];

      // ── Block 1: Plain text with markdown image tag ────────────────────
      content.push({
        type: "text",
        text: [
          "## 🧪 Image Rendering Test",
          "",
          "**Format A — Markdown image in text block:**",
          `![Royal Temple Bridal Choker Set](${testImageUrl})`,
          "",
          "If you see an image above, Format A (markdown URL) works ✅",
          "If you only see the URL as text, Format A does NOT work ❌",
        ].join("\n"),
      });

      // ── Block 2: Base64 image content block ───────────────────────────
      const b64 = await fetchBase64Block(testImageUrl, "test-image");
      if (b64) {
        content.push({
          type: "text",
          text: "\n**Format B — MCP base64 image content block (follows this text):**",
        });
        content.push(b64);
        content.push({
          type: "text",
          text: "If you see an image between the two text markers, Format B (base64 block) works ✅",
        });
        console.log("[TEST] base64 block added, length:", b64.data.length);
      } else {
        content.push({
          type: "text",
          text: "⚠️ Format B test failed: could not fetch image from Cloudinary.",
        });
      }

      // ── Block 3: Summary ──────────────────────────────────────────────
      content.push({
        type: "text",
        text: [
          "",
          "---",
          "**Format C — Structured JSON (structuredContent):**",
          "Not used for images — structuredContent is for machine-readable data only.",
          "",
          "Please tell me which format(s) rendered as a visible image so we can",
          "use the correct approach in the main recommendation tool.",
        ].join("\n"),
      });

      console.log(`[TEST] Returning ${content.length} blocks`);
      return { content };
    }
  );

  return server;
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────

async function handleMcpRequest(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — required for Next.js edge/serverless
  });
  const server = buildServer();
  await server.connect(transport);
  const response = await transport.handleRequest(req);
  return withCors(response);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: Request): Promise<Response> {
  return handleMcpRequest(req);
}

export async function POST(req: Request): Promise<Response> {
  return handleMcpRequest(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return handleMcpRequest(req);
}