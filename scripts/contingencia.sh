#!/usr/bin/env bash
# Plan B for an Okta outage: enables, disables or lists the local (contingency) users
# of the Cognito pools in every region. Usage: ./scripts/contingencia.sh list|enable|disable [email]
set -euo pipefail

ACTION="${1:-list}"
ONLY_EMAIL="${2:-}"
REGIONS="${REGIONS:-us-east-1 eu-west-1}"
POOL_PARAMETER="${POOL_PARAMETER:-/app-global/cognito/user-pool-id}"

case "$ACTION" in
  list|enable|disable) ;;
  *) echo "Uso: $0 list|enable|disable [email]" >&2; exit 1 ;;
esac

for REGION in $REGIONS; do
  POOL_ID=$(aws ssm get-parameter --region "$REGION" --name "$POOL_PARAMETER" \
    --query "Parameter.Value" --output text)
  echo "== $REGION ($POOL_ID)"

  # Local users only: federated ones are named okta_<id>
  USERS=$(aws cognito-idp list-users --region "$REGION" --user-pool-id "$POOL_ID" \
    --query "Users[?!starts_with(Username, 'okta_')].[Username, Enabled, UserStatus]" --output text)

  while read -r USERNAME ENABLED STATUS; do
    [ -z "$USERNAME" ] && continue
    [ -n "$ONLY_EMAIL" ] && [ "$USERNAME" != "$ONLY_EMAIL" ] && continue

    case "$ACTION" in
      list)
        printf "  %-40s enabled=%-5s %s\n" "$USERNAME" "$ENABLED" "$STATUS" ;;
      enable)
        aws cognito-idp admin-enable-user --region "$REGION" --user-pool-id "$POOL_ID" --username "$USERNAME"
        echo "  habilitado:   $USERNAME" ;;
      disable)
        aws cognito-idp admin-disable-user --region "$REGION" --user-pool-id "$POOL_ID" --username "$USERNAME"
        echo "  desabilitado: $USERNAME" ;;
    esac
  done <<< "$USERS"
done
