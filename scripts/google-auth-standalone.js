/**
 * Script para obtener Refresh Token de Google OAuth 2.0
 * Instrucciones:
 * 1. npm install googleapis
 * 2. node google-auth-standalone.js
 * 3. Ingresá Client ID y Client Secret cuando te lo pida
 * 4. Abrí la URL que te da en tu navegador
 * 5. Copiá el Refresh Token que te muestra
 */

const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const readline = require('readline');

// Configuración
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
  console.log('\n=================================================');
  console.log('  Google OAuth - Generador de Refresh Token');
  console.log('=================================================\n');

  // Pedir credenciales
  const clientId = await question('Client ID: ');
  const clientSecret = await question('Client Secret: ');

  // Crear cliente OAuth
  const oauth2Client = new google.auth.OAuth2(
    clientId.trim(),
    clientSecret.trim(),
    REDIRECT_URI
  );

  // Generar URL de autorización
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n-------------------------------------------------');
  console.log('PASO 1: Abri este URL en tu navegador:');
  console.log('-------------------------------------------------\n');
  console.log(authUrl);
  console.log('\n-------------------------------------------------');
  console.log('Esperando autorizacion...');
  console.log('-------------------------------------------------\n');

  // Servidor para recibir el código
  const server = http.createServer(async (req, res) => {
    try {
      const query = url.parse(req.url, true).query;

      if (query.code) {
        // Obtener tokens
        const { tokens } = await oauth2Client.getToken(query.code);

        // Responder al navegador
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <title>Autenticacion exitosa</title>
            </head>
            <body style="font-family: Arial, sans-serif; padding: 50px; text-align: center; background: #f0f0f0;">
              <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <h1 style="color: #4CAF50;">✓ Autenticacion exitosa!</h1>
                <p style="font-size: 18px;">Ya podes cerrar esta ventana y volver a la terminal.</p>
              </div>
            </body>
          </html>
        `);

        // Mostrar resultado
        console.log('\n=================================================');
        console.log('  EXITO! Refresh Token obtenido');
        console.log('=================================================\n');
        console.log('Copia estas 3 lineas y envialas:\n');
        console.log('GOOGLE_CLIENT_ID=' + clientId);
        console.log('GOOGLE_CLIENT_SECRET=' + clientSecret);
        console.log('GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
        console.log('\n=================================================\n');

        // Cerrar
        setTimeout(() => {
          server.close();
          rl.close();
          process.exit(0);
        }, 1000);

      } else if (query.error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <body style="font-family: Arial; padding: 50px; text-align: center;">
              <h1 style="color: red;">Error en la autenticacion</h1>
              <p>Error: ${query.error}</p>
            </body>
          </html>
        `);

        console.error('\n[ERROR]', query.error);
        server.close();
        rl.close();
        process.exit(1);
      }

    } catch (error) {
      console.error('\n[ERROR]', error.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error al procesar la autenticacion');
      server.close();
      rl.close();
      process.exit(1);
    }
  });

  server.listen(PORT, () => {
    console.log('[INFO] Servidor iniciado en http://localhost:' + PORT + '\n');
  });
}

getRefreshToken();
