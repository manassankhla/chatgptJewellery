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
const WIDGET_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Jewellery Recommendations</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0a0a0f;
    color: #fff;
    min-height: 100vh;
    padding: 16px;
  }
  h2 {
    font-size: 14px;
    font-weight: 600;
    color: #a78bfa;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 16px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 14px;
  }
  .card {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 16px;
    overflow: hidden;
    transition: transform 0.2s, border-color 0.2s;
    cursor: pointer;
  }
  .card:hover {
    transform: translateY(-4px);
    border-color: rgba(167,139,250,0.5);
  }
  .card img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    background: #1a1a2e;
    display: block;
  }
  .card-body {
    padding: 12px;
  }
  .card-name {
    font-size: 13px;
    font-weight: 600;
    color: #f0e6ff;
    margin-bottom: 4px;
    line-height: 1.3;
  }
  .card-price {
    font-size: 13px;
    font-weight: 700;
    color: #fbbf24;
    margin-bottom: 6px;
  }
  .card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }
  .tag {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 999px;
    background: rgba(139,92,246,0.2);
    border: 1px solid rgba(139,92,246,0.3);
    color: #c4b5fd;
  }
  .card-score {
    font-size: 10px;
    color: #6b7280;
    margin-bottom: 10px;
  }
  .btn-select {
    width: 100%;
    padding: 8px;
    border-radius: 10px;
    border: none;
    background: linear-gradient(135deg, #7c3aed, #db2777);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .btn-select:hover { opacity: 0.85; }
  .btn-select.selected {
    background: linear-gradient(135deg, #059669, #0891b2);
  }
  .error {
    color: #f87171;
    font-size: 13px;
    text-align: center;
    padding: 32px;
  }
  .loading {
    color: #6b7280;
    font-size: 13px;
    text-align: center;
    padding: 32px;
  }
</style>
</head>
<body>
<h2>✨ Jewellery Recommendations</h2>
<div id="root"><div class="loading">Loading jewellery...</div></div>

<script>
(function() {
  var root = document.getElementById('root');

  function formatPrice(p) {
    return '₹' + p.toLocaleString('en-IN');
  }

  function renderCards(products) {
    if (!products || products.length === 0) {
      root.innerHTML = '<div class="error">No products found.</div>';
      return;
    }
    var html = '<div class="grid">';
    products.forEach(function(p, i) {
      var tags = (p.styleTags || []).slice(0, 3).map(function(t) {
        return '<span class="tag">' + t + '</span>';
      }).join('');
      var occasions = (p.occasionTags || []).slice(0, 2).join(', ');
      html += [
        '<div class="card" id="card-' + i + '">',
          '<img src="' + (p.image || '') + '" alt="' + p.name + '" loading="lazy"',
               ' onerror="this.style.background=\'#1e1e2e\';this.alt=\'Image unavailable\'">',
          '<div class="card-body">',
            '<div class="card-name">' + p.name + '</div>',
            '<div class="card-price">' + formatPrice(p.price) + '</div>',
            '<div class="card-tags">' + tags + '</div>',
            '<div class="card-score">🎉 ' + occasions + ' · ⭐ ' + (p.score || 0) + '/100</div>',
            '<button class="btn-select" id="btn-' + i + '"',
                    ' onclick="selectProduct(' + i + ')">',
              'Select this piece',
            '</button>',
          '</div>',
        '</div>',
      ].join('');
    });
    html += '</div>';
    root.innerHTML = html;
  }

  var selectedIndex = null;
  var allProducts = [];

  window.selectProduct = function(i) {
    var p = allProducts[i];
    if (!p) return;

    // Update button states
    allProducts.forEach(function(_, j) {
      var btn = document.getElementById('btn-' + j);
      if (btn) {
        btn.textContent = j === i ? '✓ Selected!' : 'Select this piece';
        btn.className = j === i ? 'btn-select selected' : 'btn-select';
      }
    });
    selectedIndex = i;

    // Notify host via window.openai bridge if available
    if (window.openai && window.openai.sendMessage) {
      window.openai.sendMessage({
        type: 'tool_call',
        toolName: 'jewellery_selected',
        params: { productName: p.name, productPrice: p.price }
      });
    }
    // Also post a message for any listening host
    window.parent.postMessage({
      type: 'mcp_widget_action',
      action: 'select_jewellery',
      product: p
    }, '*');
  };

  // Read data from OpenAI Apps SDK bridge
  function init() {
    var data = null;

    // Method 1: OpenAI Apps SDK standard
    if (window.openai && window.openai.toolOutput) {
      data = window.openai.toolOutput.structuredContent;
    }

    // Method 2: Check parent postMessage injection
    // (fallback if the SDK bridge isn't initialized yet)
    if (!data) {
      window.addEventListener('message', function(event) {
        if (event.data && event.data.structuredContent) {
          allProducts = event.data.structuredContent.products || [];
          renderCards(allProducts);
        }
      });
    }

    if (data && data.products) {
      allProducts = data.products;
      renderCards(allProducts);
    } else if (!data) {
      // Retry after SDK initializes
      setTimeout(function() {
        if (window.openai && window.openai.toolOutput) {
          var d = window.openai.toolOutput.structuredContent;
          if (d && d.products) {
            allProducts = d.products;
            renderCards(allProducts);
            return;
          }
        }
        root.innerHTML = '<div class="error">Could not load data. Make sure ChatGPT Developer Mode is enabled.</div>';
      }, 1500);
    }
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

// ── MCP Server ────────────────────────────────────────────────────────────
function buildServer(): McpServer {
  const server = new McpServer({
    name: "Jewellery Stylist",
    version: "1.0.0",
  });

  // ══════════════════════════════════════════════════════════════════════════
  // RESOURCE — ui://jewellery-stylist/cards.html
  // ChatGPT fetches this when _meta.ui.resourceUri is set in the tool result.
  // MIME type must be text/html;profile=mcp-app for ChatGPT to render it.
  // Requires: ChatGPT Developer Mode (Settings → Apps & Connectors → Advanced)
  // ══════════════════════════════════════════════════════════════════════════
  server.registerResource(
    "jewellery-cards-widget",
    "ui://jewellery-stylist/cards.html",
    {
      // ResourceMetadata = Omit<Resource, 'uri' | 'name'> — name is excluded
      description: "Interactive jewellery recommendation cards widget with product images",
      mimeType: "text/html;profile=mcp-app",
    },
    async () => {
      console.log("[RESOURCE] Serving widget: ui://jewellery-stylist/cards.html");
      return {
        contents: [
          {
            uri: "ui://jewellery-stylist/cards.html",
            mimeType: "text/html;profile=mcp-app",
            text: WIDGET_HTML,
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
        "Returns up to 3 ranked products with full product cards (image, name, price, style, occasion).",
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
    },
    async (args) => {
      console.log("[TOOL] recommend_jewellery args:", JSON.stringify(args));

      const results = recommendJewellery(args);
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
          `   Style: ${p.aiTags.styleTags.join(", ")} | Intensity: ${p.aiTags.lookIntensity}\n` +
          `   ![${p.name}](${p.image})`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `Here are your top jewellery recommendations:\n\n${textSummary}\n\n` +
              `Which one do you like? Reply 1, 2, or 3 and I'll offer a virtual try-on.`,
          },
        ],
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
          text: "Test called. Standard image markdown: ![Test Choker](https://res.cloudinary.com/dnjouplkz/image/upload/v1782217413/three_gcdcw2.png)",
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
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
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