import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = { outputFileTracingRoot: path.join(process.cwd()), transpilePackages: ["@agentos/auth", "@agentos/database", "@agentos/control-plane", "@agentos/shared"] };
export default config;
