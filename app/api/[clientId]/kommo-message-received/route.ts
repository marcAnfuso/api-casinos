import { NextRequest, NextResponse } from 'next/server';
import { getClientConfig, ClientConfig } from '@/lib/config';

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

    // Extract message data
    const message = payload.message || payload;
    const leadId = message.entity_id;
    const messageType = message.message_type;
    const attachments = message.attachments || [];

    console.log(`[${clientId}] Message data:`, {
      leadId,
      messageType,
      hasAttachments: attachments.length > 0,
    });

    // Only process incoming messages
    if (messageType !== 'in') {
      return NextResponse.json({ success: true, message: 'Outgoing message ignored' });
    }

    // Check for attachments
    if (attachments.length === 0) {
      return NextResponse.json({ success: true, message: 'No attachment found' });
    }

    // Validate attachment type
    const attachment = attachments[0];
    const attachmentType = attachment.type;
    const fileName = attachment.file_name || attachment.name || 'unknown';
    const fileUrl = attachment.link || attachment.url;

    const validTypes = ['image', 'file'];
    if (!validTypes.includes(attachmentType)) {
      return NextResponse.json({
        success: true,
        message: 'Attachment type not valid for proof',
      });
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
