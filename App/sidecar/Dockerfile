FROM node:20-alpine

WORKDIR /app

COPY package*.json tsconfig.json /app/
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY src /app/src
RUN npm run build

EXPOSE 3001

HEALTHCHECK --interval=5s --timeout=3s --retries=20 CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["npm", "run", "start"]
