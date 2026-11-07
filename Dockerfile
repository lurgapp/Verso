FROM node:22.23.4-trixie-slim AS media
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends build-essential pkg-config nasm curl xz-utils file ca-certificates libx264-dev libdav1d-dev zlib1g-dev && rm -rf /var/lib/apt/lists/*
COPY scripts/build-media.sh /usr/local/bin/build-media.sh
COPY infra/media-source/ /tmp/verso-media-source/
RUN /usr/local/bin/build-media.sh

FROM node:22.23.4-trixie-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends openssl ca-certificates libx264-164 libdav1d7 zlib1g && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS migration
COPY prisma ./prisma
RUN npx prisma generate
CMD ["npx", "prisma", "migrate", "deploy"]

FROM dependencies AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22.23.4-trixie-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends openssl ca-certificates libx264-164 libdav1d7 zlib1g && rm -rf /var/lib/apt/lists/* && groupadd --gid 1001 verso && useradd --uid 1001 --gid verso verso
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=verso:verso /app/.next/standalone ./
COPY --from=builder --chown=verso:verso /app/.next/static ./.next/static
COPY --from=builder --chown=verso:verso /app/public ./public
COPY --from=media /opt/ffmpeg/bin/ /usr/local/bin/
COPY --from=media /opt/ffmpeg/share/verso-media/ /usr/local/share/verso-media/
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx
USER verso
EXPOSE 3000
CMD ["node", "server.js"]
