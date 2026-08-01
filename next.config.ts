import type { NextConfig } from "next";

const githubRepository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const githubPagesBasePath =
  isGitHubPages && githubRepository
    ? `/${githubRepository}`
    : "";
const prsProxyPort = process.env.PRS_PROXY_PORT ?? "3010";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: githubPagesBasePath,
  trailingSlash: true,
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "http", hostname: "127.0.0.1", pathname: "/**" },
      { protocol: "http", hostname: "localhost", pathname: "/**" },
    ],
  },
  ...(process.env.NODE_ENV === "production" ? { devIndicators: false } : {}),
  typescript: {
    tsconfigPath: isGitHubPages ? "tsconfig.pages.json" : "tsconfig.next.json",
  },
  async rewrites() {
    if (isGitHubPages) return [];
    // Local presentation: browser → Next → prs-proxy (SSE-safe) → Tailscale PRS.
    return [
      {
        source: "/prs-api/:path*",
        destination: `http://127.0.0.1:${prsProxyPort}/prs-api/:path*`,
      },
    ];
  },
};

export default nextConfig;
