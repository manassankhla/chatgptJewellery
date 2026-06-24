import { NextRequest } from "next/server";
import products from "@/data/products.json";
import { recommendJewellery } from "@/lib/recommendation";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const { tool, input } = body;

  switch (tool) {
    case "search_jewellery": {
      const recommendations = recommendJewellery(input)
        .filter((item) => item.score > 0)
        .map((item) => {
          const reasons: string[] = [];

          if (
            input?.occasion &&
            item.aiTags.occasionTags.includes(
              input.occasion.toLowerCase()
            )
          ) {
            reasons.push(
              `Matches ${input.occasion} occasion`
            );
          }

          if (
            input?.outfitColor &&
            item.aiTags.bestOutfitColours.includes(
              input.outfitColor.toLowerCase()
            )
          ) {
            reasons.push(
              `Matches ${input.outfitColor} outfit colour`
            );
          }

          if (
            input?.outfitType &&
            item.aiTags.bestOutfitTypes.includes(
              input.outfitType.toLowerCase()
            )
          ) {
            reasons.push(
              `Suitable for ${input.outfitType}`
            );
          }

          return {
            id: item.id,
            name: item.name,
            price: item.price,
            image: item.image,
            score: item.score,
            reasons,
          };
        });

      return Response.json({
        success: true,
        results: recommendations,
      });
    }

    case "get_product": {
      const product = products.find(
        (p) => p.id === input.id
      );

      if (!product) {
        return Response.json({
          success: false,
          error: "Product not found",
        });
      }

      return Response.json({
        success: true,
        product,
      });
    }

    default:
      return Response.json({
        success: false,
        error: "Unknown tool",
      });
  }
}

