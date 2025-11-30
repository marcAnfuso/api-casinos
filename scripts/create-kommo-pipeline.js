#!/usr/bin/env node
/**
 * Script para crear el pipeline "Embudo de ventas" con las etapas necesarias
 *
 * Uso:
 *   node scripts/create-kommo-pipeline.js <KOMMO_TOKEN> <SUBDOMAIN>
 *
 * Ejemplo:
 *   node scripts/create-kommo-pipeline.js "eyJ..." "lorenzogu32"
 */

const PIPELINE_NAME = 'Embudo de ventas';

// Etapas a crear (en orden)
const STATUSES = [
  { name: 'Contacto inicial', color: '#99ccff', sort: 20 },
  { name: 'ESPERANDO COMPROBANTE', color: '#99ccff', sort: 30 },
  { name: 'COMPROBANTE NO RECIBIDO', color: '#99ccff', sort: 40 },
  { name: 'COMPROBANTE RECIBIDO', color: '#87f2c0', sort: 50 },
  { name: 'Negociación', color: '#ffff99', sort: 60 },
  { name: 'NO RESPONDIO', color: '#ff8f92', sort: 70 },
  { name: 'NO CONVIRTIO', color: '#ff8f92', sort: 80 },
];

async function createPipeline(token, subdomain) {
  const baseUrl = `https://${subdomain}.kommo.com/api/v4`;

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // 1. Verificar si ya existe el pipeline
  console.log('🔍 Buscando pipelines existentes...');
  const pipelinesRes = await fetch(`${baseUrl}/leads/pipelines`, { headers });
  const pipelinesData = await pipelinesRes.json();

  const existingPipeline = pipelinesData._embedded?.pipelines?.find(
    p => p.name === PIPELINE_NAME
  );

  if (existingPipeline) {
    console.log(`⚠️  Pipeline "${PIPELINE_NAME}" ya existe (ID: ${existingPipeline.id})`);
    console.log('\nEtapas actuales:');
    existingPipeline._embedded?.statuses?.forEach(s => {
      console.log(`  - ${s.name} (ID: ${s.id})`);
    });
    return existingPipeline;
  }

  // 2. Crear el pipeline con las etapas
  console.log(`\n🚀 Creando pipeline "${PIPELINE_NAME}"...`);

  const createRes = await fetch(`${baseUrl}/leads/pipelines`, {
    method: 'POST',
    headers,
    body: JSON.stringify([
      {
        name: PIPELINE_NAME,
        is_main: false,
        is_unsorted_on: true,
        sort: 10,
        _embedded: {
          statuses: STATUSES.map(s => ({
            name: s.name,
            color: s.color,
            sort: s.sort,
          })),
        },
      },
    ]),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    console.error('❌ Error al crear pipeline:', createRes.status, errorText);
    process.exit(1);
  }

  const createData = await createRes.json();
  const newPipeline = createData._embedded?.pipelines?.[0];

  if (!newPipeline) {
    console.error('❌ No se pudo obtener el pipeline creado');
    process.exit(1);
  }

  console.log(`✅ Pipeline creado con ID: ${newPipeline.id}`);
  console.log('\n📋 Etapas creadas:');

  // 3. Obtener los IDs de las etapas creadas
  const pipelineDetailsRes = await fetch(
    `${baseUrl}/leads/pipelines/${newPipeline.id}`,
    { headers }
  );
  const pipelineDetails = await pipelineDetailsRes.json();

  const statusIds = {};
  pipelineDetails._embedded?.statuses?.forEach(s => {
    console.log(`  - ${s.name}: ${s.id}`);

    // Mapear a los nombres de config
    if (s.name === 'ESPERANDO COMPROBANTE') {
      statusIds.esperando_comprobante_status_id = s.id;
    } else if (s.name === 'COMPROBANTE RECIBIDO') {
      statusIds.comprobante_recibido_status_id = s.id;
    } else if (s.name === 'COMPROBANTE NO RECIBIDO') {
      statusIds.comprobante_no_recibido_status_id = s.id;
    } else if (s.name === 'NO RESPONDIO') {
      statusIds.no_respondio_status_id = s.id;
    }
  });

  console.log('\n📝 Configuración para clients.json:');
  console.log(JSON.stringify({
    pipeline_id: newPipeline.id,
    ...statusIds,
  }, null, 2));

  return newPipeline;
}

// Main
const [,, token, subdomain] = process.argv;

if (!token || !subdomain) {
  console.log('Uso: node scripts/create-kommo-pipeline.js <TOKEN> <SUBDOMAIN>');
  console.log('');
  console.log('Ejemplo:');
  console.log('  node scripts/create-kommo-pipeline.js "eyJ..." "lorenzogu32"');
  process.exit(1);
}

createPipeline(token, subdomain)
  .then(() => {
    console.log('\n✅ Listo!');
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
