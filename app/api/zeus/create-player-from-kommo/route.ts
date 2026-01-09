import { NextRequest, NextResponse } from 'next/server';
import { getClientConfig, validateClientConfig, ClientConfig, findClientByPipelineId } from '@/lib/config';
import { createGoogleContact } from '@/lib/google-contacts';

interface KommoCustomField {
  field_id: number;
  field_code?: string;
  field_name?: string;
  values: { value: string }[];
}

/**
 * Mueve el lead a un status específico en KOMMO
 */
async function moveLeadToStatus(
  leadId: number,
  statusId: number,
  config: ClientConfig
): Promise<boolean> {
  if (!config.kommo.access_token || !config.kommo.subdomain) {
    return false;
  }

  try {
    const response = await fetch(
      `https://${config.kommo.subdomain}.kommo.com/api/v4/leads/${leadId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.kommo.access_token}`,
        },
        body: JSON.stringify({
          status_id: statusId,
        }),
      }
    );

    if (!response.ok) {
      console.error('[Zeus Save Contact] Failed to move lead to status:', statusId);
      return false;
    }

    console.log(`[Zeus Save Contact] Lead ${leadId} moved to status ${statusId}`);
    return true;
  } catch (error) {
    console.error('[Zeus Save Contact] Error moving lead:', error);
    return false;
  }
}

/**
 * Agrega una nota al lead en KOMMO
 */
async function addNoteToLead(
  leadId: number,
  noteText: string,
  config: ClientConfig
): Promise<void> {
  if (!config.kommo.access_token || !config.kommo.subdomain) {
    return;
  }

  try {
    await fetch(
      `https://${config.kommo.subdomain}.kommo.com/api/v4/leads/notes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.kommo.access_token}`,
        },
        body: JSON.stringify([{
          entity_id: leadId,
          note_type: 'common',
          params: { text: noteText },
        }]),
      }
    );
  } catch (error) {
    console.error('[Zeus Save Contact] Error adding note:', error);
  }
}

/**
 * POST /api/zeus/create-player-from-kommo
 *
 * Para Zeus: NO crea usuario en backend, solo guarda en Google Contacts
 * - Lee el Username del campo personalizado del lead
 * - Obtiene el teléfono del contacto
 * - Guarda en Google People
 * - Mueve el lead al siguiente status
 */
export async function POST(request: NextRequest) {
  let clientId = 'zeus';

  // Get base zeus configuration (for KOMMO access)
  let config = getClientConfig(clientId);
  if (!config) {
    return NextResponse.json(
      { success: false, error: `Client '${clientId}' not found` },
      { status: 404 }
    );
  }

  try {
    const contentType = request.headers.get('content-type');
    const rawBody = await request.text();

    // Parse payload
    let payload: Record<string, string>;
    if (contentType?.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(rawBody);
      payload = {};
      for (const [key, value] of params.entries()) {
        payload[key] = value;
      }
    } else {
      payload = JSON.parse(rawBody);
    }

    console.log(`[${clientId}] Payload:`, JSON.stringify(payload, null, 2));

    // Extract lead ID from webhook
    let leadId: number | null = null;
    for (const [key, value] of Object.entries(payload)) {
      if (key.includes('leads[') && key.includes('[id]')) {
        leadId = parseInt(value as string);
        break;
      }
    }

    if (!leadId) {
      return NextResponse.json(
        { success: false, error: 'Lead ID not found in payload' },
        { status: 400 }
      );
    }

    // AUTO-DETECT PIPELINE: Fetch lead to get pipeline_id
    console.log(`[${clientId}] Multi-pipeline client - fetching lead ${leadId} to detect pipeline...`);
    const leadResponse = await fetch(
      `https://${config.kommo.subdomain}.kommo.com/api/v4/leads/${leadId}?with=contacts`,
      {
        headers: {
          'Authorization': `Bearer ${config.kommo.access_token}`,
        },
      }
    );

    if (!leadResponse.ok) {
      console.error(`[${clientId}] Failed to fetch lead for pipeline detection:`, leadResponse.status);
      return NextResponse.json(
        { success: false, error: 'Could not fetch lead for pipeline detection' },
        { status: 500 }
      );
    }

    const leadData = await leadResponse.json();
    const pipelineId = leadData.pipeline_id;

    console.log(`[${clientId}] Lead ${leadId} is in pipeline: ${pipelineId}`);

    // Find the client config that matches this pipeline (zeus1, zeus2, or zeus3)
    const pipelineConfig = findClientByPipelineId(pipelineId);
    if (!pipelineConfig) {
      console.log(`[${clientId}] No config found for pipeline ${pipelineId} - cannot process`);
      return NextResponse.json(
        {
          success: false,
          error: `Pipeline ${pipelineId} not configured`,
          message: `No configuration found for pipeline ${pipelineId}`,
        },
        { status: 400 }
      );
    }

    // Switch to the pipeline-specific config (zeus1, zeus2, or zeus3)
    clientId = pipelineConfig.clientId;
    config = pipelineConfig.config;
    console.log(`[${clientId}] Resolved to client config: ${clientId} (pipeline ${pipelineId})`);

    // Validate configuration
    const validation = validateClientConfig(config);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: 'Invalid configuration', details: validation.errors },
        { status: 500 }
      );
    }

    // Get Username from lead custom fields
    let username: string | null = null;
    const customFields = leadData.custom_fields_values || [];

    if (config?.kommo.username_field_id) {
      const usernameField = customFields.find(
        (f: KommoCustomField) => f.field_id === config!.kommo.username_field_id
      );
      username = usernameField?.values?.[0]?.value || null;
    }

    if (!username) {
      console.error(`[${clientId}] Username not found in lead custom fields`);
      await addNoteToLead(
        leadId,
        `⚠️ Error: No se encontró el campo Username en el lead.\nVerificá que el campo esté configurado correctamente.`,
        config
      );
      return NextResponse.json(
        { success: false, error: 'Username not found in lead' },
        { status: 400 }
      );
    }

    console.log(`[${clientId}] Username from lead: ${username}`);

    // Get phone from contact
    let phone: string | null = null;
    let email: string | null = null;
    const contactId = leadData._embedded?.contacts?.[0]?.id;

    if (contactId) {
      const contactResponse = await fetch(
        `https://${config.kommo.subdomain}.kommo.com/api/v4/contacts/${contactId}`,
        { headers: { 'Authorization': `Bearer ${config.kommo.access_token}` } }
      );

      if (contactResponse.ok) {
        const contactData = await contactResponse.json();

        const phoneField = contactData.custom_fields_values?.find(
          (f: KommoCustomField) => f.field_code === 'PHONE' || f.field_name === 'Phone'
        );
        phone = phoneField?.values?.[0]?.value || null;

        const emailField = contactData.custom_fields_values?.find(
          (f: KommoCustomField) => f.field_code === 'EMAIL' || f.field_name === 'Email'
        );
        email = emailField?.values?.[0]?.value || null;
      }
    }

    console.log(`[${clientId}] Contact data:`, { username, phone, email });

    // Create Google Contact (using username as contact name)
    let googleContactCreated = false;
    if (config.google && phone) {
      console.log(`[${clientId}] Creating Google Contact...`);
      googleContactCreated = await createGoogleContact(
        { name: username, phone, email: email || undefined },
        config.google
      );

      if (googleContactCreated) {
        console.log(`[${clientId}] Google Contact created successfully`);
      } else {
        console.error(`[${clientId}] Failed to create Google Contact`);
      }
    } else if (!config.google) {
      console.log(`[${clientId}] Google config not found, skipping contact creation`);
    } else if (!phone) {
      console.log(`[${clientId}] Phone not found, skipping Google Contact creation`);
    }

    // Move lead to CREACION Y ENVIO USER status
    let movedToNextStatus = false;
    if (config.kommo.creacion_envio_user_status_id) {
      movedToNextStatus = await moveLeadToStatus(leadId, config.kommo.creacion_envio_user_status_id, config);
      console.log(`[${clientId}] Lead ${leadId} moved to CREACION Y ENVIO USER status`);
    }

    // Add success note
    await addNoteToLead(
      leadId,
      `✅ Contacto guardado en Google\n\nUsuario: ${username}\nTeléfono: ${phone || 'N/A'}\nGoogle Contact: ${googleContactCreated ? 'Creado' : 'No creado'}`,
      config
    );

    return NextResponse.json({
      success: true,
      message: 'Contact saved to Google successfully',
      client: clientId,
      pipeline_id: pipelineId,
      username,
      phone,
      google_contact_created: googleContactCreated,
      moved_to_next_status: movedToNextStatus,
    });

  } catch (error) {
    console.error(`[${clientId}] Error:`, error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/zeus/create-player-from-kommo - Health check
 */
export async function GET() {
  const config = getClientConfig('zeus');

  return NextResponse.json({
    status: config ? 'ok' : 'error',
    client: 'zeus',
    mode: 'google-contacts-only',
    configured: !!config,
    message: config
      ? 'Ready to receive webhooks - saves to Google Contacts only (no backend player creation)'
      : `Client 'zeus' not found`,
    timestamp: new Date().toISOString(),
  });
}
