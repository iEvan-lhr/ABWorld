FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global pnpm@11.1.0 && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
FROM nginx:stable-alpine
COPY deploy/http.conf /etc/nginx/conf.d/default.conf
COPY deploy/site.inc /etc/nginx/abworld-site.inc
COPY --from=build /app/dist/ /usr/share/nginx/html/
