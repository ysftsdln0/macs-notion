FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY collab/package.json ./collab/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY collab ./collab
COPY prisma ./prisma
RUN pnpm prisma generate

FROM base AS run
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/collab ./collab
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src/lib/auth/policy.ts ./src/lib/auth/policy.ts
COPY --from=build /app/src/lib/doc-search-text.ts ./src/lib/doc-search-text.ts
WORKDIR /app/collab
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
