export default function Home() {
  return (
    <div style={{ fontFamily: 'monospace', padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>⚡ Integration API</h1>
      <p>KOMMO + bet30 webhook integration service</p>

      <h2>Endpoints disponibles:</h2>
      <ul>
        <li>
          <code>POST /api/create-player-from-kommo</code>
          <br />
          <small>Webhook de KOMMO → Crea jugador en bet30 → Envía credenciales</small>
        </li>
        <li>
          <code>POST /api/kommo-message-received</code>
          <br />
          <small>Webhook de KOMMO → Detecta comprobante → Cambia status</small>
        </li>
        <li>
          <code>GET /api/kommo-message-received</code>
          <br />
          <small>Health check del endpoint de mensajes</small>
        </li>
      </ul>

      <h2>Estado:</h2>
      <p>✅ API funcionando correctamente</p>
      <p><small>Timestamp: {new Date().toISOString()}</small></p>
    </div>
  );
}
