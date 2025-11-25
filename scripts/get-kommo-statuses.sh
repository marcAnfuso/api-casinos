#!/bin/bash
# Script para obtener los statuses del pipeline de KOMMO
# Ejecutar: bash get-kommo-statuses.sh

# Pegá tu KOMMO token y subdomain:
KOMMO_TOKEN="eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6ImFiZDg2NTVjMzZmOWNjNWNiNzk5YzZhNzU4ZDJiZDYyYjE2NTQyMjliMzYyOTZhYzQ0MGFmZWZkNzM1YjQ5ZjgwNjM3ZTYyMmQxNTk0OTg4In0.eyJhdWQiOiI1OGJjNDIzMi0wOTMyLTQwZTctODc4Yy03NjA1ODA4MTY4MjMiLCJqdGkiOiJhYmQ4NjU1YzM2ZjljYzVjYjc5OWM2YTc1OGQyYmQ2MmIxNjU0MjI5YjM2Mjk2YWM0NDBhZmVmZDczNWI0OWY4MDYzN2U2MjJkMTU5NDk4OCIsImlhdCI6MTc2MjkwOTA3MywibmJmIjoxNzYyOTA5MDczLCJleHAiOjE4OTU2MTYwMDAsInN1YiI6IjEzNjI0OTU2IiwiZ3JhbnRfdHlwZSI6IiIsImFjY291bnRfaWQiOjM0OTc4OTA4LCJiYXNlX2RvbWFpbiI6ImtvbW1vLmNvbSIsInZlcnNpb24iOjIsInNjb3BlcyI6WyJjcm0iLCJmaWxlcyIsImZpbGVzX2RlbGV0ZSIsIm5vdGlmaWNhdGlvbnMiLCJwdXNoX25vdGlmaWNhdGlvbnMiXSwiaGFzaF91dWlkIjoiZTVkMDA2M2ItZjE2Ny00NDdiLWJiZTAtNDNiY2MzN2U2ZGUyIiwidXNlcl9mbGFncyI6MCwiYXBpX2RvbWFpbiI6ImFwaS1jLmtvbW1vLmNvbSJ9.WQJcKNdygRojgnMdJo3e3CtSFL-Lr4ky0QSkG8FGv1qR5N31UXoDM2E4RM_zspgxY68IqZveMexydLWfhoHf8DtZANOwuS3XImxIb2V9jS-h_cwPX_BShYYVU7tZqlAdcnoJhC6U9L2hekdIOybfX90xTpWm4HowW6XPYcA6Evn34Ew2f6_gOdzvhfgFDNnOkTgsh_AjwGfFYfgfKhX-X9SH3QwHNtmHhLWUqI44RktqBqpu-vcz2Y-0UbF0TiG6gwuPHf2O75UZpI8f0k8ATzZGjhTXJB-Oz5q5BYdqp3dOP0XP3lEpqFKdAZBuC3P11aLZ9aAD4Q7n_oByR7-qUA"
KOMMO_SUBDOMAIN="lorenzogu32"

echo "🔍 Obteniendo pipelines y statuses de KOMMO..."
echo ""

response=$(curl -s -X GET "https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/pipelines" \
  -H "Authorization: Bearer ${KOMMO_TOKEN}" \
  -H "Content-Type: application/json")

echo "Pipelines y sus statuses:"
echo "$response" | jq '._embedded.pipelines[] | {pipeline_id: .id, pipeline_name: .name, statuses: [._embedded.statuses[] | {status_id: .id, status_name: .name, color: .color}]}'

echo ""
echo "✅ Copiá el 'status_id' del status que quieras usar para 'Comprobante Recibido'"
echo "   (o creá uno nuevo en KOMMO si no existe)"
echo ""
