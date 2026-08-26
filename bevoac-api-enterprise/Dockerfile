FROM node:24-alpine
RUN apk add --no-cache --upgrade libcrypto3 libssl3

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --registry=https://registry.npmjs.org/ \
  && node -e "require('fastify'); require('@fastify/cors'); require('@fastify/rate-limit'); require('pg'); require('@azure/service-bus'); require('@azure/identity'); require('pdfmake'); console.log('api dependencies verified')" \
  && npm cache clean --force

COPY . .
RUN npm run check:image
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx
RUN chown -R node:node /app
USER node

EXPOSE 8080
CMD ["node", "src/server.js"]
