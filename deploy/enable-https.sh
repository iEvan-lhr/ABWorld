#!/bin/sh
set -eu
cd "${ABWORLD_DIR:-/home/ubuntu/abworld}"
certbot="${CERTBOT:-certbot}"
webroot="${ABWORLD_ACME_ROOT:-$PWD/.acme}"
mkdir -p "$webroot/.well-known/acme-challenge"
"$certbot" certonly --non-interactive --agree-tos --register-unsafely-without-email --webroot -w "$webroot" --ip-address "${ABWORLD_PUBLIC_IP:-111.229.171.148}" --preferred-profile shortlived --cert-name abworld-ip --keep-until-expiring
docker compose -f compose.yaml -f compose.https.yaml up -d --no-build web
docker compose exec -T web nginx -s reload
