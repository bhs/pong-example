FROM node:20-alpine

WORKDIR /app

# Prisma's query engine binaries need OpenSSL at runtime on Alpine (musl).
RUN apk add --no-cache openssl

# Install dependencies (express, express-session, passport,
# passport-google-oauth20, @prisma/client, prisma). The prisma schema must
# be present before `npm install` runs so its "postinstall": "prisma
# generate" script can find prisma/schema.prisma.
COPY package.json ./
COPY prisma ./prisma
RUN npm install

# Copy the rest of the source files
COPY . .

# The app reads PORT at runtime (defaulting to 3000 if unset) and binds 0.0.0.0.
ENV PORT=3000
EXPOSE 3000

# Health check hits the app's own /health endpoint on whatever PORT it bound.
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -q --spider "http://127.0.0.1:${PORT:-3000}/health" || exit 1

# On startup: if DATABASE_URL is configured, apply exactly the migration(s)
# checked into prisma/migrations/ against it — `prisma migrate deploy` only
# ever runs migrations that are already committed to this repo; it never
# generates new ones and never falls back to `prisma db push`. A fresh
# managed MySQL instance is schema-ready after this with zero manual steps.
#
# If DATABASE_URL is NOT set (e.g. this repo's own test container, which
# intentionally runs with no database attached), skip the migration step
# instead of letting the `prisma migrate deploy` CLI hard-fail on the
# missing env var before the process ever starts. lib/prisma.js already
# tolerates a missing DATABASE_URL at require-time, so the Express server
# itself still boots fine either way.
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then npx prisma migrate deploy || exit 1; fi; exec node server.js"]
