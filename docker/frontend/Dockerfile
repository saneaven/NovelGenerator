FROM node:20-bookworm-slim

WORKDIR /app/App/frontend

COPY App/frontend/package.json /app/App/frontend/package.json
COPY App/frontend/package-lock.json /app/App/frontend/package-lock.json
RUN npm ci

COPY App/frontend /app/App/frontend
COPY docker/frontend/entrypoint.sh /app/docker/frontend/entrypoint.sh

RUN chmod +x /app/docker/frontend/entrypoint.sh

EXPOSE 5173

ENTRYPOINT ["/app/docker/frontend/entrypoint.sh"]
