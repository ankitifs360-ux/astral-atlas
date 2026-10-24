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
# Build dependencies
# ------------------------------------------------------------
FROM base AS build-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY apps/api/package.json ./apps/api/package.json

RUN pnpm install \
  --frozen-lockfile \
  --filter @astral-atlas/api...


# ------------------------------------------------------------
# Build
# ------------------------------------------------------------
FROM build-dependencies AS build

COPY tsconfig.base.json ./

COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/shared/tsconfig.build.json ./packages/shared/tsconfig.build.json
COPY packages/shared/src ./packages/shared/src

COPY packages/database/tsconfig.json ./packages/database/tsconfig.json
COPY packages/database/tsconfig.build.json ./packages/database/tsconfig.build.json
COPY packages/database/src ./packages/database/src

COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/tsconfig.build.json ./apps/api/tsconfig.build.json
COPY apps/api/src ./apps/api/src

# API owns a pinned TypeScript compiler, so use that compiler for
# all three production builds. shared/database must exist first
# because API resolves their compiled package exports.
RUN pnpm --filter @astral-atlas/api exec \
      tsc -p ../../packages/shared/tsconfig.build.json \
  && pnpm --filter @astral-atlas/api exec \
      tsc -p ../../packages/database/tsconfig.build.json \
  && pnpm --filter @astral-atlas/api build


# ------------------------------------------------------------
# Production dependencies
# ------------------------------------------------------------
FROM base AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY apps/api/package.json ./apps/api/package.json

RUN pnpm install \
  --prod \
  --frozen-lockfile \
  --filter @astral-atlas/api...


# ------------------------------------------------------------
# Runtime
# ------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

# git is required by repository ingestion.
# tini forwards shutdown signals correctly to Node.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    tini \
  && rm -rf /var/lib/apt/lists/*

# Keep pnpm's workspace/symlink layout from the production install.
COPY --from=production-dependencies --chown=node:node \
  /app/node_modules \
  ./node_modules

COPY --from=production-dependencies --chown=node:node \
  /app/apps \
  ./apps

COPY --from=production-dependencies --chown=node:node \
  /app/packages \
  ./packages

# Add only compiled application/workspace outputs.
COPY --from=build --chown=node:node \
  /app/packages/shared/dist \
  ./packages/shared/dist

COPY --from=build --chown=node:node \
  /app/packages/database/dist \
  ./packages/database/dist

COPY --from=build --chown=node:node \
  /app/apps/api/dist \
  ./apps/api/dist

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "apps/api/dist/server.js"]