# BlueberryChain OS - Control Tower (Next.js) for Cloud Run
FROM node:22-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app
COPY . .
RUN NODE_ENV=development pnpm install --frozen-lockfile \
 && pnpm -r --if-present build
WORKDIR /app/apps/control-tower
ENV PORT=8080
EXPOSE 8080
# Cloud Run injects PORT; secrets (Snowflake etc.) come from env / Secret Manager, never from the image.
CMD ["sh", "-c", "node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT}"]
