#!/usr/bin/with-contenv bashio

# Get configuration from options.json
export LOG_LEVEL=$(bashio::config 'log_level')
export AUTO_DISCOVER=$(bashio::config 'auto_discover')
export DEVICE_NAME_PATTERNS=$(bashio::addon.config | jq -c '.device_name_patterns // ["SFP","Wizard"]')
export CONNECTION_TIMEOUT=$(bashio::config 'connection_timeout')
export DEVICE_EXPIRY_SECONDS=$(bashio::config 'device_expiry_seconds')
export BLE_TRACE_LOGGING=$(bashio::config 'ble_trace_logging')
export ENABLE_DEBUG_BLE=$(bashio::config 'enable_debug_ble')

# Home Assistant API access
export SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN:-}"
export HASSIO_TOKEN="${SUPERVISOR_TOKEN:-}"
export HA_API_URL="http://supervisor/core/api"
export HA_WS_URL="ws://supervisor/core/websocket"

# Add-on specific paths
export DATABASE_FILE="/config/sfpvault/sfp_library.db"
export SUBMISSIONS_DIR="/config/sfpvault/submissions"
export DATA_DIR="/config/sfpvault"
export BACKUP_DIR="/config/sfpvault/backups"

# One-time migration from the old SFPLiberate data folder (renamed to SFP Vault in 0.3.0).
# The old folder is COPIED, never moved or deleted, so a rollback to the old add-on keeps
# working. Copy into a temp folder first and rename it at the end, so a half-finished copy
# is never mistaken for a finished one.
LEGACY_DATA_DIR="/config/sfpliberate"
if [[ -d "${LEGACY_DATA_DIR}" && ! -e "${DATA_DIR}" ]]; then
    bashio::log.info "Copying data from ${LEGACY_DATA_DIR} to ${DATA_DIR} (old folder is kept)..."
    rm -rf "${DATA_DIR}.migrating"
    if cp -a "${LEGACY_DATA_DIR}" "${DATA_DIR}.migrating" && mv "${DATA_DIR}.migrating" "${DATA_DIR}"; then
        bashio::log.info "Data copied. You can delete ${LEGACY_DATA_DIR} once SFP Vault works."
    else
        rm -rf "${DATA_DIR}.migrating"
        bashio::exit.nok "Could not copy ${LEGACY_DATA_DIR} to ${DATA_DIR}; nothing was changed."
    fi
elif [[ -d "${LEGACY_DATA_DIR}" && ! -f "${DATABASE_FILE}" ]]; then
    bashio::log.warning "${DATA_DIR} exists without a database, so ${LEGACY_DATA_DIR} was NOT copied."
    bashio::log.warning "To migrate: stop the add-on, delete ${DATA_DIR}, then start the add-on again."
fi

# Create directories
bashio::log.info "Creating data directories..."
mkdir -p /config/sfpvault/submissions
mkdir -p /config/sfpvault/backups

# Set deployment mode to HA addon
export DEPLOYMENT_MODE="homeassistant"
export ESPHOME_PROXY_MODE="false"  # We use HA Bluetooth API instead
export HA_ADDON_MODE="true"

# Configure ingress path for Next.js
INGRESS_ENTRY=$(bashio::addon.ingress_entry || true)
if [[ -n "${INGRESS_ENTRY}" && "${INGRESS_ENTRY}" != "/" ]]; then
    export INGRESS_PATH="${INGRESS_ENTRY}"
else
    export INGRESS_PATH=""
fi

bashio::log.info "Starting SFP Vault Home Assistant Add-On..."
bashio::log.info "Log Level: ${LOG_LEVEL}"
bashio::log.info "Auto Discovery: ${AUTO_DISCOVER}"
bashio::log.info "Device Patterns: ${DEVICE_NAME_PATTERNS}"
bashio::log.info "Database: ${DATABASE_FILE}"
if [[ -n "${INGRESS_PATH}" ]]; then
    bashio::log.info "Ingress base path: ${INGRESS_PATH}"
else
    bashio::log.info "Ingress base path: /"
fi

# Log BLE tracing status
if bashio::config.true 'ble_trace_logging'; then
    bashio::log.info "BLE Trace Logging: ENABLED"
else
    bashio::log.info "BLE Trace Logging: DISABLED"
fi

# Note: Actual service startup is handled by s6-overlay services in /etc/services.d/
