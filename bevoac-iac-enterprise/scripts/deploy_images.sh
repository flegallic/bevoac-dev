#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  $0 <acr-name> <api-tag> [worker-tag]

Builds and pushes the API image. If a worker directory exists and worker-tag is
provided, also builds and pushes the worker image.
USAGE
}

if [ $# -lt 2 ]; then
  usage
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IAC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_DIR="$(cd "$IAC_DIR/.." && pwd)"

API_DIR=""
for candidate in "$PACKAGE_DIR/bevoac-api-entreprise" "$PACKAGE_DIR/bevoac-api-enterprise"; do
  if [ -f "$candidate/package.json" ]; then
    API_DIR="$candidate"
    break
  fi
done

WORKER_DIR=""
for candidate in "$PACKAGE_DIR/bevoac-worker-entreprise" "$PACKAGE_DIR/bevoac-worker-enterprise"; do
  if [ -f "$candidate/package.json" ]; then
    WORKER_DIR="$candidate"
    break
  fi
done

if [ -z "$API_DIR" ]; then
  echo "ERROR: API directory not found next to the Terraform package." >&2
  exit 1
fi

ACR_NAME="$1"
API_TAG="$2"
WORKER_TAG="${3:-}"
ACR_SERVER="$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)"

az acr login --name "$ACR_NAME"

echo "Building API image $ACR_SERVER/bevoac-api-enterprise:$API_TAG from $API_DIR"
docker build --pull --platform linux/amd64 -t "$ACR_SERVER/bevoac-api-enterprise:$API_TAG" "$API_DIR"
docker push "$ACR_SERVER/bevoac-api-enterprise:$API_TAG"

if [ -n "$WORKER_TAG" ]; then
  if [ -z "$WORKER_DIR" ]; then
    echo "WARNING: worker tag was provided but no worker directory was found; worker image was not built." >&2
  else
    echo "Building worker image $ACR_SERVER/bevoac-worker-enterprise:$WORKER_TAG from $WORKER_DIR"
    docker build --pull --platform linux/amd64 -t "$ACR_SERVER/bevoac-worker-enterprise:$WORKER_TAG" "$WORKER_DIR"
    docker push "$ACR_SERVER/bevoac-worker-enterprise:$WORKER_TAG"
  fi
fi

echo "Images pushed to $ACR_SERVER"
