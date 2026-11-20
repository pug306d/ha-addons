#!/usr/bin/with-contenv bashio
set +u

# Per-install API token, kept in /data so it survives restarts and rebuilds.
TOKEN_FILE=/data/api_token
if [ ! -s "$TOKEN_FILE" ]; then
  cat /proc/sys/kernel/random/uuid | tr -d '-' > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  bashio::log.info "Created a new API token."
fi
API_TOKEN=$(cat "$TOKEN_FILE")

sed -i "s/{{HOSTNAME}}/$HOSTNAME/g" custom_component/whatsapp.py
sed -i "s/{{API_TOKEN}}/$API_TOKEN/g" custom_component/whatsapp.py

mkdir -p config/custom_components/whatsapp
cp --recursive /custom_component/* config/custom_components/whatsapp/
bashio::log.info "Installed custom component."

node index