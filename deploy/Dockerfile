# Optional: PatchPlaner als Container. Bauen aus dem Projektordner:
#   docker build -f deploy/Dockerfile -t patchplaner .
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN mkdir -p /data && chown -R node:node /data /app
USER node
ENV PORT=8080 HOST=0.0.0.0 DATA_DIR=/data
EXPOSE 8080
VOLUME ["/data"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
