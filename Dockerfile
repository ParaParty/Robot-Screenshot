# syntax=docker/dockerfile:1
FROM node:16 as BUILD_IMAGE
WORKDIR /app

RUN curl -f https://get.pnpm.io/v6.14.js | node - add --global pnpm

COPY package.json pnpm-lock.yaml ./

RUN pnpm i --frozen-lockfile --strict-peer-dependencies

COPY . .

RUN pnpm proto

RUN pnpm build

RUN pnpm prune --prod

FROM node:16-buster-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=BUILD_IMAGE /app/dist ./dist
COPY --from=BUILD_IMAGE /app/node_modules ./node_modules
COPY --from=BUILD_IMAGE /app/package.json ./package.json

EXPOSE 3000
CMD ["node", "."]
