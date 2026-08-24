FROM node:24-alpine

RUN apk add --no-cache nmap ca-certificates
WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --registry=https://registry.npmjs.org/ \
  && node -e "require('pg'); require('@azure/service-bus'); require('ajv'); require('ajv/dist/2020'); require('@azure/identity'); console.log('worker dependencies verified')" \
  && npm cache clean --force

COPY . .

# Build-time guard: the worker must include the scanners tree.
# This prevents deploying an image that boots with MODULE_NOT_FOUND.
RUN test -f scanners/generic/checkHeaders.js   && test -f scanners/generic/checkSSL.js   && test -f scanners/generic/checkDNS.js   && test -f scanners/generic/runNmap.js   && node --check src/index.js   && node --check src/services/audit-runner.js

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx

RUN chown -R node:node /usr/src/app
USER node
CMD ["node", "src/index.js"]
