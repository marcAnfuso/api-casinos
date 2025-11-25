#!/usr/bin/env node
/**
 * Proxy temporal para bet30 API
 *
 * Este script actúa como proxy entre Vercel y bet30.
 * Vercel → Este proxy → bet30
 *
 * Uso:
 * 1. node proxy-bet30.js
 * 2. En otra terminal: ngrok http 3001
 * 3. Agregar URL de ngrok a Vercel como BET30_PROXY_URL
 */

const express = require('express');
const axios = require('axios');

const app = express();
const PORT = 3002; // Cambiado a 3002 porque 3001 está ocupado por Next.js dev

// Middleware para parsear JSON
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Endpoint proxy para crear jugadores
app.post('/create-player', async (req, res) => {
  try {
    console.log('[Proxy] Request recibido de Vercel:', req.body);

    const { playerData, bearerToken } = req.body;

    if (!playerData || !bearerToken) {
      return res.status(400).json({
        success: false,
        error: 'Missing playerData or bearerToken'
      });
    }

    console.log('[Proxy] Haciendo request a bet30...');

    // Hacer el request a bet30 desde tu máquina (que ya funciona)
    const response = await axios.post(
      'https://admin.bet30.store/api/services/app/Players/AddPlayer',
      playerData,
      {
        headers: {
          'Content-Type': 'application/json-patch+json',
          'Authorization': `Bearer ${bearerToken}`,
        },
        validateStatus: () => true, // Aceptar todos los status codes
      }
    );

    console.log('[Proxy] Respuesta de bet30:', {
      status: response.status,
      contentType: response.headers['content-type'],
    });

    // Verificar si es HTML (error)
    if (response.headers['content-type']?.includes('text/html')) {
      console.error('[Proxy] bet30 retornó HTML (error de autenticación)');
      return res.status(500).json({
        success: false,
        error: 'bet30 returned HTML instead of JSON'
      });
    }

    // Retornar la respuesta de bet30 a Vercel
    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    console.error('[Proxy] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Proxy bet30 corriendo en http://localhost:${PORT}`);
  console.log('📝 Endpoints disponibles:');
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   POST http://localhost:${PORT}/create-player`);
  console.log('');
  console.log('💡 Siguiente paso: Exponer con ngrok');
  console.log(`   ngrok http ${PORT}`);
});
