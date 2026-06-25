import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/widget/cards",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com",
          },
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
