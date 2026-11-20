FROM golang:1.24-bookworm AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api .
FROM node:24-bookworm-slim AS runtime
RUN mkdir -p /etc/ssl/certs && node -e "require('node:fs').writeFileSync('/etc/ssl/certs/ca-certificates.crt', require('node:tls').rootCertificates.join('\n') + '\n')"
RUN test -s /etc/ssl/certs/ca-certificates.crt
WORKDIR /app
COPY backend/world/ backend/world/
COPY frontend/src/ frontend/src/
COPY public/洛阳漫游资源/tiles/ public/洛阳漫游资源/tiles/
RUN mkdir -p .world && chown node:node .world
COPY --from=build /out/api /usr/local/bin/abworld-api
USER node
ENTRYPOINT ["abworld-api"]
