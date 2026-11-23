import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  async rewrites() {
    return [
      { source: "/mcp", destination: "/api/mcp" },
      { source: "/healthz", destination: "/api/health" },
      { source: "/readyz", destination: "/api/readyz" },
      { source: "/metrics", destination: "/api/metrics" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
