import { NextRequest, NextResponse } from 'next/server';
import { getClientConfig, ClientConfig } from '@/lib/config';
import { validatePaymentProof, ValidationResult } from '@/lib/vision-validator';

interface RouteParams {
  params: Promise<{ clientId: string }>;
}

interface LeadData {
  intentos: number;
  statusId: number;
}

/**
 * Obtiene datos del lead (intentos y status actual)
 */
async function getLeadData(leadId: number, config: ClientConfig): Promise<LeadData | null> {
  if (!config.kommo.access_token || !config.kommo.subdomain) {
    return null;
  }

  try {
    const response = await fetch(
      `https://${config.kommo.subdomain}.kommo.com/api/v4/leads/${leadId}`,
      {
        headers: {
          'Authorization': `Bearer ${config.kommo.access_token}`,
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const lead = await response.json();

    // Get intentos_comprobante value
    let intentos = 0;
    if (config.kommo.intentos_comprobante_field_id && lead.custom_fields_values) {
      const field = lead.custom_fields_values.find(
        (f: { field_id: number }) => f.field_id === config.kommo.intentos_comprobante_field_id
      );
      if (field?.values?.[0]?.value) {
        intentos = parseInt(field.values[0].value, 10) || 0;
      }
    }

    return {
      intentos,
      statusId: lead.status_id,
    };
  } catch {
    return null;
  }
}

/**
 * Cambia el status del lead y actualiza el contador de intentos
 */
async function updateLeadStatus(
  leadId: number,
  statusId: number,
  intentos: number | null,
  config: ClientConfig
): Promise<boolean> {
  if (!config.kommo.access_token || !config.kommo.subdomain) {
    return false;
  }

  try {
    const body: {
      status_id: number;
      custom_fields_values?: { field_id: number; values: { value: number }[] }[];
    } = {
      status_id: statusId,
    };

    // Update intentos field if configured
    if (intentos !== null && config.kommo.intentos_comprobante_field_id) {
      body.custom_fields_values = [
        {
          field_id: config.kommo.intentos_comprobante_field_id,
          values: [{ value: intentos }],
        },
      ];
    }

    const response = await fetch(
      `https://${config.kommo.subdomain}.kommo.com/api/v4/leads/${leadId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.kommo.access_token}`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[KOMMO Message] Status update error:', { status: response.status, body: errorText });
      return false;
    }

    return true;
  } catch (error) {
    console.error('[KOMMO Message] Status update error:', error);
    return false;
  }
}

/**
 * Agrega nota interna al lead
 */
async function addNoteToLead(
  leadId: number,
  fileName: string,
  fileUrl: string | undefined,
  config: ClientConfig
): Promise<boolean> {
  if (!config.kommo.access_token || !config.kommo.subdomain) {
    return false;
  }

  const noteText = `Comprobante recibido: ${fileName}${fileUrl ? `\nURL: ${fileUrl}` : ''}`;

  try {
    const response = await fetch(
      `https://${config.kommo.subdomain}.kommo.com/api/v4/leads/notes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.kommo.access_token}`,
        },
        body: JSON.stringify([
          {
            entity_id: leadId,
            note_type: 'common',
            params: { text: noteText },
          },
        ]),
      }
    );

    return response.ok;
  } catch (error) {
    console.error('[KOMMO Message] Note error:', error);
    return false;
  }
}

/**
 * Procesa el caso de comprobante no recibido (incrementa intentos, decide etapa)
 */
async function handleNoProof(
  leadId: number,
  config: ClientConfig,
  clientId: string
): Promise<{ statusChanged: boolean; stage: string; intentos: number }> {
  // Get current intentos
  const leadData = await getLeadData(leadId, config);
  const currentIntentos = leadData?.intentos || 0;
  const newIntentos = currentIntentos + 1;
  const maxIntentos = config.kommo.max_intentos_comprobante || 3;

  console.log(`[${clientId}] Intentos: ${currentIntentos} -> ${newIntentos} (max: ${maxIntentos})`);

  // Decide which stage to move to
  let statusId: number | undefined;
  let stage: string;

  if (newIntentos >= maxIntentos && config.kommo.no_respondio_status_id) {
    statusId = config.kommo.no_respondio_status_id;
    stage = 'NO RESPONDIO';
    console.log(`[${clientId}] Max intentos reached - moving to NO RESPONDIO`);
  } else {
    statusId = config.kommo.comprobante_no_recibido_status_id;
    stage = 'COMPROBANTE NO RECIBIDO';
  }

  if (!statusId) {
    return { statusChanged: false, stage: 'unknown', intentos: newIntentos };
  }

  const statusChanged = await updateLeadStatus(leadId, statusId, newIntentos, config);
  console.log(`[${clientId}] Lead moved to: ${stage} (intentos: ${newIntentos})`);

  return { statusChanged, stage, intentos: newIntentos };
}

/**
 * POST /api/[clientId]/kommo-message-received
 * Webhook que KOMMO dispara cuando llega un mensaje nuevo
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { clientId } = await params;

  const config = getClientConfig(clientId);
  if (!config) {
    return NextResponse.json(
      { success: false, error: `Client '${clientId}' not found` },
      { status: 404 }
    );
  }

  try {
    const payload = await request.json();
    console.log(`[${clientId}] Message webhook:`, JSON.stringify(payload, null, 2));

    // Extract message data
    let leadId: number | null = null;
    let isIncoming = false;
    let attachmentType: string | null = null;
    let fileName = 'unknown';
    let fileUrl: string | undefined;

    // Check for Chats API format
    if (payload.message?.message?.type) {
      const chatMessage = payload.message;
      const innerMessage = chatMessage.message;

      leadId = chatMessage.conversation?.id || chatMessage.talk_id || null;
      isIncoming = !!chatMessage.sender?.id;

      const mediaTypes: Record<string, string> = {
        'picture': 'image',
        'video': 'file',
        'file': 'file',
        'voice': 'file',
        'audio': 'file',
        'sticker': 'image',
      };

      attachmentType = mediaTypes[innerMessage.type] || null;
      fileName = innerMessage.file_name || 'unknown';
      fileUrl = innerMessage.media;

      console.log(`[${clientId}] Chats API format:`, {
        leadId, isIncoming, messageType: innerMessage.type, attachmentType, hasMedia: !!fileUrl,
      });
    }
    // Fallback to standard webhook format
    else {
      const message = payload.message || payload;
      leadId = message.entity_id;
      isIncoming = message.message_type === 'in';

      const attachments = message.attachments || [];
      if (attachments.length > 0) {
        const attachment = attachments[0];
        attachmentType = attachment.type;
        fileName = attachment.file_name || attachment.name || 'unknown';
        fileUrl = attachment.link || attachment.url;
      }

      console.log(`[${clientId}] Standard format:`, { leadId, isIncoming, hasAttachments: !!attachmentType });
    }

    // Only process incoming messages
    if (!isIncoming) {
      return NextResponse.json({ success: true, message: 'Outgoing message ignored' });
    }

    if (!leadId) {
      return NextResponse.json({ success: false, error: 'Could not extract lead/conversation ID' }, { status: 400 });
    }

    // No attachment → handle no proof
    if (!attachmentType || !fileUrl) {
      console.log(`[${clientId}] No media attachment`);
      const result = await handleNoProof(leadId, config, clientId);
      return NextResponse.json({
        success: true,
        message: `No media - moved to ${result.stage}`,
        client: clientId,
        data: { leadId, ...result },
      });
    }

    const validTypes = ['image', 'file'];
    if (!validTypes.includes(attachmentType)) {
      return NextResponse.json({ success: true, message: 'Attachment type not valid for proof' });
    }

    // Validate with AI Vision (only for images)
    let aiValidation: ValidationResult = { isPaymentProof: true, confidence: 'low', reason: 'Skipped' };
    if (attachmentType === 'image' && fileUrl) {
      const geminiApiKey = process.env.GEMINI_API_KEY;
      aiValidation = await validatePaymentProof(fileUrl, geminiApiKey);

      console.log(`[${clientId}] AI Validation:`, aiValidation);

      // Not a payment proof → handle no proof
      if (!aiValidation.isPaymentProof) {
        console.log(`[${clientId}] Image rejected: ${aiValidation.reason}`);
        const result = await handleNoProof(leadId, config, clientId);
        return NextResponse.json({
          success: true,
          message: `Image not a payment proof - moved to ${result.stage}`,
          client: clientId,
          data: { leadId, ...result, aiValidation },
        });
      }
    }

    // Valid payment proof → move to COMPROBANTE RECIBIDO and reset intentos
    console.log(`[${clientId}] Payment proof detected!`);

    const statusId = config.kommo.comprobante_recibido_status_id;
    if (!statusId) {
      return NextResponse.json({
        success: false,
        error: 'comprobante_recibido_status_id not configured',
      });
    }

    const statusChanged = await updateLeadStatus(leadId, statusId, 0, config);

    if (statusChanged) {
      await addNoteToLead(leadId, fileName, fileUrl, config);
    }

    return NextResponse.json({
      success: true,
      message: 'Proof received - moved to COMPROBANTE RECIBIDO',
      client: clientId,
      data: { leadId, statusChanged, stage: 'COMPROBANTE RECIBIDO', aiValidation, fileName },
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
 * GET /api/[clientId]/kommo-message-received - Health check
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { clientId } = await params;
  const config = getClientConfig(clientId);

  return NextResponse.json({
    status: config ? 'ok' : 'error',
    client: clientId,
    configured: !!config,
    message: config ? 'Message webhook endpoint ready' : `Client '${clientId}' not found`,
    timestamp: new Date().toISOString(),
  });
}
