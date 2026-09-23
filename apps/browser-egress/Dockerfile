FROM oven/bun:1.3.14 AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14
WORKDIR /app
COPY package.json tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY packages ./packages
COPY apps/browser-egress ./apps/browser-egress
USER bun
CMD ["bun", "apps/browser-egress/src/index.ts"]
