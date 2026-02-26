# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built output
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Create input/output directories with correct permissions
RUN mkdir -p /app/input /app/output && \
    chown -R appuser:appgroup /app/input /app/output

USER appuser

# Default entrypoint
ENTRYPOINT ["node", "dist/main/index.js"]
CMD ["--help"]

# Runtime environment
ENV NODE_ENV=production
