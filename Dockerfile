FROM node:20-alpine

WORKDIR /app

# Install dependencies (express, bcryptjs, cookie-parser, uuid)
COPY package.json ./
RUN npm install --production=false

# Copy source files
COPY . .

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

# Start the Express server (serves static Pong game + REST API)
CMD ["node", "server.js"]
