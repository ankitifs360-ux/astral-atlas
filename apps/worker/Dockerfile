# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.23.3
ARG PNPM_VERSION=12.14.0

# ------------------------------------------------------------
# Base
# ------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base

ARG PNPM_VERSION

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /app


# ------------------------------------------------------------
# Development/build dependencies
#
# Tree-sitter contains native modules, so keep the native build
# toolchain available while pnpm installs dependencies.
# ------------------------------------------------------------
FROM base AS build-dependencies

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY apps/worker/package.json ./apps/worker/package.json

RUN pnpm install \
  --frozen-lockfile \
  --filter @astral-atlas/worker...


# ------------------------------------------------------------
# Build
# ------------------------------------------------------------
FROM build-dependencies AS build

COPY tsconfig.base.json ./

COPY packages/shared ./packages/shared
COPY packages/database ./packages/database
COPY apps/worker ./apps/worker

RUN pnpm --filter @astral-atlas/shared build \
  && pnpm --filter @astral-atlas/database build \
  && pnpm --filter @astral-atlas/worker build


# ------------------------------------------------------------
# Production dependencies only
# ------------------------------------------------------------
FROM base AS production-dependencies

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY apps/worker/package.json ./apps/worker/package.json

RUN pnpm install \
  --prod \
  --frozen-lockfile \
  --filter @astral-atlas/worker...


# ------------------------------------------------------------
# Runtime
# ------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    tini \
  && rm -rf /var/lib/apt/lists/*

# pnpm workspace links point back into these directories,
# therefore preserve the production dependency layout.
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/apps ./apps
COPY --from=production-dependencies --chown=node:node /app/packages ./packages

# Replace source-less workspace packages with their compiled outputs.
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /app/apps/worker/dist ./apps/worker/dist

# Keep migrations with the database workspace package for deployments
# that need access to the schema artifacts.
COPY --from=build --chown=node:node /app/packages/database/drizzle ./packages/database/drizzle

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "apps/worker/dist/server.js"]