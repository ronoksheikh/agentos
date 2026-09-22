import type { NextConfig } from "next";
const config: NextConfig = { transpilePackages: ["@agentos/auth", "@agentos/database"] };
export default config;
