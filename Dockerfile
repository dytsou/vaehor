# syntax=docker/dockerfile:1.4

# Stage 1: Base
FROM node:26-alpine AS base
RUN set -eux; \
  for i in 1 2 3 4 5; do \
  if apk add --no-cache libc6-compat openssl; then \
  break; \
  fi; \
  if [ "$i" -eq 5 ]; then \
  apk add --no-cache libc6-compat openssl3; \
  break; \
  fi; \
  sleep "$((i * 2))"; \
  done
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@11
WORKDIR /app

# Stage 2: Dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile

# Stage 3: Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules

# Optimization: Copy prisma and package.json first to cache generation if schema hasn't changed
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm prisma generate

# Explicit source copy for Next.js build (avoids COPY . . — S6470; see .dockerignore)
COPY app ./app
COPY components ./components
COPY hooks ./hooks
COPY lib ./lib
COPY types ./types
COPY messages ./messages
COPY public ./public
COPY auth.ts i18n.ts proxy.ts next.config.mjs next-env.d.ts tsconfig.json ./
COPY postcss.config.mjs tailwind.config.ts components.json prisma.config.ts ./
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV SKIP_ENV_VALIDATION=1

# Build application with Next.js cache mount
ARG NEXT_PUBLIC_ROOT_FOLDER_ID
ARG NEXT_PUBLIC_ROOT_FOLDER_NAME
ARG NEXT_PUBLIC_ENABLE_LOCAL_STORAGE
ARG NEXT_PUBLIC_LOCAL_STORAGE_NAME
ENV NEXT_PUBLIC_ROOT_FOLDER_ID=$NEXT_PUBLIC_ROOT_FOLDER_ID
ENV NEXT_PUBLIC_ROOT_FOLDER_NAME=$NEXT_PUBLIC_ROOT_FOLDER_NAME
ENV NEXT_PUBLIC_ENABLE_LOCAL_STORAGE=$NEXT_PUBLIC_ENABLE_LOCAL_STORAGE
ENV NEXT_PUBLIC_LOCAL_STORAGE_NAME=$NEXT_PUBLIC_LOCAL_STORAGE_NAME

RUN --mount=type=cache,target=/app/.next/cache pnpm run build

# Stage 4: Runner
FROM node:26-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
  adduser --system --uid 1001 nextjs && \
  set -eux; \
  for i in 1 2 3 4 5; do \
  if apk add --no-cache curl dumb-init postgresql-client openssl; then \
  break; \
  fi; \
  if [ "$i" -eq 5 ]; then \
  apk add --no-cache curl dumb-init postgresql-client openssl3; \
  break; \
  fi; \
  sleep "$((i * 2))"; \
  done

# Install prisma CLI for migrations; bcryptjs for hash-password.sh (omitted from standalone trace)
RUN npm install -g prisma@7.7.0 && \
  mkdir -p /app/hash-tool && cd /app/hash-tool && \
  npm install bcryptjs@3.0.2 --omit=dev --no-package-lock && \
  chmod -R a-w /app/hash-tool

# Copy necessary files from builder (root-owned, no write bit — S6504)
COPY --from=builder --chown=root:root --chmod=555 /app/public ./public
COPY --from=builder --chown=root:root --chmod=555 /app/.next/standalone ./
COPY --from=builder --chown=root:root --chmod=555 /app/.next/static ./.next/static
COPY --from=builder --chown=root:root --chmod=555 /app/prisma ./prisma
COPY --from=builder --chown=root:root --chmod=444 /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=root:root --chmod=555 /app/scripts ./scripts

# Note: Standalone mode already includes necessary node_modules in .next/standalone/node_modules
# We no longer need to copy the entire /app/node_modules from builder.

# Script to run migrations and start
RUN <<'SETUP_ENTRYPOINT'
cat <<'ENTRY' > /app/entrypoint.sh
#!/bin/sh
set -e
if [ -n "$DATABASE_URL" ]; then
  echo "Checking database existence..."
  DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\).*/\1/p' | cut -d/ -f1)
  DB_USER=$(echo $DATABASE_URL | sed -n 's/.*\/\/\([^:]*\).*/\1/p')
  DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p' | rev | cut -d/ -f1 | rev)
  DB_PASS=$(echo $DATABASE_URL | sed -n 's/.*:\([^@]*\)@.*/\1/p')

  echo "Waiting for postgres to be ready..."
  until PGPASSWORD=$DB_PASS psql -h "$DB_HOST" -U "$DB_USER" -d postgres -c '\q' 2>/dev/null; do sleep 1; done

  echo "Ensuring database $DB_NAME exists..."
  DB_EXISTS=$(PGPASSWORD=$DB_PASS psql -h "$DB_HOST" -U "$DB_USER" -d postgres \
    -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" \
    2>/dev/null || echo "0")
  if [ "$DB_EXISTS" != "1" ]; then
    echo "Creating database $DB_NAME..."
    PGPASSWORD=$DB_PASS psql -h "$DB_HOST" -U "$DB_USER" -d postgres \
      -c "CREATE DATABASE \"$DB_NAME\"" || echo "Database may already exist"
  fi
fi
echo "Running database migrations..."
# Use global prisma installed earlier
if [ -d "prisma/migrations" ]; then \
  prisma migrate deploy; \
else \
  prisma db push --accept-data-loss; \
fi || echo "Prisma migration failed, continuing..."
exec "$@"
ENTRY
tr -d '\r' < /app/entrypoint.sh > /app/entrypoint.sh.fixed
mv /app/entrypoint.sh.fixed /app/entrypoint.sh
chmod +x /app/entrypoint.sh
SETUP_ENTRYPOINT

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--", "/app/entrypoint.sh"]
CMD ["node", "server.js"]
