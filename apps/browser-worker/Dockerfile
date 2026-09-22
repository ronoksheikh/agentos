FROM oven/bun:1.3.14 AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14 AS base
WORKDIR /app
COPY package.json tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY packages ./packages
COPY apps/browser-worker ./apps/browser-worker

FROM base AS egress
USER bun
CMD ["bun", "apps/browser-worker/src/egress.ts"]

FROM oven/bun:1.3.14 AS chromium
USER root
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates && rm -rf /var/lib/apt/lists/*

FROM chromium AS browser
WORKDIR /app
COPY --from=base /app /app
USER bun
CMD ["bun", "apps/browser-worker/src/index.ts"]
