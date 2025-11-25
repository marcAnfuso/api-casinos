const fs = require('fs');
const http = require('http');
const url = require('url');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/contacts'];
const REDIRECT_URI = 'http://localhost:3000';
const PORT = 3000;

async function getRefreshToken() {
  console.log('\n🔐 Google OAuth - Generador de Refresh Token\n');
  
  // Leer archivo JSON descargado
  const credentialsPath = process.argv[2];
  
  if (!credentialsPath) {
    console.error('❌ Falta el archivo de credenciales');
    console.log('Uso: node scripts/google-auth-json.js /path/to/client_secret.json');
    process.exit(1);
  }
  
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const { client_id, client_secret } = credentials.web || credentials.installed;
  
  console.log('✅ Credenciales cargadas desde JSON\n');
  
  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    REDIRECT_URI
  );
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  
  console.log('📋 Abrí este URL en tu navegador:\n');
  console.log(authUrl);
  console.log('\n⏳ Esperando autorización...\n');
  
  const server = http.createServer(async (req, res) => {
    try {
      const query = url.parse(req.url, true).query;
      
      if (query.code) {
        const { tokens } = await oauth2Client.getToken(query.code);
        
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body style="font-family: Arial; padding: 50px; text-align: center;"><h1>✅ Autenticación exitosa!</h1><p>Ya podés cerrar esta ventana.</p></body></html>');
        
        console.log('\n✅ ¡Refresh Token obtenido exitosamente!\n');
        console.log('📝 Agregá estas variables a tu .env.local:\n');
        console.log(`GOOGLE_CLIENT_ID="${client_id}"`);
        console.log(`GOOGLE_CLIENT_SECRET="${client_secret}"`);
        console.log(`GOOGLE_REFRESH_TOKEN="${tokens.refresh_token}"`);
        console.log('\n');
        
        server.close();
      } else if (query.error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body><h1>❌ Error: ${query.error}</h1></body></html>`);
        console.error('\n❌ Error:', query.error);
        server.close();
      }
    } catch (error) {
      console.error('\n❌ Error:', error.message);
      server.close();
    }
  });
  
  server.listen(PORT);
}

getRefreshToken();
