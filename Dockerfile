# ── Stage 1: Test runner (Node) ───────────────────────────────────────────────
# Used by `docker build --target test` to run Jest unit tests.
# The Mendel test harness will exec `npm test` in this stage.

FROM node:20-alpine AS test

WORKDIR /app

# Install dependencies (Jest)
COPY package.json ./
RUN npm install

# Copy source files for testing
COPY . .

# Default command runs the test suite
CMD ["npm", "test"]

# ── Stage 2: Production (nginx static server) ─────────────────────────────────
# Minimal nginx container that serves index.html.
# The Supabase SDK is loaded from CDN at runtime; no build step required.

FROM nginx:1.27-alpine AS production

# Remove default nginx config and replace with our own
RUN rm /etc/nginx/conf.d/default.conf

# Copy our nginx server block config
COPY nginx.conf /etc/nginx/conf.d/pong.conf

# Copy the static game file into nginx's web root
COPY index.html /usr/share/nginx/html/index.html

# Expose the port nginx listens on (matches fly.toml internal_port)
EXPOSE 8080

# nginx's default entrypoint runs in the foreground; no override needed
CMD ["nginx", "-g", "daemon off;"]

# The default target is production for `docker build` (no --target flag).
# fly deploy and docker-compose.demo.yml use this stage.
FROM production
