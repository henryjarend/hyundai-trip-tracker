# One image, two entrypoints: the API server and the poller. Node runs the
# TypeScript sources directly via native type stripping, so there is no build step
# for the server — only the frontend is compiled.
# Fully qualified so Podman doesn't need short-name registry resolution configured.
FROM docker.io/library/node:26-alpine

WORKDIR /app

# `unzip` is needed by the GeoNames loader; Node has no built-in zip reader.
RUN apk add --no-cache unzip

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm ci --no-audit --no-fund

COPY . .

RUN npm run -w web build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server/src/api/server.ts"]
