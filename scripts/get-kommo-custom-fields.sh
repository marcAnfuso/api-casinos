#!/bin/bash
# Script para obtener los custom fields de Leads en KOMMO
# Ejecutar: bash get-kommo-custom-fields.sh

# Pegá tu KOMMO token acá (el que ya usaste antes):
KOMMO_TOKEN="eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6ImFiZDg2NTVjMzZmOWNjNWNiNzk5YzZhNzU4ZDJiZDYyYjE2NTQyMjliMzYyOTZhYzQ0MGFmZWZkNzM1YjQ5ZjgwNjM3ZTYyMmQxNTk0OTg4In0.eyJhdWQiOiI1OGJjNDIzMi0wOTMyLTQwZTctODc4Yy03NjA1ODA4MTY4MjMiLCJqdGkiOiJhYmQ4NjU1YzM2ZjljYzVjYjc5OWM2YTc1OGQyYmQ2MmIxNjU0MjI5YjM2Mjk2YWM0NDBhZmVmZDczNWI0OWY4MDYzN2U2MjJkMTU5NDk4OCIsImlhdCI6MTc2MjkwOTA3MywibmJmIjoxNzYyOTA5MDczLCJleHAiOjE4OTU2MTYwMDAsInN1YiI6IjEzNjI0OTU2IiwiZ3JhbnRfdHlwZSI6IiIsImFjY291bnRfaWQiOjM0OTc4OTA4LCJiYXNlX2RvbWFpbiI6ImtvbW1vLmNvbSIsInZlcnNpb24iOjIsInNjb3BlcyI6WyJjcm0iLCJmaWxlcyIsImZpbGVzX2RlbGV0ZSIsIm5vdGlmaWNhdGlvbnMiLCJwdXNoX25vdGlmaWNhdGlvbnMiXSwiaGFzaF91dWlkIjoiZTVkMDA2M2ItZjE2Ny00NDdiLWJiZTAtNDNiY2MzN2U2ZGUyIiwidXNlcl9mbGFncyI6MCwiYXBpX2RvbWFpbiI6ImFwaS1jLmtvbW1vLmNvbSJ9.WQJcKNdygRojgnMdJo3e3CtSFL-Lr4ky0QSkG8FGv1qR5N31UXoDM2E4RM_zspgxY68IqZveMexydLWfhoHf8DtZANOwuS3XImxIb2V9jS-h_cwPX_BShYYVU7tZqlAdcnoJhC6U9L2hekdIOybfX90xTpWm4HowW6XPYcA6Evn34Ew2f6_gOdzvhfgFDNnOkTgsh_AjwGfFYfgfKhX-X9SH3QwHNtmHhLWUqI44RktqBqpu-vcz2Y-0UbF0TiG6gwuPHf2O75UZpI8f0k8ATzZGjhTXJB-Oz5q5BYdqp3dOP0XP3lEpqFKdAZBuC3P11aLZ9aAD4Q7n_oByR7-qUA"
KOMMO_SUBDOMAIN="lorenzogu32"

echo "🔍 Obteniendo custom fields de Leads en KOMMO..."
echo ""

response=$(curl -s -X GET "https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/custom_fields" \
  -H "Authorization: Bearer ${KOMMO_TOKEN}" \
  -H "Content-Type: application/json")

echo "Response completo:"
echo "$response" | jq '.'
echo ""
echo "Filtrando Username y Password..."
echo "$response" | jq '._embedded.custom_fields[] | select(.name == "Username" or .name == "Password" or .name == "username" or .name == "password") | {id: .id, name: .name, type: .type}'

echo ""
echo "✅ Copiá los IDs de Username y Password"
echo ""
