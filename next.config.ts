import type { NextConfig } from "next";

const githubRepository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const githubPagesBasePath =
  isGitHubPages && githubRepository
    ? `/${githubRepository}`
    : "";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: githubPagesBasePath,
  trailingSlash: true,
  images: { unoptimized: true },
  typescript: {
    tsconfigPath: isGitHubPages ? "tsconfig.pages.json" : "tsconfig.json",
  },
};

export default nextConfig;
