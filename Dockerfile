# ─── Stage 1: Build del backend ────────────────────────────────
FROM node:22-alpine AS backend-builder

WORKDIR /app
COPY package*.json ./
RUN npm install --ignore-scripts && npm rebuild better-sqlite3
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc && mkdir -p dist/biocore/config && cp src/biocore/config/*.json dist/biocore/config/

# ─── Stage 2: Build del dashboard ──────────────────────────────
FROM node:22-alpine AS dashboard-builder

WORKDIR /dashboard
COPY dashboard/package*.json ./
RUN npm install
COPY dashboard/ ./
RUN npm run build

# ─── Stage 3: Runtime ──────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/package.json ./
COPY --from=dashboard-builder /dashboard/dist ./dashboard-dist

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/biocore.db
ENV DASHBOARD_PATH=/app/dashboard-dist

EXPOSE 3000

CMD ["node", "dist/biocore/server/ProductionServer.js"]
