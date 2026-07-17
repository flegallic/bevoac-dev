#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <api-tag> <worker-tag>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IAC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$IAC_DIR"
terraform init
terraform validate
terraform apply -auto-approve -var='deploy_container_apps=false'
ACR_LOGIN_SERVER="$(terraform output -raw acr_login_server)"
ACR_NAME="${ACR_LOGIN_SERVER%%.azurecr.io}"
"$SCRIPT_DIR/deploy_images.sh" "$ACR_NAME" "$1" "$2"
cat <<EOF

Bootstrap completed.
Next steps:
  1. Update terraform.tfvars with the exact image tags you just pushed.
  2. Set deploy_container_apps = true.
  3. Run: terraform plan && terraform apply
EOF
