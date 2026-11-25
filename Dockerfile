FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY src ./src
COPY db/migrations ./db/migrations
RUN npm run build
# Copied after the build so the helper never enters the traced server output.
COPY scripts/collect-image-notices.ts ./scripts/collect-image-notices.ts
RUN node scripts/collect-image-notices.ts --root /app --standalone /app/.next/standalone \
      --out /app/third-party-licenses

FROM node:24-bookworm-slim AS runtime
ARG TARGETARCH
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3180 \
    DOTNET_BUNDLE_EXTRACT_BASE_DIR=/tmp/dotnet-bundle \
    CLOUDSIGHT_DATA_DIR=/var/lib/cloudsight/data \
    CLOUDSIGHT_SECRETS_DIR=/var/lib/cloudsight/secrets \
    CLOUDSIGHT_BICEP_PATH=/usr/local/bin/bicep
# Exact release and official GitHub asset digests; never download a floating compiler.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libicu72 \
    && case "$TARGETARCH" in \
         arm64) asset=arm64; digest=48d8f152bd78c8848a41a07ac2d12b573306d9329fc961a85354a98a95cc275e ;; \
         amd64) asset=x64; digest=0ab9de90c2493f206f8281bae74f9ee2d5ed3605548dab1adf41fef185e1f7c5 ;; \
         *) exit 1 ;; esac \
    && curl --fail --location --proto '=https' --tlsv1.2 \
      "https://github.com/Azure/bicep/releases/download/v0.49.2/bicep-linux-$asset" -o /usr/local/bin/bicep \
    && echo "$digest  /usr/local/bin/bicep" | sha256sum -c - \
    && chmod 755 /usr/local/bin/bicep \
    && /usr/local/bin/bicep --version \
    && useradd --uid 10001 --create-home cloudsight \
    && install -d -m 700 -o cloudsight -g cloudsight /var/lib/cloudsight /var/lib/cloudsight/data /var/lib/cloudsight/secrets
WORKDIR /app
RUN install -d -m 0755 /app/.cloudmaru-pricing
COPY --from=build --chown=cloudsight:cloudsight /app/.next/standalone ./
COPY --from=build --chown=cloudsight:cloudsight /app/.next/static ./.next/static
COPY --from=build --chown=cloudsight:cloudsight /app/db/migrations ./db/migrations
# Exact-version license/notice texts and manifest; root-owned and read-only for the service UID.
COPY --from=build /app/third-party-licenses ./third-party-licenses
COPY LICENSE THIRD_PARTY_NOTICES.md ./
USER 10001:10001
# Host networking keeps this loopback-only on Linux. Do not add a public bind.
CMD ["sh", "-c", "HOSTNAME=127.0.0.1 exec node server.js"]
