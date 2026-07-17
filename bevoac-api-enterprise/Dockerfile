FROM node:24-alpine

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
RUN chown -R node:node /app
USER node

EXPOSE 8080
CMD ["npm", "start"]
