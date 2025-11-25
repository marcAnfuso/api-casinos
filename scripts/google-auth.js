/**
 * Script para obtener Refresh Token de Google OAuth 2.0
 * Se ejecuta UNA SOLA VEZ para obtener el refresh token
 */

const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const readline = require('readline');

// Configuración OAuth
const SCOPES = ['https://www.googleapis.com/auth/contacts'];
const REDIRECT_URI = 'http://localhost:3000';
const PORT = 3000;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function getRefreshToken() {
  console.log('\n🔐 Google OAuth - Generador de Refresh Token\n');

  // Pedir Client ID y Secret
  const clientId = await question('Client ID: ');
  const clientSecret = await question('Client Secret: ');

  // Crear cliente OAuth
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    REDIRECT_URI
  );

  // Generar URL de autorización
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n📋 PASO 1: Abrí este URL en tu navegador:\n');
  console.log(authUrl);
  console.log('\n⏳ Esperando autorización...\n');

  // Crear servidor temporal para recibir el código
  const server = http.createServer(async (req, res) => {
    try {
      const query = url.parse(req.url, true).query;

      if (query.code) {
        // Obtener tokens
        const { tokens } = await oauth2Client.getToken(query.code);

        // Responder al navegador
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html>
            <body style="font-family: Arial; padding: 50px; text-align: center;">
              <h1>✅ Autenticación exitosa!</h1>
              <p>Ya podés cerrar esta ventana y volver a la terminal.</p>
            </body>
          </html>
        `);

        // Mostrar tokens
        console.log('\n✅ ¡Refresh Token obtenido exitosamente!\n');
        console.log('📝 Agregá estas variables a tu .env.local:\n');
        console.log(`GOOGLE_CLIENT_ID="${clientId}"`);
        console.log(`GOOGLE_CLIENT_SECRET="${clientSecret}"`);
        console.log(`GOOGLE_REFRESH_TOKEN="${tokens.refresh_token}"`);
        console.log('\n');

        // Cerrar servidor
        server.close();
        rl.close();

      } else if (query.error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html>
            <body style="font-family: Arial; padding: 50px; text-align: center;">
              <h1>❌ Error en la autenticación</h1>
              <p>Error: ${query.error}</p>
            </body>
          </html>
        `);

        console.error('\n❌ Error:', query.error);
        server.close();
        rl.close();
      }

    } catch (error) {
      console.error('\n❌ Error al obtener tokens:', error.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error al procesar la autenticación');
      server.close();
      rl.close();
    }
  });

  server.listen(PORT, () => {
    console.log(`🌐 Servidor escuchando en http://localhost:${PORT}`);
  });
}

getRefreshToken();
