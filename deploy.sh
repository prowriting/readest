#!/usr/bin/env bash
# BookArc Web App — Azure deployment script
#
# Builds the Next.js web reader and deploys it to Azure Container Apps at web.bookarc.app.
# Shares the ACR and Container Apps environment already created by BookArcWeb.
#
# Prerequisites:
#   az   (brew install azure-cli)
#   jq   (brew install jq)
#   git submodules initialised:
#     git submodule update --init packages/foliate-js packages/simplecc-wasm
#
# Required environment variables:
#   ACR_NAME          - Shared ACR name (from BookArcWeb deployment)
#   CONTAINER_ENV_ID  - Shared Container Apps environment resource ID
#
# Optional:
#   CUSTOM_HOSTNAME          - Custom domain (default: web.bookarc.app)
#   API_BASE_URL             - Reader API base URL (default: https://reader.bookarc.app)
#   USE_APPLE_SIGN_IN        - true|false (default: true)
#   APP_NAME                 - Resource prefix (default: bookarc-web-app)
#   ENV                      - prod | staging (default: prod)
#   LOCATION                 - Azure region (default: uksouth)
#   RG                       - Resource group (default: rg-bookarcweb-prod)
#   IMAGE_TAG                - Image tag (default: git short hash)
#
# Tip: pull shared infra values from your existing BookArcWeb deployment:
#   ACR_NAME=$(az acr list -g rg-bookarcweb-prod --query "[0].name" -o tsv)
#   CONTAINER_ENV_ID=$(az containerapp env list -g rg-bookarcweb-prod --query "[0].id" -o tsv)

set -euo pipefail

APP_NAME="${APP_NAME:-bookarc-web-app}"
ENV="${ENV:-prod}"
LOCATION="${LOCATION:-uksouth}"
RG="${RG:-rg-bookarcweb-${ENV}}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo 'latest')}"

ACR_NAME="${ACR_NAME:?Set ACR_NAME (shared with BookArcWeb)}"
CONTAINER_ENV_ID="${CONTAINER_ENV_ID:?Set CONTAINER_ENV_ID}"

CUSTOM_HOSTNAME="${CUSTOM_HOSTNAME:-web.bookarc.app}"
API_BASE_URL="${API_BASE_URL:-https://reader.bookarc.app}"
USE_APPLE_SIGN_IN="${USE_APPLE_SIGN_IN:-true}"

CONTAINER_APP_NAME="${APP_NAME}-${ENV}"
IMAGE_NAME="${CONTAINER_APP_NAME}"

info()    { echo ">> $*"; }
success() { echo "OK $*"; }
warn()    { echo "WARN $*"; }
err()     { echo "ERROR: $*" >&2; exit 1; }

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
info "Checking prerequisites..."
command -v az >/dev/null || err "Azure CLI not found. Install: brew install azure-cli"
command -v jq >/dev/null || err "jq not found. Install: brew install jq"
az account show >/dev/null 2>&1 || { info "Not logged in — running az login"; az login; }

# Submodule check
test -f packages/foliate-js/vendor/pdfjs/annotation_layer_builder.css \
    && test -d packages/simplecc-wasm/dist/web \
    || err "Git submodules not initialised. Run: git submodule update --init packages/foliate-js packages/simplecc-wasm"

success "Prerequisites OK"

# ── 2. Derive environment domain ──────────────────────────────────────────────
CONTAINER_ENV_DOMAIN=$(az containerapp env show --ids "$CONTAINER_ENV_ID" \
    --query "properties.defaultDomain" -o tsv)
success "Environment domain: ${CONTAINER_ENV_DOMAIN}"

# ── 3. Build image in Azure (no local Docker needed) ─────────────────────────
info "Building image '${IMAGE_NAME}:${IMAGE_TAG}' in ACR '${ACR_NAME}'..."
az acr build \
    --registry "$ACR_NAME" \
    --resource-group "$RG" \
    --image "${IMAGE_NAME}:${IMAGE_TAG}" \
    --image "${IMAGE_NAME}:latest" \
    --platform linux/amd64 \
    --agent-pool-tier S3 \
    --file Dockerfile \
    --build-arg "NEXT_PUBLIC_API_BASE_URL=${API_BASE_URL}" \
    --build-arg "NEXT_PUBLIC_APP_PLATFORM=web" \
    --build-arg "NEXT_PUBLIC_USE_APPLE_SIGN_IN=${USE_APPLE_SIGN_IN}" \
    . 2>/dev/null \
|| az acr build \
    --registry "$ACR_NAME" \
    --resource-group "$RG" \
    --image "${IMAGE_NAME}:${IMAGE_TAG}" \
    --image "${IMAGE_NAME}:latest" \
    --platform linux/amd64 \
    --file Dockerfile \
    --build-arg "NEXT_PUBLIC_API_BASE_URL=${API_BASE_URL}" \
    --build-arg "NEXT_PUBLIC_APP_PLATFORM=web" \
    --build-arg "NEXT_PUBLIC_USE_APPLE_SIGN_IN=${USE_APPLE_SIGN_IN}" \
    .
success "Image built: ${ACR_NAME}.azurecr.io/${IMAGE_NAME}:${IMAGE_TAG}"

# ── 4. Create or update Container App ────────────────────────────────────────
FULL_IMAGE="${ACR_NAME}.azurecr.io/${IMAGE_NAME}:${IMAGE_TAG}"

if az containerapp show --name "$CONTAINER_APP_NAME" --resource-group "$RG" >/dev/null 2>&1; then
    info "Updating existing Container App '${CONTAINER_APP_NAME}'..."
    az containerapp update \
        --name "$CONTAINER_APP_NAME" \
        --resource-group "$RG" \
        --image "$FULL_IMAGE" \
        --output none
else
    info "Creating Container App '${CONTAINER_APP_NAME}'..."

    # Pull the ACR login server and admin credentials for pull access
    ACR_SERVER="${ACR_NAME}.azurecr.io"
    ACR_PASS=$(az acr credential show --name "$ACR_NAME" --resource-group "$RG" \
        --query "passwords[0].value" -o tsv 2>/dev/null || echo "")

    REGISTRY_ARGS=""
    if [[ -n "$ACR_PASS" ]]; then
        REGISTRY_ARGS="--registry-server ${ACR_SERVER} --registry-username ${ACR_NAME} --registry-password ${ACR_PASS}"
    fi

    # shellcheck disable=SC2086
    az containerapp create \
        --name "$CONTAINER_APP_NAME" \
        --resource-group "$RG" \
        --environment "$CONTAINER_ENV_ID" \
        --image "$FULL_IMAGE" \
        $REGISTRY_ARGS \
        --target-port 3000 \
        --ingress external \
        --min-replicas 1 \
        --max-replicas 5 \
        --cpu 0.5 \
        --memory 1.0Gi \
        --output none
fi
success "Container App deployed"

APP_URL="https://${CONTAINER_APP_NAME}.${CONTAINER_ENV_DOMAIN}"
info "Default URL: ${APP_URL}"

# ── 5. Custom domain binding ──────────────────────────────────────────────────
if [[ -n "$CUSTOM_HOSTNAME" ]]; then
    info "Binding custom domain '${CUSTOM_HOSTNAME}'..."
    info "Make sure this DNS CNAME record exists:"
    info "  CNAME  ${CUSTOM_HOSTNAME}  →  ${CONTAINER_APP_NAME}.${CONTAINER_ENV_DOMAIN}"
    echo ""
    read -r -p "Press Enter once the CNAME is in place, or Ctrl-C to skip..."

    ENV_NAME=$(az containerapp env show --ids "$CONTAINER_ENV_ID" --query "name" -o tsv)
    az containerapp hostname add \
        --name "$CONTAINER_APP_NAME" \
        --resource-group "$RG" \
        --hostname "$CUSTOM_HOSTNAME" 2>/dev/null || true

    az containerapp hostname bind \
        --name "$CONTAINER_APP_NAME" \
        --resource-group "$RG" \
        --hostname "$CUSTOM_HOSTNAME" \
        --environment "$ENV_NAME" \
        --validation-method CNAME 2>/dev/null \
        && success "Custom domain bound: https://${CUSTOM_HOSTNAME}" \
        || warn "Domain binding failed — DNS may not have propagated yet."
fi

# ── 6. Health check ───────────────────────────────────────────────────────────
HEALTH_URL="${APP_URL}/"
info "Waiting for app to start (up to 2 min)..."
for i in $(seq 1 12); do
    sleep 10
    STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo 000)
    if [[ "$STATUS" =~ ^[23] ]]; then
        success "App is live at ${APP_URL}"
        break
    fi
    echo "  ... waiting (${STATUS}) $((i * 10))s elapsed"
done

echo ""
echo "==========================================="
echo "  Web App deployment complete"
echo "  URL:   ${APP_URL}"
if [[ -n "$CUSTOM_HOSTNAME" ]]; then
echo "  Web:   https://${CUSTOM_HOSTNAME}"
fi
echo "  Tag:   ${IMAGE_TAG}"
echo "  RG:    ${RG}"
echo "==========================================="
