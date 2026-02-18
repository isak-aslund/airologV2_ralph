#!/bin/sh
set -e

CERT_DIR="/etc/nginx/certs"

if [ ! -f "$CERT_DIR/cert.pem" ] || [ ! -f "$CERT_DIR/key.pem" ]; then
  echo "No SSL certs found, generating self-signed certificate..."
  mkdir -p "$CERT_DIR"
  openssl req -x509 -newkey rsa:2048 \
    -keyout "$CERT_DIR/key.pem" \
    -out "$CERT_DIR/cert.pem" \
    -days 365 -nodes -subj '/CN=localhost'
fi

exec nginx -g 'daemon off;'
