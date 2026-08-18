#!/usr/bin/env bash
# Install systemd units so the ERP API and UI start whenever the OCI instance boots.
# Run on the instance as opc:
#   cd /home/opc/erp-project && bash deploy/install-oci-services.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR=/etc/systemd/system
API_UNIT="${REPO_ROOT}/deploy/erp-api.service"
WEB_UNIT="${REPO_ROOT}/deploy/erp-web.service"

if [[ "$(id -un)" != "opc" ]]; then
  echo "Run this as opc on the OCI instance." >&2
  exit 1
fi

if [[ ! -x "${REPO_ROOT}/.venv/bin/python" ]]; then
  echo "Missing ${REPO_ROOT}/.venv/bin/python. Create the venv first." >&2
  exit 1
fi

NODE_BIN="$(ls -d /home/opc/.nvm/versions/node/v22*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}/node" || ! -x "${NODE_BIN}/npm" ]]; then
  echo "Node 22 / npm not found under ~/.nvm. Install it with nvm first." >&2
  exit 1
fi
if [[ ! -f "${REPO_ROOT}/erp-frontend/node_modules/vite/bin/vite.js" ]]; then
  echo "Missing frontend deps. Run: cd erp-frontend && npm install" >&2
  exit 1
fi

echo "Using Node at ${NODE_BIN}"

TMP_WEB="$(mktemp)"
sed "s|__NODE_BIN__|${NODE_BIN}|g" "${WEB_UNIT}" > "${TMP_WEB}"

sudo cp "${API_UNIT}" "${UNIT_DIR}/erp-api.service"
sudo cp "${TMP_WEB}" "${UNIT_DIR}/erp-web.service"
rm -f "${TMP_WEB}"

# Stop leftover foreground processes from SSH sessions so ports 8000/5173 are free.
if command -v fuser >/dev/null 2>&1; then
  sudo fuser -k 8000/tcp 5173/tcp 2>/dev/null || true
else
  pkill -f 'uvicorn app.main:app' 2>/dev/null || true
  pkill -f 'vite' 2>/dev/null || true
fi
sleep 1

sudo systemctl daemon-reload
sudo systemctl enable --now erp-api erp-web
sudo systemctl status erp-api erp-web --no-pager

echo
echo "Health check:"
curl -fsS http://127.0.0.1:8000/health || {
  echo "API did not respond on :8000. Check: journalctl -u erp-api -n 80 --no-pager" >&2
  exit 1
}
echo
echo "Services enabled. A reboot (or Resource Scheduler start) will bring API and UI up automatically."
echo "  sudo systemctl status erp-api erp-web"
echo "  journalctl -u erp-api -u erp-web -f"
