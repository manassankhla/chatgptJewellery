/**
 * MCP Route — Jewellery Stylist (Apps SDK Widget Implementation)
 * SDK: @modelcontextprotocol/sdk 1.29.0
 *
 * ─── WHY IMAGES DON'T APPEAR IN STANDARD MCP CONNECTOR ───────────────────
 *
 * The ChatGPT "Settings → Connectors → Add MCP server" flow is a PLAIN MCP
 * connector. It:
 *   ✅ Supports text content blocks
 *   ❌ Does NOT render MCP ImageContent blocks as visual images
 *   ❌ Does NOT render base64 images
 *   ❌ Does NOT auto-render markdown image syntax from tool results
 *
 * The ONLY officially supported way to render product image cards in ChatGPT
 * is the OpenAI Apps SDK widget system, which requires:
 *   1. ChatGPT Developer Mode  (Settings → Apps & Connectors → Advanced)
 *   2. A ui:// resource served by the MCP server (text/html;profile=mcp-app)
 *   3. _meta.ui.resourceUri in the tool result pointing to the ui:// resource
 *   4. structuredContent carrying the data payload for the widget
 *
 * ─── IMPLEMENTATION ARCHITECTURE ──────────────────────────────────────────
 *
 *   recommend_jewellery tool call
 *         ↓
 *   Returns:
 *     content:           [ text block for the LLM ]
 *     structuredContent: { products: [...] }         ← data for the widget
 *     _meta:             { ui: { resourceUri: "ui://jewellery-stylist/cards.html" } }
 *         ↓
 *   ChatGPT fetches: ui://jewellery-stylist/cards.html via resources/read
 *         ↓
 *   MCP server returns the widget HTML (MIME: text/html;profile=mcp-app)
 *         ↓
 *   ChatGPT renders widget in sandboxed iframe
 *         ↓
 *   Widget reads window.openai.toolOutput.structuredContent.products
 *         ↓
 *   Renders jewellery cards with Cloudinary images, name, price, tags ✅
 *
 * ─── SCHEMA (CallToolResult — SDK types.d.ts line 2501) ───────────────────
 *
 *   {
 *     content:           TextContent[]   (required, for the LLM)
 *     structuredContent: Record<string, unknown>  (optional, for the widget)
 *     _meta:             Record<string, unknown>  (optional, for UI routing)
 *     isError?:          boolean
 *   }
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

// ── Widget HTML ────────────────────────────────────────────────────────────
// Served at ui://jewellery-stylist/cards.html
// Rendered by ChatGPT in a sandboxed iframe (Developer Mode only)
// Reads data from window.openai.toolOutput.structuredContent.products
function getWidgetHtml(origin: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Jewellery Recommendations</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fcfcfc;
    color: #18181b;
    padding: 16px;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #18181b; color: #f4f4f5; }
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #d97706;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .error {
    text-align: center;
    color: #71717a;
    padding: 32px;
    font-size: 13px;
  }

  /* ── TABLE ────────────────────────────────────────────────────────────── */
  .table-wrapper {
    width: 100%;
    overflow-x: auto;
    border-radius: 16px;
    border: 1px solid #f0ece8;
    margin-bottom: 20px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.04);
  }
  @media (prefers-color-scheme: dark) {
    .table-wrapper { border-color: #2d2d30; box-shadow: 0 4px 24px rgba(0,0,0,0.2); }
  }
  table {
    width: 100%;
    border-collapse: collapse;
    background: #ffffff;
    font-size: 13px;
  }
  @media (prefers-color-scheme: dark) {
    table { background: #1c1c1f; }
  }
  thead tr {
    background: linear-gradient(135deg, #803340 0%, #a0455a 100%);
  }
  thead th {
    color: #ffffff;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 12px 16px;
    text-align: left;
    white-space: nowrap;
  }
  tbody tr {
    border-bottom: 1px solid #f4f4f5;
    transition: background 0.15s;
  }
  @media (prefers-color-scheme: dark) {
    tbody tr { border-bottom-color: #27272a; }
  }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: #fdf8f6; }
  @media (prefers-color-scheme: dark) {
    tbody tr:hover { background: #242427; }
  }
  tbody td {
    padding: 14px 16px;
    vertical-align: middle;
  }
  .td-img { width: 80px; min-width: 80px; }
  .td-img img {
    width: 72px;
    height: 72px;
    object-fit: cover;
    border-radius: 10px;
    border: 1px solid #f0ece8;
    display: block;
  }
  @media (prefers-color-scheme: dark) {
    .td-img img { border-color: #2d2d30; }
  }
  .td-name { min-width: 160px; }
  .row-name {
    font-size: 13px;
    font-weight: 700;
    color: #18181b;
    line-height: 1.3;
    margin-bottom: 4px;
  }
  @media (prefers-color-scheme: dark) {
    .row-name { color: #f4f4f5; }
  }
  .row-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .tag {
    font-size: 9px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 99px;
    background: #f5ede6;
    color: #803340;
    text-transform: capitalize;
    white-space: nowrap;
  }
  @media (prefers-color-scheme: dark) {
    .tag { background: #2d1c1f; color: #e07080; }
  }
  .tag.intensity-heavy { background: #803340; color: #fff; }
  .tag.intensity-medium { background: #d97706; color: #fff; }
  .td-price {
    white-space: nowrap;
    font-size: 14px;
    font-weight: 800;
    color: #18181b;
  }
  @media (prefers-color-scheme: dark) {
    .td-price { color: #f4f4f5; }
  }
  .td-score { text-align: center; min-width: 60px; }
  .score-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 800;
    background: linear-gradient(135deg, #803340 0%, #a0455a 100%);
    color: #ffffff;
  }
  .td-action { min-width: 110px; white-space: nowrap; }
  .btn-buy-now {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px 16px;
    border-radius: 10px;
    border: none;
    font-family: inherit;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.2s;
    background: linear-gradient(135deg, #803340 0%, #a0455a 100%);
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(128,51,64,0.3);
  }
  .btn-buy-now:hover {
    background: linear-gradient(135deg, #6c2834 0%, #8c3a4d 100%);
    box-shadow: 0 6px 16px rgba(128,51,64,0.45);
    transform: translateY(-1px);
  }
  .btn-buy-now svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
  }
  .rec-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 9px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 99px;
    background: #803340;
    color: #ffffff;
    margin-bottom: 5px;
  }
  /* ── RECOMMENDATION BOX ───────────────────────────────────────────────── */
  .recommend-box {
    padding: 16px;
    background: #fbf5f5;
    border: 1px solid #f3e6e6;
    border-radius: 16px;
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  @media (prefers-color-scheme: dark) {
    .recommend-box { background: #24191b; border-color: #3b2024; }
  }
  .recommend-icon {
    background: rgba(128, 51, 64, 0.1);
    color: #803340;
    padding: 6px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .recommend-icon svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }
  .recommend-text h5 {
    font-size: 12px;
    font-weight: 800;
    color: #18181b;
    margin-bottom: 2px;
  }
  @media (prefers-color-scheme: dark) {
    .recommend-text h5 { color: #f4f4f5; }
  }
  .recommend-text p {
    font-size: 11px;
    color: #52525b;
    line-height: 1.4;
  }
  @media (prefers-color-scheme: dark) {
    .recommend-text p { color: #a1a1aa; }
  }
  .highlight-option { font-weight: 750; color: #803340; }
</style>
</head>
<body>
<div class="header">
  <h3 class="title">✨ Curated Recommendations</h3>
</div>
<div id="root"><div class="error">Loading suggestions...</div></div>

<script>
(function() {
  var root = document.getElementById('root');

  function render(data) {
    if (!data || !data.products || data.products.length === 0) {
      root.innerHTML = '<div class="error">No products available.</div>';
      return;
    }

    var products = data.products;
    var color = data.outfitColor || "your outfit";
    var type = data.outfitType || "your look";

    // Pick best match by score
    var recIdx = 0;
    var bestScore = -1;
    for (var i = 0; i < products.length; i++) {
      if ((products[i].score || 0) > bestScore) {
        bestScore = products[i].score || 0;
        recIdx = i;
      }
    }

    var html = [
      '<div class="table-wrapper">',
        '<table>',
          '<thead><tr>',
            '<th></th>',
            '<th>Product</th>',
            '<th>Occasions</th>',
            '<th>Price</th>',
            '<th style="text-align:center">Match</th>',
            '<th></th>',
          '</tr></thead>',
          '<tbody>',
    ].join('');

    products.forEach(function(p, idx) {
      var isRec = idx === recIdx;
      var intensity = p.lookIntensity || 'medium';
      var tags = (p.styleTags || []).slice(0, 3);
      var occasions = (p.occasionTags || []).slice(0, 2);
      var link = p.link || '#';

      html += [
        '<tr>',
          '<td class="td-img">',
            '<img src="' + p.image + '" alt="' + p.name + '">',
          '</td>',
          '<td class="td-name">',
            isRec ? '<div class="rec-badge">★ Best Match</div>' : '',
            '<div class="row-name">' + p.name + '</div>',
            '<div class="row-tags">',
              tags.map(function(t) { return '<span class="tag">' + t + '</span>'; }).join(''),
              '<span class="tag intensity-' + intensity + '">' + intensity + '</span>',
            '</div>',
          '</td>',
          '<td>',
            '<div style="font-size:11px;color:#71717a;line-height:1.6;">',
              occasions.join('<br>'),
            '</div>',
          '</td>',
          '<td class="td-price">₹' + (p.price || 0).toLocaleString('en-IN') + '</td>',
          '<td class="td-score"><div class="score-pill">' + (p.score || '-') + '</div></td>',
          '<td class="td-action">',
            '<a class="btn-buy-now" href="' + link + '" target="_blank" rel="noopener noreferrer">',
              '<svg viewBox="0 0 24 24"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>',
              'Buy Now',
            '</a>',
          '</td>',
        '</tr>',
      ].join('');
    });

    html += '</tbody></table></div>';

    // Bottom recommendation box
    var recP = products[recIdx];
    if (recP) {
      html += [
        '<div class="recommend-box">',
          '<div class="recommend-icon">',
            '<svg viewBox="0 0 24 24"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>',
          '</div>',
          '<div class="recommend-text">',
            '<h5>My Recommendation:</h5>',
            '<p><span class="highlight-option">' + recP.name + '</span> — Best match for ' + color + ' ' + type + ' with a score of ' + (recP.score || '') + '/100. Click <strong>Buy Now</strong> to view &amp; purchase!</p>',
          '</div>',
        '</div>',
      ].join('');
    }

    root.innerHTML = html;
  }

  function init() {
    if (window.openai && window.openai.toolOutput) {
      render(window.openai.toolOutput.structuredContent);
    }
    window.addEventListener('message', function(event) {
      var message = event.data;
      if (!message) return;
      if (message.jsonrpc === "2.0" && message.method === "ui/notifications/tool-result") {
        render(message.params.structuredContent);
      } else if (message.structuredContent) {
        render(message.structuredContent);
      }
    });
    window.addEventListener('openai:set_globals', function(event) {
      var globals = event.detail && event.detail.globals;
      if (globals && globals.toolOutput) {
        render(globals.toolOutput.structuredContent);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>
</body>
</html>`;
}

function getLocalImageUrl(imagePath: string, origin: string): string {
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    return imagePath;
  }
  return `${origin}${imagePath}`;
}

// ── MCP Server ────────────────────────────────────────────────────────────
function buildServer(origin: string): McpServer {
  const server = new McpServer({
    name: "Jewellery Stylist",
    version: "1.0.0",
  });

  // ══════════════════════════════════════════════════════════════════════════
  // RESOURCE — ui://widget/jewellery-cards.html
  // ChatGPT fetches this when _meta.ui.resourceUri is set in the tool result.
  // MIME type must be text/html;profile=mcp-app for ChatGPT to render it.
  // Requires: ChatGPT Developer Mode (Settings → Apps & Connectors → Advanced)
  // ══════════════════════════════════════════════════════════════════════════
  server.registerResource(
    "jewellery-cards-widget",
    "ui://widget/jewellery-cards.html",
    {
      // ResourceMetadata = Omit<Resource, 'uri' | 'name'> — name is excluded
      description: "Interactive jewellery recommendation cards widget with product images",
      mimeType: "text/html;profile=mcp-app",
    },
    async () => {
      console.log("[RESOURCE] Serving widget: ui://widget/jewellery-cards.html");
      return {
        contents: [
          {
            uri: "ui://widget/jewellery-cards.html",
            mimeType: "text/html;profile=mcp-app",
            text: getWidgetHtml(origin),
          },
        ],
      };
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // TOOL — recommend_jewellery
  //
  // Returns:
  //   content           → text for the LLM (always shown in standard mode)
  //   structuredContent → jewellery data payload for the widget
  //   _meta.ui          → tells ChatGPT (Apps SDK) which widget to render
  //
  // In STANDARD connector mode: only text content is shown (no images)
  // In DEVELOPER MODE (Apps SDK): widget renders with product image cards
  // ══════════════════════════════════════════════════════════════════════════
  server.registerTool(
    "recommend_jewellery",
    {
      title: "Recommend Jewellery",
      description: [
        "Suggests the best jewellery from our catalogue based on occasion, outfit colour, outfit type, and style.",
        "You MUST include the exact markdown image tag ![name](url) for each product in your response to the user so the image renders in the chat.",
        "",
        "After showing recommendations:",
        "1. Ask the user which piece they like (1, 2, or 3)",
        "2. Ask if they want to try it on virtually",
        "3. If yes: ask them to upload their portrait photo",
        "4. Use your built-in image generation to composite the jewellery onto their photo",
      ].join("\n"),
      inputSchema: {
        occasion: z.string().optional().describe("e.g. 'wedding', 'engagement', 'reception', 'party'"),
        outfitColor: z.string().optional().describe("e.g. 'red', 'navy', 'white', 'black'"),
        outfitType: z.string().optional().describe("e.g. 'saree', 'lehenga', 'gown', 'western_dress'"),
        style: z.string().optional().describe("e.g. 'bridal', 'royal', 'modern', 'elegant', 'luxury'"),
      },
      _meta: {
        ui: {
          resourceUri: "ui://widget/jewellery-cards.html",
        },
        "openai/outputTemplate": "ui://widget/jewellery-cards.html",
      },
    },
    async (args) => {
      console.log("[TOOL] recommend_jewellery args:", JSON.stringify(args));

      const rawResults = recommendJewellery(args);
      const results = rawResults.map((p) => ({
        ...p,
        image: getLocalImageUrl(p.image, origin),
      }));

      console.log(`[TOOL] ${results.length} products matched`);

      if (results.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No matching jewellery found. Try with fewer filters — e.g. just mention the occasion.",
          }],
        };
      }

      const textSummary = results
        .map((p, i) =>
          `${i + 1}. **${p.name}** — ₹${p.price.toLocaleString("en-IN")} (${p.score}/100 match)\n` +
          `   Style: ${p.aiTags.styleTags.join(", ")} | Intensity: ${p.aiTags.lookIntensity}\n\n` +
          `![${p.name}](${p.image})`
        )
        .join("\n\n");

      const structuredContent = {
        products: results.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          image: p.image,
          link: p.link,
          styleTags: p.aiTags.styleTags,
          occasionTags: p.aiTags.occasionTags,
          bestOutfitColours: p.aiTags.bestOutfitColours,
          bestOutfitTypes: p.aiTags.bestOutfitTypes,
          lookIntensity: p.aiTags.lookIntensity,
          score: p.score,
        })),
        occasion: args.occasion,
        outfitColor: args.outfitColor,
        outfitType: args.outfitType,
      };

      return {
        content: [
          {
            type: "text",
            text: `[FORMAT INSTRUCTION: You must include the exact markdown image tags ![name](url) provided below in your response so the images render in the chat.]\n\n` +
              `Here are your top jewellery recommendations:\n\n${textSummary}\n\n` +
              `Which one do you like? Reply 1, 2, or 3 and I'll offer a virtual try-on.`,
          },
        ],
        structuredContent,
        _meta: {
          ui: {
            resourceUri: "ui://widget/jewellery-cards.html",
          },
          "openai/outputTemplate": "ui://widget/jewellery-cards.html",
        },
      } as any;
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // TOOL — test_jewellery_images (diagnostic)
  // ══════════════════════════════════════════════════════════════════════════
  server.registerTool(
    "test_jewellery_images",
    {
      title: "Test Image Rendering",
      description: "Diagnostic tool. Tests whether ChatGPT renders the widget UI. Call this to verify Developer Mode is active.",
      inputSchema: {},
    },
    async () => {
      const testProduct = {
        id: "test",
        name: "Royal Temple Bridal Choker Set",
        price: 85000,
        image: "https://res.cloudinary.com/dnjouplkz/image/upload/v1782217413/three_gcdcw2.png",
        styleTags: ["bridal", "royal", "temple"],
        occasionTags: ["wedding", "engagement"],
        bestOutfitColours: ["red", "gold"],
        bestOutfitTypes: ["lehenga", "saree"],
        lookIntensity: "heavy",
        score: 80,
      };

      return {
        content: [{
          type: "text",
          text: `Test called. Standard image markdown:\n\n![Test Choker](${origin}/three.png)`,
        }],
      } as any;
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // TOOL — virtual_try_on
  // Provides a dedicated endpoint for virtual try-on prompts.
  // ══════════════════════════════════════════════════════════════════════════
  server.registerTool(
    "virtual_try_on",
    {
      title: "Virtual Try-On",
      description: "Applies selected jewellery onto the user's uploaded portrait photograph using precise high-end rendering instructions.",
      inputSchema: {
        jewelleryName: z.string().describe("Name of the selected jewellery item"),
        jewelleryImageUrl: z.string().describe("URL of the jewellery image reference"),
        userPhotoUrl: z.string().describe("URL of the user's uploaded portrait photograph (acting as identity reference)"),
      },
    },
    async (args) => {
      console.log("[TOOL] virtual_try_on called with:", JSON.stringify(args));
      
      const tryOnPrompt = [
        "TASK: High-end luxury jewellery virtual try-on.",
        "",
        `REFERENCE 1: ${args.userPhotoUrl}`,
        "Use the uploaded portrait photo as the identity reference.",
        "Preserve the person's face, skin tone, hairstyle, facial features, expression, and pose exactly.",
        "",
        `REFERENCE 2: ${args.jewelleryImageUrl} (${args.jewelleryName})`,
        "Use the uploaded jewellery image as the jewellery reference.",
        "Recreate the exact same necklace and matching earrings design, including gemstone arrangement, metal color, shape, proportions, diamond placement, and overall craftsmanship.",
        "",
        "INSTRUCTIONS:",
        "- Place the necklace naturally around the neck following the exact neck curvature.",
        "- Place matching earrings accurately on both ears.",
        "- Maintain correct scale and proportions.",
        "- Match lighting, reflections, shadows, and highlights to the portrait photograph.",
        "- Jewellery should appear physically worn, not pasted or overlaid.",
        "- Preserve skin texture and hair strands around the jewellery.",
        "- Create realistic contact shadows beneath the necklace.",
        "- Ensure the jewellery blends naturally with the body and perspective.",
        "- Keep the face identity unchanged.",
        "- Do not modify facial features.",
        "- Do not change expression.",
        "- Do not change hairstyle.",
        "- Do not change camera angle.",
        "- Do not change background.",
        "",
        "STYLE:",
        "Premium luxury jewellery advertisement photography. Ultra realistic. Photorealistic. Studio quality. Natural skin texture. High detail. 8K quality.",
        "",
        "NEGATIVE PROMPT:",
        "cartoon, CGI look, fake jewellery, floating necklace, distorted earrings, extra jewellery, altered face, beauty filter, plastic skin, unrealistic reflections, duplicate earrings, warped neck, cropped jewellery, low quality, blurry, overprocessed, pasted object, collage effect.",
        "",
        "OUTPUT:",
        "A single photorealistic virtual try-on image showing the person naturally wearing the exact jewellery set from the reference image."
      ].join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Starting virtual try-on rendering process for "${args.jewelleryName}" using the provided reference photo.\n\n` +
                  `Generation Prompt and Instructions for DALL-E/Image Tool:\n\n\`\`\`\n${tryOnPrompt}\n\`\`\`\n\n` +
                  `Please run DALL-E using these instructions and provide the final image output.`
          }
        ]
      } as any;
    }
  );

  return server;
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────
async function handleMcpRequest(req: Request): Promise<Response> {
  const { origin } = new URL(req.url);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  const server = buildServer(origin);
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