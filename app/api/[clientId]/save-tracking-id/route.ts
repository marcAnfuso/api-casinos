import { NextRequest, NextResponse } from 'next/server';
import { getClientConfig } from '@/lib/config';
import { extractTrackingIdFromMessage } from '@/lib/meta-capi';

interface RouteParams {
  params: Promise<{ clientId: string }>;
}

/**
 * POST /api/[clientId]/save-tracking-id
 * Webhook que KOMMO dispara cuando llega un mensaje
 * Extrae el [REF:xxx] del texto y lo guarda en el campo external_id del lead
 * Si no hay REF, ignora el mensaje silenciosamente
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

  // Check KOMMO config
  if (!config.kommo.access_token || !config.kommo.subdomain) {
    console.error(`[${clientId}] KOMMO not configured`);
    return NextResponse.json(
      { success: false, error: 'KOMMO not configured' },
      { status: 400 }
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
    } else {
      payload = JSON.parse(rawBody);
    }

    console.log(`[${clientId}] Save tracking ID webhook received`);

    // Extract lead ID and message text from various KOMMO webhook formats
    let leadId: number | null = null;
    let messageText: string | null = null;

    // Try to extract from message webhook format
    if (payload.message) {
      leadId = payload.message.entity_id || null;
      messageText = payload.message.text || null;
    }

    // Try form-urlencoded format
    if (!leadId) {
      const entityIdKey = Object.keys(payload).find(key => key.match(/message\[entity_id\]/));
      if (entityIdKey) {
        leadId = parseInt(payload[entityIdKey], 10);
      }
    }
    if (!messageText) {
      const textKey = Object.keys(payload).find(key => key.match(/message\[text\]/));
      if (textKey) {
        messageText = payload[textKey];
      }
    }

    // Also check for add_message format
    if (!leadId) {
      const addMessageKey = Object.keys(payload).find(key => key.match(/message\[add\]\[0\]\[entity_id\]/));
      if (addMessageKey) {
        leadId = parseInt(payload[addMessageKey], 10);
      }
    }
    if (!messageText) {
      const addTextKey = Object.keys(payload).find(key => key.match(/message\[add\]\[0\]\[text\]/));
      if (addTextKey) {
        messageText = payload[addTextKey];
      }
    }

    // Check for incoming message type (ignore outgoing)
    const messageType = payload.message?.message_type ||
                       payload['message[message_type]'] ||
                       payload['message[add][0][message_type]'];

    if (messageType === 'out') {
      return NextResponse.json({ success: true, message: 'Outgoing message ignored' });
    }

    if (!leadId) {
      console.log(`[${clientId}] Could not extract lead ID from payload`);
      return NextResponse.json({ success: true, message: 'No lead ID found' });
    }

    if (!messageText) {
      console.log(`[${clientId}] No message text in payload`);
      return NextResponse.json({ success: true, message: 'No message text' });
    }

    // Extract [REF:xxx] from message
    const trackingId = extractTrackingIdFromMessage(messageText);

    if (!trackingId) {
      // No REF found - silently ignore (could be from another source)
      console.log(`[${clientId}] No [REF:xxx] found in message for lead ${leadId} - ignoring`);
      return NextResponse.json({
        success: true,
        message: 'No tracking ID in message - ignored',
        data: { leadId }
      });
    }

    console.log(`[${clientId}] Found tracking ID: ${trackingId} for lead ${leadId}`);

    // Check if external_id field is configured
    if (!config.kommo.fbclid_field_id) {
      console.error(`[${clientId}] fbclid_field_id (external_id) not configured`);
      return NextResponse.json({
        success: false,
        error: 'external_id field not configured',
        data: { leadId, trackingId }
      }, { status: 400 });
    }

    // Save tracking ID to the lead's external_id field
    const updateResponse = await fetch(
      `https://${config.kommo.subdomain}.kommo.com/api/v4/leads/${leadId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.kommo.access_token}`,
        },
        body: JSON.stringify({
          custom_fields_values: [
            {
              field_id: config.kommo.fbclid_field_id,
              values: [{ value: trackingId }]
            }
          ]
        }),
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error(`[${clientId}] Failed to save tracking ID:`, errorText);
      return NextResponse.json({
        success: false,
        error: 'Failed to save tracking ID to lead',
        data: { leadId, trackingId }
      }, { status: 500 });
    }

    console.log(`[${clientId}] Saved tracking ID ${trackingId} to lead ${leadId}`);

    return NextResponse.json({
      success: true,
      message: 'Tracking ID saved',
      client: clientId,
      data: {
        leadId,
        trackingId,
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
 * GET /api/[clientId]/save-tracking-id - Health check
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { clientId } = await params;
  const config = getClientConfig(clientId);

  return NextResponse.json({
    status: config ? 'ok' : 'error',
    client: clientId,
    configured: !!config,
    message: config
      ? 'Save tracking ID endpoint ready'
      : `Client '${clientId}' not found`,
    timestamp: new Date().toISOString(),
  });
}
