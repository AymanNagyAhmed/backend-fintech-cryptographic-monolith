#!/bin/sh
# Load Docker secret files into process env (A-B16.2), then exec the app.
# For each VAR_FILE=/path, if VAR is unset/empty, set VAR from the file contents.
set -eu

load_secret() {
  var_name=$1
  file_var="${var_name}_FILE"
  # Indirect expansion without bash
  eval "file_path=\${$file_var-}"
  eval "current=\${$var_name-}"
  if [ -n "${file_path}" ] && [ -f "${file_path}" ] && [ -z "${current}" ]; then
    value=$(cat "${file_path}")
    # Use printf %s to avoid interpretating escapes in secrets
    export "${var_name}=${value}"
  fi
}

load_secret JWT_ACCESS_SECRET
load_secret JWT_REFRESH_SECRET
load_secret TOTP_ENCRYPTION_KEY
load_secret API_CLIENT_ENCRYPTION_KEY
load_secret WEBHOOK_SECRET_STRIPE
load_secret STRIPE_SECRET_KEY
load_secret BAO_TOKEN

if [ -z "${REDIS_PASSWORD-}" ] && [ -f /run/secrets/redis_password ]; then
  REDIS_PASSWORD=$(cat /run/secrets/redis_password)
  export REDIS_PASSWORD
fi

if [ -z "${REDIS_URL-}" ] && [ -n "${REDIS_PASSWORD-}" ]; then
  export REDIS_URL="redis://:${REDIS_PASSWORD}@${REDIS_HOST:-redis}:6379"
fi

exec "$@"
