import { NextRequest, NextResponse } from 'next/server';
import { getClientConfig, ClientConfig } from '@/lib/config';
import { validatePaymentProof } from '@/lib/vision-validator';

interface RouteParams {
  params: Promise<{ clientId: string }>;
}

/**
 * Cambia el status del lead a "Comprobante Recibido"
 */
async function changeLeadStatus(leadId: number, config: ClientConfig): Promise<boolean> {
  if (!config.kommo.access_token || !config.kommo.subdomain) {
    console.warn('[KOMMO Message] KOMMO credentials not configured');
    return false;
  }

  if (!config.kommo.comprobante_status_id) {
    console.warn('[KOMMO Message] comprobante_status_id not configured');
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
          status_id: config.kommo.comprobante_status_id,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[KOMMO Message] Status change error:', { status: response.status, body: errorText });
      return false;
    }

    console.log('[KOMMO Message] Status changed successfully');
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

  const noteText = `📎 Comprobante recibido: ${fileName}${fileUrl ? `\nURL: ${fileUrl}` : ''}`;

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
    // Chats API format: { message: { sender, receiver, conversation, message: { type, media, ... } } }
    // Standard format: { message: { entity_id, message_type, attachments: [...] } }

    let leadId: number | null = null;
    let isIncoming = false;
    let attachmentType: string | null = null;
    let fileName = 'unknown';
    let fileUrl: string | undefined;

    // Check for Chats API format (message.message.type exists)
    if (payload.message?.message?.type) {
      const chatMessage = payload.message;
      const innerMessage = chatMessage.message;

      // Get lead/conversation ID
      leadId = chatMessage.conversation?.id || chatMessage.talk_id || null;

      // In Chats API, incoming messages have sender info
      isIncoming = !!chatMessage.sender?.id;

      // Media type mapping: picture, video, file, voice, audio, sticker
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

      console.log(`[${clientId}] Chats API format detected:`, {
        leadId,
        isIncoming,
        messageType: innerMessage.type,
        attachmentType,
        fileName,
        hasMedia: !!fileUrl,
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

      console.log(`[${clientId}] Standard format detected:`, {
        leadId,
        isIncoming,
        hasAttachments: !!attachmentType,
      });
    }

    // Only process incoming messages
    if (!isIncoming) {
      return NextResponse.json({ success: true, message: 'Outgoing message ignored' });
    }

    // Check for attachments
    if (!attachmentType || !fileUrl) {
      return NextResponse.json({ success: true, message: 'No media attachment found' });
    }

    if (!leadId) {
      return NextResponse.json({ success: false, error: 'Could not extract lead/conversation ID' }, { status: 400 });
    }

    const validTypes = ['image', 'file'];
    if (!validTypes.includes(attachmentType)) {
      return NextResponse.json({
        success: true,
        message: 'Attachment type not valid for proof',
      });
    }

    // Validate with AI Vision (only for images with URL)
    let aiValidation = { isPaymentProof: true, confidence: 'low' as const, reason: 'Skipped' };
    if (attachmentType === 'image' && fileUrl) {
      const geminiApiKey = process.env.GEMINI_API_KEY;
      aiValidation = await validatePaymentProof(fileUrl, geminiApiKey);

      console.log(`[${clientId}] AI Validation:`, aiValidation);

      if (!aiValidation.isPaymentProof) {
        console.log(`[${clientId}] ❌ Image rejected - not a payment proof: ${aiValidation.reason}`);
        return NextResponse.json({
          success: true,
          message: 'Image is not a payment proof',
          client: clientId,
          data: {
            leadId,
            attachmentType,
            fileName,
            aiValidation,
          },
        });
      }
    }

    console.log(`[${clientId}] ✅ Payment proof detected!`);

    // Change lead status
    const statusChanged = await changeLeadStatus(leadId, config);

    if (statusChanged) {
      await addNoteToLead(leadId, fileName, fileUrl, config);
    }

    return NextResponse.json({
      success: true,
      message: 'Proof received and lead status updated',
      client: clientId,
      data: {
        leadId,
        attachmentType,
        fileName,
        statusChanged,
        aiValidation,
      },
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
