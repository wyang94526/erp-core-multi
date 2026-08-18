#!/usr/bin/env bash
# Create OCI Resource Scheduler jobs that start and stop the ERP compute instance.
#
# Run from OCI Cloud Shell (already authenticated) or any host with oci CLI:
#   export COMPARTMENT_OCID=ocid1.compartment.oc1..aaaa...
#   export INSTANCE_OCID=ocid1.instance.oc1..aaaa...
#   bash deploy/oci/create-resource-schedules.sh
#
# Times are Asia/Shanghai (UTC+8), weekdays:
#   09:00 start  →  21:00 stop
# Postgres at 10.0.1.209 is not targeted. Leave the DB running.
set -euo pipefail

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing $1. Use OCI Cloud Shell, or install the OCI CLI." >&2
    exit 1
  }
}

need oci
need python3

COMPARTMENT_OCID="${COMPARTMENT_OCID:-}"
INSTANCE_OCID="${INSTANCE_OCID:-}"
DISPLAY_PREFIX="${DISPLAY_PREFIX:-erp-project}"
TIMEZONE="${TIMEZONE:-Asia/Shanghai}"
START_CRON="${START_CRON:-0 9 * * 1-5}"
STOP_CRON="${STOP_CRON:-0 21 * * 1-5}"
DRY_RUN="${DRY_RUN:-0}"

list_instances() {
  local cid="$1"
  oci compute instance list \
    --compartment-id "${cid}" \
    --lifecycle-state RUNNING \
    --all \
    --query 'data[*].{"name":"display-name","id":id,"state":"lifecycle-state"}' \
    --output table
  echo
  oci compute instance list \
    --compartment-id "${cid}" \
    --lifecycle-state STOPPED \
    --all \
    --query 'data[*].{"name":"display-name","id":id,"state":"lifecycle-state"}' \
    --output table || true
}

if [[ -z "${COMPARTMENT_OCID}" ]]; then
  echo "COMPARTMENT_OCID is required." >&2
  echo "  Console: Identity → Compartments → copy OCID" >&2
  echo "  Cloud Shell: echo \$OCI_CLI_TENANCY   # tenancy root, if the instance lives there" >&2
  exit 1
fi

if [[ -z "${INSTANCE_OCID}" ]]; then
  echo "INSTANCE_OCID is not set. Instances in this compartment:" >&2
  echo
  list_instances "${COMPARTMENT_OCID}"
  echo
  echo "Re-run with:" >&2
  echo "  export INSTANCE_OCID=ocid1.instance.oc1....." >&2
  echo "  bash deploy/oci/create-resource-schedules.sh" >&2
  exit 1
fi

RESOURCES_FILE="$(mktemp)"
python3 - <<PY > "${RESOURCES_FILE}"
import json
print(json.dumps([{"id": "${INSTANCE_OCID}"}]))
PY
trap 'rm -f "${RESOURCES_FILE}"' EXIT

create_schedule() {
  local action="$1"
  local name="$2"
  local cron="$3"
  local description="$4"

  echo "Creating ${name} (${action} @ ${cron} ${TIMEZONE})"
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "  dry-run: oci resource-scheduler schedule create --action ${action} --display-name ${name}"
    return
  fi

  local extra=()
  if oci resource-scheduler schedule create --help 2>/dev/null | grep -q -- "--local-time-zone"; then
    extra+=(--local-time-zone "${TIMEZONE}")
  else
    echo "  warning: this CLI has no --local-time-zone; cron is evaluated in UTC." >&2
    echo "  Convert 09:00/21:00 Asia/Shanghai to 01:00/13:00 UTC if needed." >&2
  fi

  oci resource-scheduler schedule create \
    --compartment-id "${COMPARTMENT_OCID}" \
    --display-name "${name}" \
    --description "${description}" \
    --action "${action}" \
    --recurrence-type CRON \
    --recurrence-details "${cron}" \
    --resources "file://${RESOURCES_FILE}" \
    "${extra[@]}" \
    --wait-for-state SUCCEEDED \
    --wait-for-state FAILED \
    --max-wait-seconds 180
}

create_schedule \
  START_RESOURCE \
  "${DISPLAY_PREFIX}-start-weekdays" \
  "${START_CRON}" \
  "Start ERP compute instance weekday mornings (API/UI come up via systemd)."

create_schedule \
  STOP_RESOURCE \
  "${DISPLAY_PREFIX}-stop-weekdays" \
  "${STOP_CRON}" \
  "Stop ERP compute instance weekday evenings. Does not stop Postgres."

echo
echo "Schedules in compartment:"
oci resource-scheduler schedule list \
  --compartment-id "${COMPARTMENT_OCID}" \
  --all \
  --output table

echo
echo "Done. Confirm IAM from deploy/oci/iam-policy.txt is in place, or start/stop will be denied."
echo "Leave the Postgres host (10.0.1.209) off these schedules."
