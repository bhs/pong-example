# Build context is the repository root:
#   docker build -f .mendel/Dockerfile --target migrate .
#
# This application (see server.js's module header) keeps no durable state:
# its "sessions", "scores" and "users" data all live in plain in-process
# JavaScript Map objects and are intentionally lost whenever the process
# restarts. There is no database, no persistent volume, and no external
# store of record — and therefore nothing for this stage to migrate.
#
# It is not skipped: it still builds and runs, but its job is simply to
# report that fact and exit successfully, so that whatever orchestrates a
# deploy can treat "no persistent stores" the same way it treats "schema is
# already up to date" — a successful, uneventful no-op.
FROM node:20-alpine AS migrate

CMD ["sh", "-c", "echo 'This application has no persistent stores to migrate.'"]
