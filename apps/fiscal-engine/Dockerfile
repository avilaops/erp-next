FROM node:24-alpine
WORKDIR /app
COPY apps/fiscal-engine/package.json apps/fiscal-engine/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY apps/fiscal-engine/src ./src
COPY apps/fiscal-engine/scripts ./scripts
ENV FISCAL_ENGINE_BIND=0.0.0.0 FISCAL_ENGINE_PORT=8091
USER node
EXPOSE 8091
CMD ["npm", "start"]
