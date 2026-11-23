# syntax=docker/dockerfile:1
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL is only needed so modules can be imported during `next build` (no connection is made)
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8787
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app ./
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD curl -fs http://127.0.0.1:${PORT}/healthz || exit 1
# Apply schema (idempotent), then start. Admin + #general are bootstrapped on first request/boot.
CMD ["sh", "-c", "npx drizzle-kit push --force --config=docker/drizzle.docker.config.ts && npx next start -p ${PORT}"]
