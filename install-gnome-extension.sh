#!/usr/bin/env bash
set -euo pipefail

UUID="quotahalo@local"
LEGACY_EXTENSIONS=(
    "codexbar-usage@local"
    "codexbar-system@local"
    "ai-usage-bar@local"
    "copilot-usage@local"
)
SRC_DIR="$(cd "$(dirname "$0")" && pwd)/gnome-extension/${UUID}"
DST_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSET_DIR="${REPO_DIR}/assets"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
PYTHON_BIN="${REPO_DIR}/venv/bin/python3"
EXTENSION_NEEDS_RELOAD=0
EXTENSION_CODE_CHANGED=0

if [[ ! -x "${PYTHON_BIN}" ]]; then
    PYTHON_BIN="$(command -v python3)"
fi

if ! command -v gnome-extensions >/dev/null 2>&1; then
    echo "ERROR: gnome-extensions command not found."
    echo "Install GNOME Shell extension tooling first, then rerun this script."
    exit 1
fi

if [[ -f "${DST_DIR}/extension.js" ]] && ! cmp -s "${SRC_DIR}/extension.js" "${DST_DIR}/extension.js"; then
    EXTENSION_CODE_CHANGED=1
fi
mkdir -p "${DST_DIR}"
cp "${SRC_DIR}/metadata.json" "${SRC_DIR}/extension.js" "${SRC_DIR}/stylesheet.css" "${DST_DIR}/"
cp "${ASSET_DIR}/openai-icon.png" "${DST_DIR}/"
cp "${ASSET_DIR}/claude-icon.png" "${DST_DIR}/"
if [[ -f "${ASSET_DIR}/github-copilot-icon.png" ]]; then
    cp "${ASSET_DIR}/github-copilot-icon.png" "${DST_DIR}/"
fi
python3 - "${DST_DIR}/config.json" "${REPO_DIR}" "${PYTHON_BIN}" <<'PY'
import json
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
repo_dir = Path(sys.argv[2]).resolve()
python_bin = sys.argv[3]
version = "v0.1.0"
try:
    version = (repo_dir / "VERSION").read_text(encoding="utf-8").strip() or version
except Exception:
    pass

payload = {
    "repo_dir": str(repo_dir),
    "python_bin": python_bin,
    "status_script": str(repo_dir / "quota_halo_status.py"),
    "copilot_script": str(repo_dir / "copilot_status_service.py"),
    "current_version": version,
    "github_repo": "eddy0619/QuotaHalo-Linux",
}
config_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
PY

gsettings set org.gnome.shell disable-user-extensions false || true
for legacy_uuid in "${LEGACY_EXTENSIONS[@]}"; do
    gnome-extensions disable "${legacy_uuid}" >/dev/null 2>&1 || true
done
python3 - "${LEGACY_EXTENSIONS[@]}" <<'PY' || true
import ast
import subprocess
import sys

uuids = set(sys.argv[1:])
schema = "org.gnome.shell"
key = "enabled-extensions"

raw = subprocess.check_output(["gsettings", "get", schema, key], text=True).strip()
if raw.startswith("@as "):
    raw = raw[4:].strip()
enabled = ast.literal_eval(raw)
next_enabled = [uuid for uuid in enabled if uuid not in uuids]
if next_enabled != enabled:
    enabled = next_enabled
    subprocess.check_call(["gsettings", "set", schema, key, repr(enabled)])
PY
gnome-extensions disable "${UUID}" >/dev/null 2>&1 || true
gnome-extensions enable "${UUID}" || {
    python3 - "${UUID}" <<'PY'
import ast
import subprocess
import sys

uuid = sys.argv[1]
schema = "org.gnome.shell"
key = "enabled-extensions"

raw = subprocess.check_output(["gsettings", "get", schema, key], text=True).strip()
if raw.startswith("@as "):
    raw = raw[4:].strip()
enabled = ast.literal_eval(raw)
if uuid not in enabled:
    enabled.append(uuid)
    subprocess.check_call(["gsettings", "set", schema, key, repr(enabled)])
PY
    echo "Installed ${UUID} and added it to GNOME enabled-extensions."
    echo "Reload GNOME Shell to make it appear now: press Alt+F2, type r, press Enter."
    EXTENSION_NEEDS_RELOAD=1
}

if command -v systemctl >/dev/null 2>&1; then
    mkdir -p "${SYSTEMD_USER_DIR}"
    systemctl --user disable --now codexbar-refresh.timer >/dev/null 2>&1 || true
    systemctl --user disable --now ai-usage-refresh.timer >/dev/null 2>&1 || true
    rm -f \
        "${SYSTEMD_USER_DIR}/codexbar-refresh.service" \
        "${SYSTEMD_USER_DIR}/codexbar-refresh.timer" \
        "${SYSTEMD_USER_DIR}/ai-usage-refresh.service" \
        "${SYSTEMD_USER_DIR}/ai-usage-refresh.timer"
    sed "s|@REPO_DIR@|${REPO_DIR}|g" \
        "${REPO_DIR}/systemd/quotahalo-refresh.service.in" \
        > "${SYSTEMD_USER_DIR}/quotahalo-refresh.service"
    cp "${REPO_DIR}/systemd/quotahalo-refresh.timer" \
        "${SYSTEMD_USER_DIR}/quotahalo-refresh.timer"
    sed \
        -e "s|@REPO_DIR@|${REPO_DIR}|g" \
        -e "s|@PYTHON_BIN@|${PYTHON_BIN}|g" \
        "${REPO_DIR}/systemd/copilot-usage.service.in" \
        > "${SYSTEMD_USER_DIR}/copilot-usage.service"
    "${PYTHON_BIN}" "${REPO_DIR}/copilot_status_service.py" --once || true
    systemctl --user daemon-reload
    systemctl --user enable --now quotahalo-refresh.timer
    systemctl --user enable --now copilot-usage.service
    systemctl --user restart copilot-usage.service
fi

echo "Installed and enabled ${UUID}."
echo "QuotaHalo refresh timer and Copilot usage service are enabled."
if [[ "${EXTENSION_NEEDS_RELOAD}" == "1" ]]; then
    echo "Reload GNOME Shell to activate the newly installed extension."
elif [[ "${EXTENSION_CODE_CHANGED}" == "1" ]]; then
    echo "GNOME Shell may keep the previous extension JS in memory."
    echo "Reload GNOME Shell to apply this update: Alt+F2, type r, press Enter on X11; log out and back in on Wayland."
fi
