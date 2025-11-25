#!/bin/bash
# Script para obtener los scopes (canales) de KOMMO
# Ejecutar: bash get-kommo-scopes.sh

# Reemplazá estos valores con los tuyos:
KOMMO_TOKEN="tu_token_aqui"
KOMMO_SUBDOMAIN="lorenzogu32"

echo "🔍 Obteniendo scopes de KOMMO..."
echo ""

curl -X GET "https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/talks/scopes" \
  -H "Authorization: Bearer ${KOMMO_TOKEN}" \
  -H "Content-Type: application/json" \
  | jq '._embedded.scopes[] | {id: .id, name: .name, channel: .channel, active: .active}'

echo ""
echo "✅ Copiá el 'id' del canal que tenga 'channel': 'whatsapp'"
