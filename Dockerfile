# Dockerfile for the RAG HTTP service (Phase 15.1).
# Build: docker build -t rag-service .
# Run:   docker run -p 8080:8080 --env-file .env rag-service
#
# Requires real provider env vars (LLM_API_KEY, VECTOR_DB_URL, EMBEDDING_MODEL, ...)
# to be supplied at runtime; the image itself contains no secrets.

FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Compile TypeScript to dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove dev dependencies and source to keep the image small.
RUN npm ci --omit=dev

EXPOSE 8080

# The service entry point reads config from environment and starts the HTTP server.
# PORT defaults to 8080; HOST defaults to 0.0.0.0.
CMD ["node", "dist/cli.js"]
