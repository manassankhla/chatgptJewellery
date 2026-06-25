"use client";

import { useEffect, useState } from "react";
import { Badge } from "@openai/apps-sdk-ui/components/Badge";
import { Button } from "@openai/apps-sdk-ui/components/Button";

interface Product {
  id: string;
  name: string;
  price: number;
  image: string;
  styleTags?: string[];
  occasionTags?: string[];
  bestOutfitColours?: string[];
  bestOutfitTypes?: string[];
  lookIntensity?: string;
  score?: number;
}

export default function JewelleryCardsWidget() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Helper to extract products from structuredContent
    const handleData = (structuredContent: any) => {
      if (structuredContent && Array.isArray(structuredContent.products)) {
        setProducts(structuredContent.products);
        setLoading(false);
        setError(null);
        return true;
      }
      return false;
    };

    // 1. Check if we received data from the parent via postMessage
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message) return;

      // Handle JSON-RPC method ui/notifications/tool-result
      if (message.jsonrpc === "2.0") {
        if (message.method === "ui/notifications/tool-result" && message.params) {
          handleData(message.params.structuredContent);
        }
        return;
      }

      // Handle custom bridge message (from parent page forwarding openai_globals)
      if (message.type === "openai_globals" && message.toolOutput) {
        handleData(message.toolOutput.structuredContent);
        return;
      }

      // Direct structuredContent injection
      if (message.structuredContent) {
        handleData(message.structuredContent);
        return;
      }
    };

    window.addEventListener("message", onMessage);

    // 2. Notify parent that we are ready to receive data
    window.parent.postMessage({ type: "iframe_ready" }, "*");

    // 3. Fallback timeout
    const timer = setTimeout(() => {
      if (loading && products.length === 0) {
        setLoading(false);
        setError("Waiting for recommendation data... Make sure Developer Mode is enabled in ChatGPT.");
      }
    }, 4000);

    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
  }, [loading, products.length]);

  const handleSelect = (product: Product) => {
    setSelectedId(product.id);

    // Notify the host parent window using the postMessage bridge
    window.parent.postMessage({
      type: "tool_call",
      toolName: "jewellery_selected",
      params: { productName: product.name, productPrice: product.price }
    }, "*");

    // Also send mcp_widget_action for general compatibility
    window.parent.postMessage({
      type: "mcp_widget_action",
      action: "select_jewellery",
      product
    }, "*");
  };

  const formatPrice = (p: number) => {
    return "₹" + p.toLocaleString("en-IN");
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[220px] text-zinc-400 gap-3">
        <div className="w-6 h-6 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin"></div>
        <p className="text-sm font-medium">Curating your jewellery suggestions...</p>
      </div>
    );
  }

  if (error && products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[220px] px-6 text-center">
        <div className="p-3 bg-red-950/20 border border-red-500/20 rounded-2xl mb-3 text-red-400">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-zinc-200">{error}</p>
      </div>
    );
  }

  return (
    <div className="w-full select-none py-1">
      <div className="flex items-center justify-between px-1 mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-amber-400/90 flex items-center gap-1.5">
          <span>✨</span> Curated Recommendations
        </h3>
        {products.length > 0 && (
          <span className="text-[10px] text-zinc-500 font-medium">
            {products.length} styles found
          </span>
        )}
      </div>

      <div className="flex overflow-x-auto gap-4 pb-3 scrollbar-thin scrollbar-thumb-amber-500/20 scrollbar-track-transparent snap-x snap-mandatory">
        {products.map((p) => {
          const isSelected = selectedId === p.id;
          return (
            <div
              key={p.id}
              className={`flex-none w-[220px] snap-start bg-zinc-900/40 backdrop-blur-md rounded-2xl border transition-all duration-300 overflow-hidden flex flex-col ${
                isSelected
                  ? "border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.15)] bg-emerald-950/5"
                  : "border-zinc-800/80 hover:border-amber-500/50 hover:bg-zinc-900/60"
              }`}
            >
              {/* Product Image */}
              <div className="relative aspect-[1.1] w-full bg-zinc-950/80 overflow-hidden group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.image}
                  alt={p.name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = "none";
                  }}
                />
                {p.score && (
                  <div className="absolute top-2.5 right-2.5">
                    <Badge color="secondary" className="bg-black/60 backdrop-blur-md text-amber-300 border border-amber-500/20 text-[9px] px-2 py-0.5">
                      ★ {p.score}% Match
                    </Badge>
                  </div>
                )}
              </div>

              {/* Product Info */}
              <div className="p-3.5 flex flex-col flex-1 justify-between gap-3">
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-zinc-100 text-xs leading-snug line-clamp-2 min-h-[32px]">
                    {p.name}
                  </h4>
                  <div className="text-amber-400 font-bold text-sm tracking-wide">
                    {formatPrice(p.price)}
                  </div>
                  
                  {/* Tags */}
                  {p.styleTags && p.styleTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {p.styleTags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-zinc-800/60 text-zinc-300 border border-zinc-700/30"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <Button
                  onClick={() => handleSelect(p)}
                  color={isSelected ? "success" : "primary"}
                  variant={isSelected ? "solid" : "soft"}
                  block
                  className={`text-[11px] font-semibold tracking-wider rounded-xl py-1.5 transition-all duration-200 ${
                    isSelected 
                      ? "bg-emerald-600 hover:bg-emerald-500 text-white" 
                      : "bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-zinc-950 border border-amber-500/20"
                  }`}
                >
                  {isSelected ? "Selected ✓" : "Select Style"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
