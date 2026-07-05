# Single-stage production image for HerWell backend
FROM node:20-alpine

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install production dependencies only (cached layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY src ./src

# Own the entire /app directory so the non-root user can run the app
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "src/server.js"]
