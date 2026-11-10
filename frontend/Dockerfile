# Stage 1: Build dependencies & production artifacts
FROM node:20-alpine AS builder

WORKDIR /app/frontend

# Install dependencies based on package-lock.json
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code and build Next.js application
COPY . .
RUN npm run build

# Stage 2: Minimal Production Runner
FROM node:20-alpine AS runner

WORKDIR /app/frontend

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/frontend/package.json ./package.json
COPY --from=builder /app/frontend/node_modules ./node_modules
COPY --from=builder /app/frontend/.next ./.next
COPY --from=builder /app/frontend/public ./public

EXPOSE 3000

CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
