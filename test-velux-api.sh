#!/bin/bash
# test-velux-api.sh
# Skript zum Testen der Velux Active API (Fehlersuche 500 Internal Server Error)

CLIENT_ID="5931426da127d981e76bdd3f"
CLIENT_SECRET="6ae2d89d15e767ae5c56b456b452d319"

echo "Velux API Tester"
echo "----------------"
read -p "Velux E-Mail: " USERNAME
read -s -p "Velux Passwort: " PASSWORD
echo ""

echo ""
echo "[1] Hole Access-Token..."
TOKEN_RESPONSE=$(curl -s -X POST https://app.velux-active.com/oauth2/token \
  -d "grant_type=password&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&username=$USERNAME&password=$PASSWORD&user_prefix=velux")

TOKEN=$(echo $TOKEN_RESPONSE | grep -o '"access_token":"[^"]*' | grep -o '[^"]*$')

if [ -z "$TOKEN" ]; then
  echo "❌ Fehler beim Login. Antwort:"
  echo $TOKEN_RESPONSE
  exit 1
fi

echo "✅ Token erfolgreich erhalten!"
echo "Token: ${TOKEN:0:10}..."

echo ""
echo "[2] Teste homesdata Variante 1 (Nur Token)"
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://app.velux-active.com/api/homesdata \
  -d "access_token=$TOKEN"

echo ""
echo "[3] Teste homesdata Variante 2 (mit gateway_types=[NXG])"
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://app.velux-active.com/api/homesdata \
  -d "access_token=$TOKEN&gateway_types=[NXG]"

echo ""
echo "[4] Teste homesdata Variante 3 (JSON + Bearer)"
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://app.velux-active.com/api/homesdata \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

echo ""
echo "[5] Teste homesdata Variante 4 (app.netatmo.net)"
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://app.netatmo.net/api/homesdata \
  -H "Authorization: Bearer $TOKEN" \
  -d "gateway_types=[NXG]"

echo ""
echo "Bitte poste mir die Ausgabe (nur die Zahlen 200, 400 oder 500) hier in den Chat!"
