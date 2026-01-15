import { NextRequest, NextResponse } from 'next/server';
import { getClientConfig, ClientConfig, findClientByPipelineId } from '@/lib/config';
import { validatePaymentProof, ValidationResult } from '@/lib/vision-validator';
import { extractFbclidFromMessage } from '@/lib/meta-capi';

interface LeadData {
  intentos: number;
  statusId: number;
  pipelineId?: number;
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
    const customFields = lead.custom_fields_values || [];

    let intentos = 0;
    if (config.kommo.intentos_comprobante_field_id) {
      const intentosField = customFields.find(
        (f: { field_id: number }) => f.field_id === config.kommo.intentos_comprobante_field_id
      );
      intentos = intentosField ? parseInt(intentosField.values[0]?.value || '0', 10) : 0;
    }

    return {
      intentos,
      statusId: lead.status_id,
      pipelineId: lead.pipeline_id,
    };
  } catch (error) {
    console.error('[KOMMO] Error fetching lead data:', error);
    return null;
  }
}

/**
 * Guarda el fbclid en el campo personalizado del lead
 */
async function saveFbclidToLead(leadId: number, fbclid: string, config: ClientConfig): Promise<boolean> {
  if (!config.kommo.access_token || !config.kommo.subdomain || !config.kommo.fbclid_field_id) {
    console.log('[KOMMO] fbclid_field_id not configured, skipping save');
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
          custom_fields_values: [{
            field_id: config.kommo.fbclid_field_id,
            values: [{ value: fbclid }],
          }],
        }),
      }
    );

    if (!response.ok) {
      console.error('[KOMMO] Failed to save fbclid:', response.status);
      return false;
    }

    console.log(`[KOMMO] fbclid saved to lead ${leadId}`);
    return true;
  } catch (error) {
    console.error('[KOMMO] Error saving fbclid:', error);
    return false;
  }
}

/**
 * Actualiza el contador de intentos
 */
async function updateIntentosComprobante(
  leadId: number,
  intentos: number,
  config: ClientConfig
): Promise<void> {
  if (!config.kommo.access_token || !config.kommo.subdomain || !config.kommo.intentos_comprobante_field_id) {
    return;
  }

  try {
    await fetch(
      `https://${config.kommo.subdomain}.kommo.com/api/v4/leads/${leadId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.kommo.access_token}`,
        },
        body: JSON.stringify({
          custom_fields_values: [{
            field_id: config.kommo.intentos_comprobante_field_id,
            values: [{ value: intentos.toString() }],
          }],
        }),
      }
    );
  } catch (error) {
    console.error('[KOMMO] Error updating intentos:', error);
  }
}

/**
 * Mueve el lead a un status específico
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
      console.error('[KOMMO] Failed to move lead:', response.status);
      return false;
    }

    console.log(`[KOMMO] Lead ${leadId} moved to status ${statusId}`);
    return true;
  } catch (error) {
    console.error('[KOMMO] Error moving lead:', error);
    return false;
  }
}

/**
 * POST /api/zeus/kommo-message-received
 * Multi-pipeline auto-detection endpoint for Casino Zeus message webhook
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
    let messageText: string | null = null;

    // Check for global message webhook format
    const messageEntityIdKey = Object.keys(payload).find(key => key.match(/message\[add\]\[\d+\]\[entity_id\]/));
    if (messageEntityIdKey) {
      const idx = messageEntityIdKey.match(/message\[add\]\[(\d+)\]/)?.[1] || '0';
      leadId = parseInt(payload[messageEntityIdKey], 10);
      isIncoming = payload[`message[add][${idx}][type]`] === 'incoming';
      messageText = payload[`message[add][${idx}][text]`] || null;

      const mediaUrl = payload[`message[add][${idx}][media]`];
      const fileAttachment = payload[`message[add][${idx}][file]`];
      const attachmentLink = payload[`message[add][${idx}][attachment][link]`];
      const attachmentTypeValue = payload[`message[add][${idx}][attachment][type]`];
      const messageMediaType = payload[`message[add][${idx}][message_type]`];

      if (mediaUrl || fileAttachment || attachmentLink) {
        fileUrl = mediaUrl || fileAttachment || attachmentLink;
        fileName = payload[`message[add][${idx}][file_name]`] || payload[`message[add][${idx}][attachment][file_name]`] || 'attachment';
        const typeValue = attachmentTypeValue || messageMediaType;
        attachmentType = (typeValue === 'picture' || typeValue === 'image') ? 'image' : 'file';
      }

      console.log(`[${clientId}] Global message webhook:`, {
        leadId, isIncoming, hasMedia: !!(mediaUrl || fileAttachment || attachmentLink), attachmentType, fileName, hasText: !!messageText
      });
    }
    // Check for Salesbot webhook format
    else if (Object.keys(payload).find(key => key.match(/leads\[(add|update)\]\[\d+\]\[id\]/))) {
      const salesbotLeadKey = Object.keys(payload).find(key => key.match(/leads\[(add|update)\]\[\d+\]\[id\]/))!;
      leadId = parseInt(payload[salesbotLeadKey], 10);
      isIncoming = true;

      console.log(`[${clientId}] Salesbot webhook detected, lead ID: ${leadId}`);
      console.log(`[${clientId}] Fetching last message from KOMMO API...`);

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
      messageText = innerMessage.text || null;

      console.log(`[${clientId}] Chats API format:`, {
        leadId, isIncoming, messageType: innerMessage.type, attachmentType, hasMedia: !!fileUrl, hasText: !!messageText,
      });
    }
    // Fallback to standard webhook format
    else {
      const message = payload.message || payload;
      leadId = message.entity_id;
      isIncoming = message.message_type === 'in';
      messageText = message.text || null;

      const attachments = message.attachments || [];
      if (attachments.length > 0) {
        const attachment = attachments[0];
        attachmentType = attachment.type;
        fileName = attachment.file_name || attachment.name || 'unknown';
        fileUrl = attachment.link || attachment.url;
      }

      console.log(`[${clientId}] Standard format:`, { leadId, isIncoming, hasAttachments: !!attachmentType, hasText: !!messageText });
    }

    // Only process incoming messages
    if (!isIncoming) {
      return NextResponse.json({ success: true, message: 'Outgoing message ignored' });
    }

    if (!leadId) {
      return NextResponse.json({ success: false, error: 'Could not extract lead/conversation ID' }, { status: 400 });
    }

    // AUTO-DETECT PIPELINE: Fetch lead to get pipeline_id
    console.log(`[${clientId}] Multi-pipeline client - fetching lead to detect pipeline...`);

    const leadResponse = await fetch(
      `https://${config.kommo.subdomain}.kommo.com/api/v4/leads/${leadId}`,
      {
        headers: {
          'Authorization': `Bearer ${config.kommo.access_token}`,
        },
      }
    );

    if (!leadResponse.ok) {
      console.error(`[${clientId}] Failed to fetch lead for pipeline detection:`, leadResponse.status);
      return NextResponse.json({ success: false, error: 'Could not fetch lead for pipeline detection' }, { status: 500 });
    }

    const leadDataResponse = await leadResponse.json();
    const pipelineId = leadDataResponse.pipeline_id;

    console.log(`[${clientId}] Lead ${leadId} is in pipeline: ${pipelineId}`);

    // Find the client config that matches this pipeline (zeus1, zeus2, or zeus3)
    const pipelineConfig = findClientByPipelineId(pipelineId);
    if (!pipelineConfig) {
      console.log(`[${clientId}] No config found for pipeline ${pipelineId} - ignoring message`);
      return NextResponse.json({
        success: true,
        message: `Pipeline ${pipelineId} not configured - message ignored`,
        data: { leadId, pipelineId }
      });
    }

    // Switch to the pipeline-specific config (zeus1, zeus2, or zeus3)
    clientId = pipelineConfig.clientId;
    config = pipelineConfig.config;
    console.log(`[${clientId}] Resolved to client config: ${clientId} (pipeline ${pipelineId})`);

    // Extract and save fbclid from message text [REF:xxx]
    if (messageText) {
      const fbclid = extractFbclidFromMessage(messageText);
      if (fbclid) {
        console.log(`[${clientId}] Found fbclid in message: ${fbclid.substring(0, 30)}...`);
        await saveFbclidToLead(leadId, fbclid, config);
      }
    }

    // Check if lead is in ESPERANDO_COMPROBANTE status
    const leadData = await getLeadData(leadId, config);
    if (!leadData) {
      console.log(`[${clientId}] Could not fetch lead data`);
      return NextResponse.json({ success: true, message: 'Could not fetch lead data' });
    }

    console.log(`[${clientId}] Lead data:`, { statusId: leadData.statusId, intentos: leadData.intentos });

    // Only process if lead is waiting for payment proof (ESPERANDO or NO_RECIBIDO for retries)
    const validStatuses = [
      config.kommo.esperando_comprobante_status_id,
      config.kommo.comprobante_no_recibido_status_id
    ].filter(Boolean);

    if (!validStatuses.includes(leadData.statusId)) {
      console.log(`[${clientId}] Lead not in valid status for proof (current: ${leadData.statusId}, valid: ${validStatuses.join(', ')}), skipping`);
      return NextResponse.json({
        success: true,
        message: 'Lead not in waiting status',
        data: { leadId, statusId: leadData.statusId, validStatuses }
      });
    }

    // Check if has attachment - if not, treat as invalid attempt
    if (!attachmentType && !fileUrl) {
      console.log(`[${clientId}] No attachment in message - treating as invalid attempt`);

      // Update intentos counter
      const newIntentos = leadData.intentos + 1;
      await updateIntentosComprobante(leadId, newIntentos, config);

      // Check if exceeded max attempts
      const maxIntentos = config.kommo.max_intentos_comprobante || 3;
      if (newIntentos >= maxIntentos) {
        console.log(`[${clientId}] Max intentos reached (${newIntentos}/${maxIntentos}), moving to NO_RESPONDIO`);

        if (config.kommo.no_respondio_status_id) {
          await moveLeadToStatus(leadId, config.kommo.no_respondio_status_id, config);
        }

        return NextResponse.json({
          success: true,
          message: 'Max attempts reached (no attachment) - moved to NO_RESPONDIO',
          data: { leadId, intentos: newIntentos, maxIntentos }
        });
      } else {
        console.log(`[${clientId}] No attachment - moving to COMPROBANTE_NO_RECIBIDO (intento ${newIntentos}/${maxIntentos})`);

        if (config.kommo.comprobante_no_recibido_status_id) {
          await moveLeadToStatus(leadId, config.kommo.comprobante_no_recibido_status_id, config);
        }

        return NextResponse.json({
          success: true,
          message: 'No attachment - retry requested',
          data: { leadId, intentos: newIntentos, maxIntentos, reason: 'No image attached' }
        });
      }
    }

    console.log(`[${clientId}] Processing attachment: ${fileName} (${attachmentType})`);

    // Validate payment proof with Gemini Vision
    let validationResult: ValidationResult;
    try {
      validationResult = await validatePaymentProof(fileUrl!, fileName);
      console.log(`[${clientId}] Validation result:`, validationResult);
    } catch (error) {
      console.error(`[${clientId}] Error validating payment proof:`, error);
      return NextResponse.json({ success: false, error: 'Failed to validate payment proof' }, { status: 500 });
    }

    // Update intentos counter
    const newIntentos = leadData.intentos + 1;
    await updateIntentosComprobante(leadId, newIntentos, config);

    // Move lead based on validation result
    if (validationResult.isPaymentProof) {
      console.log(`[${clientId}] Valid payment proof detected, moving to COMPROBANTE_RECIBIDO`);

      if (config.kommo.comprobante_recibido_status_id) {
        await moveLeadToStatus(leadId, config.kommo.comprobante_recibido_status_id, config);
      }

      return NextResponse.json({
        success: true,
        message: 'Valid payment proof received',
        data: {
          leadId,
          isValid: true,
          confidence: validationResult.confidence,
          reason: validationResult.reason,
          intentos: newIntentos,
        }
      });
    } else {
      console.log(`[${clientId}] Invalid payment proof, incrementing counter to ${newIntentos}`);

      // Check if exceeded max attempts
      const maxIntentos = config.kommo.max_intentos_comprobante || 3;
      if (newIntentos >= maxIntentos) {
        console.log(`[${clientId}] Max intentos reached (${newIntentos}/${maxIntentos}), moving to NO_RESPONDIO`);

        if (config.kommo.no_respondio_status_id) {
          await moveLeadToStatus(leadId, config.kommo.no_respondio_status_id, config);
        }

        return NextResponse.json({
          success: true,
          message: 'Max attempts reached - moved to NO_RESPONDIO',
          data: {
            leadId,
            isValid: false,
            intentos: newIntentos,
            maxIntentos,
          }
        });
      } else {
        console.log(`[${clientId}] Moving to COMPROBANTE_NO_RECIBIDO for retry`);

        if (config.kommo.comprobante_no_recibido_status_id) {
          await moveLeadToStatus(leadId, config.kommo.comprobante_no_recibido_status_id, config);
        }

        return NextResponse.json({
          success: true,
          message: 'Invalid payment proof - retry requested',
          data: {
            leadId,
            isValid: false,
            confidence: validationResult.confidence,
            reason: validationResult.reason,
            intentos: newIntentos,
            maxIntentos,
          }
        });
      }
    }

  } catch (error) {
    console.error(`[${clientId}] Error:`, error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/zeus/kommo-message-received - Health check
 */
export async function GET() {
  const config = getClientConfig('zeus');

  return NextResponse.json({
    status: config ? 'ok' : 'error',
    client: 'zeus',
    mode: 'multi-pipeline-auto-detect',
    configured: !!config,
    message: config
      ? 'Ready to receive message webhooks (auto-detects pipeline: zeus1/zeus2/zeus3)'
      : `Client 'zeus' not found`,
    timestamp: new Date().toISOString(),
  });
}
