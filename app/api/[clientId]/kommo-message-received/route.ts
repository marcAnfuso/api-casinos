import { NextRequest, NextResponse } from 'next/server';
import { getClientConfig, ClientConfig } from '@/lib/config';
import { validatePaymentProof } from '@/lib/vision-validator';

interface RouteParams {
  params: Promise<{ clientId: string }>;
}

/**
 * Cambia el status del lead según si se recibió comprobante o no
 */
async function changeLeadStatus(
  leadId: number,
  proofReceived: boolean,
  config: ClientConfig
): Promise<boolean> {
  if (!config.kommo.access_token || !config.kommo.subdomain) {
    console.warn('[KOMMO Message] KOMMO credentials not configured');
    return false;
  }

  const statusId = proofReceived
    ? config.kommo.comprobante_recibido_status_id
    : config.kommo.comprobante_no_recibido_status_id;

  if (!statusId) {
    console.warn(`[KOMMO Message] ${proofReceived ? 'comprobante_recibido' : 'comprobante_no_recibido'}_status_id not configured`);
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
      const errorText = await response.text();
      console.error('[KOMMO Message] Status change error:', { status: response.status, body: errorText });
      return false;
    }

    console.log(`[KOMMO Message] Lead moved to: ${proofReceived ? 'COMPROBANTE RECIBIDO' : 'COMPROBANTE NO RECIBIDO'}`);
    return true;

  } catch (error) {
    console.error('[KOMMO Message] Status change error:', error);
    return false;
  }
}

/**
 * Agrega nota interna al lead con info del comprobante
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
 * POST /api/[clientId]/kommo-message-received
 * Webhook que KOMMO dispara cuando llega un mensaje nuevo
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { clientId } = await params;

  // Get client configuration
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

    // Extract message data - handle both Chats API and standard webhook formats
    let leadId: number | null = null;
    let isIncoming = false;
    let attachmentType: string | null = null;
    let fileName = 'unknown';
    let fileUrl: string | undefined;

    // Check for Chats API format (message.message.type exists)
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

    // No attachment → move to COMPROBANTE NO RECIBIDO
    if (!attachmentType || !fileUrl) {
      console.log(`[${clientId}] No media attachment - moving to COMPROBANTE NO RECIBIDO`);
      const statusChanged = await changeLeadStatus(leadId, false, config);
      return NextResponse.json({
        success: true,
        message: 'No media - moved to COMPROBANTE NO RECIBIDO',
        client: clientId,
        data: { leadId, statusChanged, stage: 'COMPROBANTE NO RECIBIDO' },
      });
    }

    const validTypes = ['image', 'file'];
    if (!validTypes.includes(attachmentType)) {
      return NextResponse.json({ success: true, message: 'Attachment type not valid for proof' });
    }

    // Validate with AI Vision (only for images)
    let aiValidation = { isPaymentProof: true, confidence: 'low' as const, reason: 'Skipped' };
    if (attachmentType === 'image' && fileUrl) {
      const geminiApiKey = process.env.GEMINI_API_KEY;
      aiValidation = await validatePaymentProof(fileUrl, geminiApiKey);

      console.log(`[${clientId}] AI Validation:`, aiValidation);

      // Not a payment proof → move to COMPROBANTE NO RECIBIDO
      if (!aiValidation.isPaymentProof) {
        console.log(`[${clientId}] Image rejected: ${aiValidation.reason}`);
        const statusChanged = await changeLeadStatus(leadId, false, config);
        return NextResponse.json({
          success: true,
          message: 'Image not a payment proof - moved to COMPROBANTE NO RECIBIDO',
          client: clientId,
          data: { leadId, statusChanged, stage: 'COMPROBANTE NO RECIBIDO', aiValidation },
        });
      }
    }

    // Valid payment proof → move to COMPROBANTE RECIBIDO
    console.log(`[${clientId}] Payment proof detected!`);
    const statusChanged = await changeLeadStatus(leadId, true, config);

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
