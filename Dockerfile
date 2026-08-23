FROM node:20-alpine

WORKDIR /app

# Install dependencies (production + dev for test runs)
COPY package.json ./
RUN npm install

# Copy application source
COPY . .

# Expose the API/static-file port
EXPOSE 3000

# Default: start the Express API server (runs migrations, then serves requests)
CMD ["node", "server.js"]
