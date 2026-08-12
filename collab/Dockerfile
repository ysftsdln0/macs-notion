FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY collab/package.json ./collab/
RUN pnpm install --frozen-lockfile

FROM base AS build
# Manifest'ler node_modules'dan ÖNCE gelmeli: pnpm her komuttan önce
# /app/package.json'ı okur, yoksa ERR_PNPM_NO_PKG_MANIFEST ile durur (ve
# corepack, "packageManager" alanını göremediği için pnpm'in yanlış
# sürümünü indirir).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY collab ./collab
COPY prisma ./prisma
COPY src/lib ./src/lib
# Workspace paketinin kendi node_modules'ı ayrı bir ağaçtır (pnpm symlink
# deposu); yalnızca kökü kopyalamak collab'ın bağımlılıklarını (hocuspocus,
# tsx) dışarıda bırakırdı. Kaynak `collab` kopyasından SONRA gelir, çünkü
# COPY dizinleri birleştirir ve sıra tersine dönerse bu ağaç ezilir.
COPY --from=deps /app/collab/node_modules ./collab/node_modules
# Şemadaki `collab_client` generator'ı collab/generated/prisma altına yazar.
RUN pnpm prisma generate

FROM base AS run
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/collab ./collab
COPY --from=build /app/prisma ./prisma
# Collab sunucusu yetki kararını web ile AYNI policy dosyasından verir ve
# token'ları aynı imza modülüyle doğrular; bu dosyalar imajda yoksa
# konteyner ilk import'ta çöker.
COPY --from=build /app/src/lib ./src/lib
WORKDIR /app/collab
# pnpm üzerinden değil doğrudan tsx: `pnpm exec` her çağrıda bağımlılık
# durumu kontrolü yapıp kurulum denemeye kalkar, production imajında
# gereksiz ve ağsız ortamda kırılgan.
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
