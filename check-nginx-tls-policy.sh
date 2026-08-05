#!/usr/bin/env bash
set -euo pipefail

certbot_policy_file="${1:-/etc/letsencrypt/options-ssl-nginx.conf}"
site_config_file="${2:-nginx-http-8601.conf}"
policy_pattern='ssl_(session_cache|session_timeout|protocols|prefer_server_ciphers|ciphers)[[:space:]]'

certbot_policy="$(grep -E "^${policy_pattern}" "$certbot_policy_file" | sed -E 's/^[[:space:]]+//;s/\r$//' | awk '!seen[$0]++')"
site_policy="$(grep -E "^[[:space:]]+${policy_pattern}" "$site_config_file" | sed -E 's/^[[:space:]]+//;s/\r$//' | awk '!seen[$0]++')"

if [[ -z "$certbot_policy" || "$certbot_policy" != "$site_policy" ]]; then
  printf 'Pinned canonical-host TLS policy differs from the current Certbot policy.\n' >&2
  printf 'Update nginx-http-8601.conf deliberately before deployment.\n' >&2
  exit 1
fi

printf 'Canonical-host TLS policy matches Certbot; session tickets are the only intentional override.\n'
