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
#     git submodule update --init packages/foliate-js packages/simplecc-wasm apps/readest-app/src-tauri/plugins/tauri-plugin-turso
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
#   CONTAINER_APP_NAME       - Existing app name when it differs from APP_NAME-ENV
#   PREBUILT_IMAGE           - Immutable image digest to deploy without rebuilding
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
AUTHOR_BASE_URL="${AUTHOR_BASE_URL:-https://author.bookarc.app}"
USE_APPLE_SIGN_IN="${USE_APPLE_SIGN_IN:-true}"

CONTAINER_APP_NAME="${CONTAINER_APP_NAME:-${APP_NAME}-${ENV}}"
IMAGE_NAME="${CONTAINER_APP_NAME}"
PREBUILT_IMAGE="${PREBUILT_IMAGE:-}"

info()    { echo ">> $*"; }
success() { echo "OK $*"; }
warn()    { echo "WARN $*"; }
err()     { echo "ERROR: $*" >&2; exit 1; }

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
info "Checking prerequisites..."
command -v az >/dev/null || err "Azure CLI not found. Install: brew install azure-cli"
command -v jq >/dev/null || err "jq not found. Install: brew install jq"
az account show >/dev/null 2>&1 || { info "Not logged in — running az login"; az login; }

# Source prerequisites are only needed when building a new image.
if [[ -z "$PREBUILT_IMAGE" ]]; then
test -f packages/foliate-js/vendor/pdfjs/annotation_layer_builder.css \
    && test -d packages/simplecc-wasm/dist/web \
    && test -f apps/readest-app/src-tauri/plugins/tauri-plugin-turso/guest-js/index.ts \
    || err "Git submodules not initialised. Run: git submodule update --init packages/foliate-js packages/simplecc-wasm apps/readest-app/src-tauri/plugins/tauri-plugin-turso"
else
    [[ "$PREBUILT_IMAGE" == "${ACR_NAME}.azurecr.io/${IMAGE_NAME}@sha256:"* \
        && "${PREBUILT_IMAGE##*@sha256:}" =~ ^[0-9a-f]{64}$ ]] \
        || err "PREBUILT_IMAGE must pin this app's registry image by SHA-256 digest"
fi

success "Prerequisites OK"

# ── 2. Derive environment domain ──────────────────────────────────────────────
CONTAINER_ENV_DOMAIN=$(az containerapp env show --ids "$CONTAINER_ENV_ID" \
    --query "properties.defaultDomain" -o tsv)
success "Environment domain: ${CONTAINER_ENV_DOMAIN}"

# ── 3. Build image in Azure (no local Docker needed) ─────────────────────────
info "Building image '${IMAGE_NAME}:${IMAGE_TAG}' in ACR '${ACR_NAME}'..."
if [[ -z "$PREBUILT_IMAGE" ]]; then
az acr build \
    --registry "$ACR_NAME" \
    --resource-group "$RG" \
    --image "${IMAGE_NAME}:${IMAGE_TAG}" \
    --image "${IMAGE_NAME}:latest" \
    --platform linux/amd64 \
    --agent-pool-tier S3 \
    --file Dockerfile \
    --build-arg "NEXT_PUBLIC_API_BASE_URL=${API_BASE_URL}" \
    --build-arg "NEXT_PUBLIC_AUTHOR_BASE_URL=${AUTHOR_BASE_URL}" \
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
    --build-arg "NEXT_PUBLIC_AUTHOR_BASE_URL=${AUTHOR_BASE_URL}" \
    --build-arg "NEXT_PUBLIC_APP_PLATFORM=web" \
    --build-arg "NEXT_PUBLIC_USE_APPLE_SIGN_IN=${USE_APPLE_SIGN_IN}" \
    .
success "Image built: ${ACR_NAME}.azurecr.io/${IMAGE_NAME}:${IMAGE_TAG}"
fi

# ── 4. Create or update Container App ────────────────────────────────────────
FULL_IMAGE="${PREBUILT_IMAGE:-${ACR_NAME}.azurecr.io/${IMAGE_NAME}:${IMAGE_TAG}}"
ACR_SERVER="${ACR_NAME}.azurecr.io"
PULL_IDENTITY=$(az identity create --name "${CONTAINER_APP_NAME}-pull" \
    --resource-group "$RG" --location "$LOCATION" --output json)
PULL_IDENTITY_ID=$(jq -r '.id' <<< "$PULL_IDENTITY")
PULL_PRINCIPAL_ID=$(jq -r '.principalId' <<< "$PULL_IDENTITY")
ACR_ID=$(az acr show --name "$ACR_NAME" --query id -o tsv)
PULL_ROLE_COUNT=$(az role assignment list --assignee "$PULL_PRINCIPAL_ID" \
    --scope "$ACR_ID" --role AcrPull --query 'length(@)' -o tsv)
if [[ "$PULL_ROLE_COUNT" == "0" ]]; then
    az role assignment create --assignee-object-id "$PULL_PRINCIPAL_ID" \
        --assignee-principal-type ServicePrincipal --scope "$ACR_ID" \
        --role AcrPull --output none
fi

if az containerapp show --name "$CONTAINER_APP_NAME" --resource-group "$RG" >/dev/null 2>&1; then
    info "Updating existing Container App '${CONTAINER_APP_NAME}'..."
    az containerapp identity assign --name "$CONTAINER_APP_NAME" --resource-group "$RG" \
        --user-assigned "$PULL_IDENTITY_ID" --output none
    az containerapp registry set --name "$CONTAINER_APP_NAME" --resource-group "$RG" \
        --server "$ACR_SERVER" --identity "$PULL_IDENTITY_ID" --output none
    az containerapp update \
        --name "$CONTAINER_APP_NAME" \
        --resource-group "$RG" \
        --image "$FULL_IMAGE" \
        --output none
else
    info "Creating Container App '${CONTAINER_APP_NAME}'..."

    az containerapp create \
        --name "$CONTAINER_APP_NAME" \
        --resource-group "$RG" \
        --environment "$CONTAINER_ENV_ID" \
        --image "$FULL_IMAGE" \
        --user-assigned "$PULL_IDENTITY_ID" \
        --registry-server "$ACR_SERVER" \
        --registry-identity "$PULL_IDENTITY_ID" \
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
CANDIDATE_REVISION=$(az containerapp show --name "$CONTAINER_APP_NAME" --resource-group "$RG" \
    --query properties.latestRevisionName -o tsv)
[[ -n "$CANDIDATE_REVISION" ]] || err "Azure did not return the deployed revision"
CANDIDATE_FQDN=$(az containerapp revision show --name "$CONTAINER_APP_NAME" --resource-group "$RG" \
    --revision "$CANDIDATE_REVISION" --query properties.fqdn -o tsv)
[[ -n "$CANDIDATE_FQDN" ]] || err "Azure did not return the deployed revision hostname"
HEALTH_URL="https://${CANDIDATE_FQDN}/"
info "Waiting for app to start (up to 2 min)..."
APP_HEALTHY=false
for i in $(seq 1 12); do
    sleep 10
    STATUS=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo 000)
    if [[ "$STATUS" =~ ^[23] ]]; then
        success "App is live at ${APP_URL}"
        APP_HEALTHY=true
        break
    fi
    echo "  ... waiting (${STATUS}) $((i * 10))s elapsed"
done
[[ "$APP_HEALTHY" == true ]] || err "Reader app failed its production health check at ${HEALTH_URL}"
REVISION_MODE=$(az containerapp show --name "$CONTAINER_APP_NAME" --resource-group "$RG" \
    --query properties.configuration.activeRevisionsMode -o tsv)
if [[ "$REVISION_MODE" == "Multiple" ]]; then
    az containerapp ingress traffic set --name "$CONTAINER_APP_NAME" --resource-group "$RG" \
        --revision-weight "${CANDIDATE_REVISION}=100" --output none
    # Verify the routed hostname before retiring old replicas. Keep revisions for rollback.
    curl --fail --silent --show-error --retry 3 --max-time 20 "$APP_URL/" >/dev/null \
        || err "Promoted reader failed its routed health check; old revisions retained"
    RG="$RG" CONTAINER_APP_NAME="$CONTAINER_APP_NAME" CANDIDATE_REVISION="$CANDIDATE_REVISION" \
        bash "$(dirname "${BASH_SOURCE[0]}")/scripts/retire-unused-revisions.sh"
fi

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
