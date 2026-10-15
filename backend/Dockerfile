# Production Dockerfile for MedoFlow Backend
FROM node:20-slim AS builder

# Install system dependencies for building and AI processing
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# --- Production Image ---
FROM node:20-slim

# Install runtime dependencies (ffmpeg is needed for transcription)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Expose port
EXPOSE 3000

# Run migrations, conditionally seed, then start server.
# Migrations run as the table owner (MIGRATION_DATABASE_URL); the server runs
# as the non-owner, non-BYPASSRLS medoflow_app role (DATABASE_URL) so Postgres
# row-level security applies to it (B0.1.3). Without MIGRATION_DATABASE_URL
# both use DATABASE_URL (local development only — production refuses to boot
# on a role that bypasses RLS).
# Set SEED_ON_DEPLOY=true to seed demo data on first deploy.
CMD ["sh", "-c", "DATABASE_URL=\"${MIGRATION_DATABASE_URL:-$DATABASE_URL}\" npx prisma migrate deploy && if [ \"$SEED_ON_DEPLOY\" = \"true\" ]; then DATABASE_URL=\"${MIGRATION_DATABASE_URL:-$DATABASE_URL}\" npx ts-node prisma/seed_demo.ts; fi && node dist/server.js"]
