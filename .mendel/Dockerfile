# Build context is the repository root:
#   docker build -f .mendel/Dockerfile --target migrate .
#   docker build -f .mendel/Dockerfile --target adapter .
#
# The files that, when changed, mean this Dockerfile and .mendel/phase/
# should be written again (not the migrations themselves, and not
# prisma/schema.prisma, since an ordinary schema change edits both of those
# and must not make this file look stale):
# depends-on: lib/prisma.js package.json
#
# Pong now stores users, preferences and high scores in MySQL through Prisma
# (see prisma/schema.prisma and lib/prisma.js). The application applies
# prisma/migrations/ against DATABASE_URL at startup with
# `prisma migrate deploy` (see the repository root Dockerfile's CMD) — this
# stage runs exactly that same tool against exactly those same migrations.
#
# It selects its database exactly the way the application does: the single
# environment variable DATABASE_URL, a MySQL connection string, read by
# Prisma Client via prisma/schema.prisma's `url = env("DATABASE_URL")`. That
# is the app's only database-selecting mechanism — no other config file or
# variable exists, so none is added here either.

# ---- builder -----------------------------------------------------------
# Installs only the two Prisma packages the application already depends on
# (never the whole application's dependency tree — express, passport, jest,
# etc. are not needed to apply a migration) and generates the Prisma Client
# for prisma/schema.prisma.
FROM node:20-alpine AS builder
WORKDIR /app

# Prisma's query engine needs OpenSSL at runtime on Alpine (musl) — the same
# package the application's own Dockerfile installs.
RUN apk add --no-cache openssl

# Pull just the "prisma" and "@prisma/client" versions the application
# already depends on (see package.json) into a minimal package.json, so the
# install below fetches only what applying a migration needs.
COPY package.json /tmp/app-package.json
RUN node -e "\
  const pkg = require('/tmp/app-package.json'); \
  const minimal = { \
    name: 'migrate', \
    private: true, \
    dependencies: { '@prisma/client': pkg.dependencies['@prisma/client'] }, \
    devDependencies: { prisma: pkg.devDependencies.prisma } \
  }; \
  require('fs').writeFileSync('package.json', JSON.stringify(minimal, null, 2)); \
"

# prisma/schema.prisma must be present before `npm install` runs, the same
# way the application's own Dockerfile explains it: the postinstall
# "prisma generate" script needs it.
COPY prisma ./prisma
RUN npm install && npx prisma generate

# ---- migrate -------------------------------------------------------------
# Applies every outstanding migration in prisma/migrations/ against
# DATABASE_URL, then exits. `prisma migrate deploy` only ever runs
# migrations already committed to this repo — it never generates new ones
# and never falls back to `prisma db push`. It is a no-op (exit 0) once the
# schema is already current, so running it twice is safe, and it exits
# non-zero with the failure printed to stderr if a migration fails. It
# serves nothing: no port, no listener, no long-running process.
FROM node:20-alpine AS migrate
WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY prisma ./prisma

ENV PATH="/app/node_modules/.bin:${PATH}"

CMD ["sh", "-c", "prisma migrate deploy"]

# ---- adapter ---------------------------------------------------------
# Reports, from the application's own point of view, which persistent
# stores it has, and provides the sandbox-build / sandbox-drop /
# sandbox-describe / sandbox-up / sandbox-down steps used to rehearse a
# migration beside production before it is applied for real: a sandbox is
# built beside the store of record, described, migrated up, described,
# migrated down, described again, and dropped.
# Built on top of the migrate stage so it shares exactly the same runtime,
# drivers and generated Prisma Client — it adds only the /mendel/phase
# executable.
FROM migrate AS adapter

COPY .mendel/phase/phase.js /mendel/phase
RUN chmod +x /mendel/phase

ENTRYPOINT ["/mendel/phase"]
