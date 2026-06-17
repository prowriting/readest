FROM docker.io/library/node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e AS dependencies
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@11.1.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/readest-app/package.json ./apps/readest-app/
COPY patches/ ./patches/
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile
RUN test -f packages/foliate-js/vendor/pdfjs/annotation_layer_builder.css \
    && test -d packages/simplecc-wasm/dist/web \
    || { printf '\nERROR: Required git submodules are not initialized in the source directory.\nEnsure submodules are initialized before running docker build.\nRun: git submodule update --init packages/foliate-js packages/simplecc-wasm\n\n'; exit 1; }
RUN pnpm --filter @readest/readest-app setup-vendors

FROM docker.io/library/node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e AS development-stage
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@11.1.1 --activate
WORKDIR /app
COPY --from=dependencies /app /app
COPY . .
WORKDIR /app/apps/readest-app
EXPOSE 3000
ENTRYPOINT ["pnpm", "dev-web", "-H", "0.0.0.0"]

FROM docker.io/library/node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@11.1.1 --activate
WORKDIR /app
# NEXT_PUBLIC_* vars are baked into the bundle at build time
ARG NEXT_PUBLIC_APP_PLATFORM=web
ARG NEXT_PUBLIC_API_BASE_URL=https://reader.bookarc.app
ARG NEXT_PUBLIC_OBJECT_STORAGE_TYPE
ARG NEXT_PUBLIC_STORAGE_FIXED_QUOTA
ARG NEXT_PUBLIC_TRANSLATION_FIXED_QUOTA
ARG NEXT_PUBLIC_USE_APPLE_SIGN_IN=true
COPY --from=dependencies /app/node_modules /app/node_modules
COPY --from=dependencies /app/apps/readest-app/node_modules /app/apps/readest-app/node_modules
COPY --from=dependencies /app/apps/readest-app/public/vendor /app/apps/readest-app/public/vendor
COPY --from=dependencies /app/packages/foliate-js/node_modules /app/packages/foliate-js/node_modules
COPY . .
WORKDIR /app/apps/readest-app
ENV NODE_OPTIONS="--max-old-space-size=3072"
RUN pnpm build-web

FROM docker.io/library/node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e AS production-stage
RUN groupadd -r appgroup && useradd -r -g appgroup appuser
WORKDIR /app
COPY --from=build --chown=appuser:appgroup /app /app
USER appuser
WORKDIR /app/apps/readest-app
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
ENTRYPOINT ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
