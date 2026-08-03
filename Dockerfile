# Presentation deck + loopback PRS proxy + public gateway (single published port).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
# Production client always uses same-origin /prs-api (no public :3010).
ARG NEXT_PUBLIC_PRS_LIVE=0
ARG NEXT_PUBLIC_PRS_PROXY_PORT=3010
ENV NEXT_PUBLIC_PRS_LIVE=$NEXT_PUBLIC_PRS_LIVE
ENV NEXT_PUBLIC_PRS_PROXY_PORT=$NEXT_PUBLIC_PRS_PROXY_PORT
ENV NODE_ENV=production
RUN npm run build:docker

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_INTERNAL_PORT=3001
ENV PRS_PROXY_PORT=3010
ENV PRS_PROXY_BIND=127.0.0.1
ENV PRS_HOST=http://100.91.252.69:8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/app ./app
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.next.json ./tsconfig.next.json
COPY --from=builder /app/next-env.d.ts ./next-env.d.ts
COPY --from=builder /app/scripts/prs-proxy.mjs ./scripts/prs-proxy.mjs
COPY --from=builder /app/scripts/presentation-gateway.mjs ./scripts/presentation-gateway.mjs
COPY --from=builder /app/scripts/docker-start.mjs ./scripts/docker-start.mjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/docker-start.mjs"]
