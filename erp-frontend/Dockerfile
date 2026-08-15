FROM node:22-alpine AS build
WORKDIR /src
COPY erp-frontend/package.json erp-frontend/package-lock.json ./
RUN npm ci
COPY erp-frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
