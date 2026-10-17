FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace @transit/server --workspace @transit/shared --omit=dev --include-workspace-root=false
COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src
WORKDIR /app/apps/server
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 8080
CMD ["node", "src/index.ts"]
