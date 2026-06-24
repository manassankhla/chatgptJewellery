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
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Outfit', sans-serif;
    background: linear-gradient(180deg, #07070a 0%, #0f0f18 100%);
    color: #fff;
    min-height: 100vh;
    padding: 16px;
    overflow-y: hidden;
  }
  h2 {
    font-size: 13px;
    font-weight: 600;
    color: #dfb750; /* Luxury Gold */
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .grid {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    gap: 16px;
    padding: 4px 4px 16px 4px;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
  }
  /* Custom scrollbar for premium touch */
  .grid::-webkit-scrollbar {
    height: 3px;
  }
  .grid::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.03);
  }
  .grid::-webkit-scrollbar-thumb {
    background: rgba(223, 183, 80, 0.4);
    border-radius: 99px;
  }
  .grid::-webkit-scrollbar-thumb:hover {
    background: rgba(223, 183, 80, 0.8);
  }
  .card {
    flex: 0 0 210px;
    scroll-snap-align: start;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(223, 183, 80, 0.15);
    border-radius: 20px;
    overflow: hidden;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    cursor: pointer;
    display: flex;
    flex-direction: column;
  }
  .card:hover {
    transform: translateY(-6px);
    border-color: rgba(223, 183, 80, 0.7);
    box-shadow: 0 12px 30px rgba(223, 183, 80, 0.15);
  }
  .card img {
    width: 100%;
    aspect-ratio: 1.1;
    object-fit: cover;
    background: #11111a;
    display: block;
    border-bottom: 1px solid rgba(223, 183, 80, 0.1);
  }
  .card-body {
    padding: 14px;
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    justify-content: space-between;
  }
  .card-name {
    font-size: 13.5px;
    font-weight: 600;
    color: #f7f5ff;
    margin-bottom: 6px;
    line-height: 1.35;
    min-height: 36px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .card-price {
    font-size: 14px;
    font-weight: 700;
    color: #dfb750;
    margin-bottom: 8px;
  }
  .card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 10px;
  }
  .tag {
    font-size: 9.5px;
    font-weight: 500;
    padding: 2.5px 7px;
    border-radius: 999px;
    background: rgba(223, 183, 80, 0.08);
    border: 1px solid rgba(223, 183, 80, 0.2);
    color: #f3e5ab;
  }
  .card-score {
    font-size: 10px;
    color: #8c8da0;
    margin-bottom: 12px;
  }
  .btn-select {
    width: 100%;
    padding: 9px;
    border-radius: 12px;
    border: 1px solid rgba(223, 183, 80, 0.3);
    background: linear-gradient(135deg, rgba(223, 183, 80, 0.1) 0%, rgba(223, 183, 80, 0.02) 100%);
    color: #dfb750;
    font-family: 'Outfit', sans-serif;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s ease;
  }
  .btn-select:hover {
    background: rgba(223, 183, 80, 0.95);
    color: #0c0c14;
    border-color: transparent;
    box-shadow: 0 4px 12px rgba(223, 183, 80, 0.3);
  }
  .btn-select.selected {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: #fff;
    border-color: transparent;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
  }
  .error {
    color: #ef4444;
    font-size: 13px;
    text-align: center;
    padding: 24px;
    border: 1px dashed rgba(239, 68, 68, 0.3);
    border-radius: 16px;
    background: rgba(239, 68, 68, 0.05);
  }
  .loading {
    color: #8c8da0;
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
      mimeType: "text/html+skybridge",
    },
    async () => {
      console.log("[RESOURCE] Serving widget: ui://widget/jewellery-cards.html");
      return {
        contents: [
          {
            uri: "ui://widget/jewellery-cards.html",
            mimeType: "text/html+skybridge",
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