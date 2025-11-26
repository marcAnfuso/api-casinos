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

interface LastMessage {
  fileUrl: string;
  fileName: string;
  messageType: string;
}

/**
 * Obtiene el último mensaje del lead usando la API de eventos/notas
 */
async function getLastLeadMessage(leadId: number, config: ClientConfig): Promise<LastMessage | null> {
  if (!config.kommo.access_token || !config.kommo.subdomain) {
    return null;
  }

  try {
    // First try: Get events filtered by lead
    const eventsResponse = await fetch(
      `https://${config.kommo.subdomain}.kommo.com/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}&limit=10`,
      {
        headers: {
          'Authorization': `Bearer ${config.kommo.access_token}`,
        },
      }
    );

    if (eventsResponse.ok) {
      const eventsData = await eventsResponse.json();
      console.log('[KOMMO] Events response:', JSON.stringify(eventsData, null, 2));

      // Look for incoming_chat_message or attachment events
      if (eventsData._embedded?.events) {
        for (const event of eventsData._embedded.events) {
          // Check for chat message with media
          if (event.type === 'incoming_chat_message' && event.value_after) {
            const messageData = event.value_after[0];
            if (messageData?.message?.media) {
              return {
                fileUrl: messageData.message.media,
                fileName: messageData.message.file_name || 'attachment',
                messageType: messageData.message.type || 'file',
              };
            }
          }
        }
      }
    }

    // Second try: Get notes from the lead
    const notesResponse = await fetch(
      `https://${config.kommo.subdomain}.kommo.com/api/v4/leads/${leadId}/notes?limit=10`,
      {
        headers: {
          'Authorization': `Bearer ${config.kommo.access_token}`,
        },
      }
    );

    if (notesResponse.ok) {
      const notesData = await notesResponse.json();
      console.log('[KOMMO] Notes response:', JSON.stringify(notesData, null, 2));

      // Look for notes with attachments
      if (notesData._embedded?.notes) {
        for (const note of notesData._embedded.notes) {
          if (note.params?.file_uuid || note.params?.link) {
            return {
              fileUrl: note.params.link || `https://${config.kommo.subdomain}.kommo.com/download/${note.params.file_uuid}`,
              fileName: note.params.file_name || 'attachment',
              messageType: 'file',
            };
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error('[KOMMO] Error fetching last message:', error);
    return null;
  }
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
    const contentType = request.headers.get('content-type');
    const rawBody = await request.text();

    // Parse payload (handle both JSON and form-urlencoded from KOMMO)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payload: any;
    if (contentType?.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(rawBody);
      payload = {};
      for (const [key, value] of params.entries()) {
        payload[key] = value;
      }
      console.log(`[${clientId}] Message webhook (form-urlencoded):`, JSON.stringify(payload, null, 2));
    } else {
      payload = JSON.parse(rawBody);
      console.log(`[${clientId}] Message webhook (JSON):`, JSON.stringify(payload, null, 2));
    }

    // Extract message data
    let leadId: number | null = null;
    let isIncoming = false;
    let attachmentType: string | null = null;
    let fileName = 'unknown';
    let fileUrl: string | undefined;

    // Check for global message webhook format (form-urlencoded with message[add][0][...])
    const messageEntityIdKey = Object.keys(payload).find(key => key.match(/message\[add\]\[\d+\]\[entity_id\]/));
    if (messageEntityIdKey) {
      const idx = messageEntityIdKey.match(/message\[add\]\[(\d+)\]/)?.[1] || '0';
      leadId = parseInt(payload[messageEntityIdKey], 10);
      isIncoming = payload[`message[add][${idx}][type]`] === 'incoming';

      // Check for media/file attachment (multiple possible formats)
      const mediaUrl = payload[`message[add][${idx}][media]`];
      const fileAttachment = payload[`message[add][${idx}][file]`];
      const attachmentLink = payload[`message[add][${idx}][attachment][link]`];
      const attachmentTypeValue = payload[`message[add][${idx}][attachment][type]`];
      const messageMediaType = payload[`message[add][${idx}][message_type]`];

      if (mediaUrl || fileAttachment || attachmentLink) {
        fileUrl = mediaUrl || fileAttachment || attachmentLink;
        fileName = payload[`message[add][${idx}][file_name]`] || payload[`message[add][${idx}][attachment][file_name]`] || 'attachment';
        // Determine type from attachment[type] or message_type
        const typeValue = attachmentTypeValue || messageMediaType;
        attachmentType = (typeValue === 'picture' || typeValue === 'image') ? 'image' : 'file';
      }

      console.log(`[${clientId}] Global message webhook:`, {
        leadId, isIncoming, hasMedia: !!(mediaUrl || fileAttachment || attachmentLink), attachmentType, fileName
      });
    }
    // Check for Salesbot webhook format (form-urlencoded with leads[add][0][id])
    else if (Object.keys(payload).find(key => key.match(/leads\[(add|update)\]\[\d+\]\[id\]/))) {
      const salesbotLeadKey = Object.keys(payload).find(key => key.match(/leads\[(add|update)\]\[\d+\]\[id\]/))!;
      leadId = parseInt(payload[salesbotLeadKey], 10);
      isIncoming = true; // Salesbot triggers after user message

      console.log(`[${clientId}] Salesbot webhook detected, lead ID: ${leadId}`);
      console.log(`[${clientId}] Fetching last message from KOMMO API...`);

      // Fetch the last message from the lead
      const lastMessage = await getLastLeadMessage(leadId, config);

      if (lastMessage) {
        fileUrl = lastMessage.fileUrl;
        fileName = lastMessage.fileName;
        attachmentType = lastMessage.messageType === 'picture' ? 'image' : 'file';
        console.log(`[${clientId}] Found message:`, { fileUrl, fileName, attachmentType });
      } else {
        console.log(`[${clientId}] No attachment found in recent messages`);
      }
    }
    // Check for Chats API format
    else if (payload.message?.message?.type) {
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

    // Check if lead is in ESPERANDO_COMPROBANTE status
    const leadData = await getLeadData(leadId, config);
    if (!leadData) {
      console.log(`[${clientId}] Could not fetch lead data`);
      return NextResponse.json({ success: true, message: 'Could not fetch lead data' });
    }

    const esperandoStatusId = config.kommo.esperando_comprobante_status_id;
    const noRecibidoStatusId = config.kommo.comprobante_no_recibido_status_id;

    if (!esperandoStatusId) {
      console.log(`[${clientId}] esperando_comprobante_status_id not configured`);
      return NextResponse.json({ success: true, message: 'Status check not configured' });
    }

    // Accept messages from leads in ESPERANDO_COMPROBANTE or COMPROBANTE_NO_RECIBIDO (for retries)
    const validStatuses = [esperandoStatusId, noRecibidoStatusId].filter(Boolean);
    if (!validStatuses.includes(leadData.statusId)) {
      console.log(`[${clientId}] Lead not in valid stage (current: ${leadData.statusId}, valid: ${validStatuses.join(', ')}) - ignoring`);
      return NextResponse.json({
        success: true,
        message: 'Lead not in valid stage for proof processing - message ignored',
        data: { leadId, currentStatus: leadData.statusId, validStatuses }
      });
    }

    console.log(`[${clientId}] Lead is in valid stage (${leadData.statusId}) - processing attachment...`);

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
