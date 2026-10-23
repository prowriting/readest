#!/usr/bin/env bash
# Keep rollback revisions stored but stop paying for unlabelled, zero-traffic replicas.
# Call only after the promoted reader revision has passed its health checks.
set -euo pipefail
: "${RG:?Set RG}"
: "${CONTAINER_APP_NAME:?Set CONTAINER_APP_NAME}"
: "${CANDIDATE_REVISION:?Set CANDIDATE_REVISION}"

traffic=$(az containerapp ingress traffic show -g "$RG" -n "$CONTAINER_APP_NAME" -o json)
jq -e --arg revision "$CANDIDATE_REVISION" '
  [.[] | select((.weight // 0) > 0)] |
  length == 1 and .[0].revisionName == $revision and .[0].weight == 100
' <<<"$traffic" >/dev/null

revisions=$(az containerapp revision list -g "$RG" -n "$CONTAINER_APP_NAME" -o json)
while IFS= read -r revision; do
    [[ -n "$revision" ]] || continue
    # Refresh routing before every mutation. Labels can route traffic independently.
    current=$(az containerapp ingress traffic show -g "$RG" -n "$CONTAINER_APP_NAME" -o json)
    [[ "$(jq -Sc . <<<"$current")" == "$(jq -Sc . <<<"$traffic")" ]] || {
        echo 'Reader traffic changed during cleanup; stopping.' >&2
        exit 1
    }
    if jq -e --arg revision "$revision" 'any(.[]; .revisionName == $revision)' <<<"$current" >/dev/null; then
        continue
    fi
    az containerapp revision deactivate -g "$RG" -n "$CONTAINER_APP_NAME" \
        --revision "$revision" --output none
    echo "Retired unused reader revision: $revision"
done < <(jq -r --arg candidate "$CANDIDATE_REVISION" '
  .[] | select(.properties.active == true and .name != $candidate
    and (.properties.trafficWeight // 0) == 0) | .name
' <<<"$revisions")
