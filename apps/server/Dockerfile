FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
RUN npm ci --workspace @transit/server --omit=dev --include-workspace-root=false
COPY apps/server/src apps/server/src
WORKDIR /app/apps/server
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 8080
CMD ["node", "src/index.ts"]
