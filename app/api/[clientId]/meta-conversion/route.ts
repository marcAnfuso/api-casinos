import { NextRequest, NextResponse } from 'next/server';
import { getClientConfig, ClientConfig } from '@/lib/config';
import { sendPurchaseEvent } from '@/lib/meta-capi';

interface RouteParams {
  params: Promise<{ clientId: string }>;
}

/**
 * Obtiene los datos del lead incluyendo trackingId (de [REF:xxx]) y monto
 */
async function getLeadDataForConversion(
  leadId: number,
  config: ClientConfig
): Promise<{
  trackingId: string | null;  // Our 6-char tracking ID from [REF:xxx]
  monto: number | null;
  phone: string | null;
  statusId: number;
} | null> {
  if (!config.kommo.access_token || !config.kommo.subdomain) {
    return null;
  }

  try {
    // Fetch lead with contacts
    const response = await fetch(
      `https://${config.kommo.subdomain}.kommo.com/api/v4/leads/${leadId}?with=contacts`,
      {
        headers: {
          'Authorization': `Bearer ${config.kommo.access_token}`,
        },
      }
    );

    if (!response.ok) {
      console.error('[Meta Conversion] Failed to fetch lead:', response.status);
      return null;
    }

    const lead = await response.json();

    // Extract trackingId from custom field (stored when message with [REF:xxx] arrives)
    let trackingId: string | null = null;
    if (config.kommo.fbclid_field_id && lead.custom_fields_values) {
      const field = lead.custom_fields_values.find(
        (f: { field_id: number }) => f.field_id === config.kommo.fbclid_field_id
      );
      if (field?.values?.[0]?.value) {
        trackingId = field.values[0].value;
      }
    }

    // Extract monto from custom field
    let monto: number | null = null;
    if (config.kommo.monto_field_id && lead.custom_fields_values) {
      const field = lead.custom_fields_values.find(
        (f: { field_id: number }) => f.field_id === config.kommo.monto_field_id
      );
      if (field?.values?.[0]?.value) {
        monto = parseFloat(field.values[0].value) || null;
      }
    }

    // Get phone from primary contact
    let phone: string | null = null;
    const contacts = lead._embedded?.contacts;
    if (contacts && contacts.length > 0) {
      const primaryContactId = contacts[0].id;

      // Fetch contact details
      const contactResponse = await fetch(
        `https://${config.kommo.subdomain}.kommo.com/api/v4/contacts/${primaryContactId}`,
        {
          headers: {
            'Authorization': `Bearer ${config.kommo.access_token}`,
          },
        }
      );

      if (contactResponse.ok) {
        const contact = await contactResponse.json();
        // Find phone in custom fields
        const phoneField = contact.custom_fields_values?.find(
          (f: { field_code: string }) => f.field_code === 'PHONE'
        );
        if (phoneField?.values?.[0]?.value) {
          phone = phoneField.values[0].value;
        }
      }
    }

    return {
      trackingId,
      monto,
      phone,
      statusId: lead.status_id,
    };
  } catch (error) {
    console.error('[Meta Conversion] Error fetching lead data:', error);
    return null;
  }
}

/**
 * POST /api/[clientId]/meta-conversion
 * Webhook que KOMMO dispara cuando un lead pasa a "Transferido"
 * Envía el evento Purchase a Meta CAPI
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

  // Check Meta config
  if (!config.meta?.pixel_id || !config.meta?.access_token) {
    console.error(`[${clientId}] Meta CAPI not configured`);
    return NextResponse.json(
      { success: false, error: 'Meta CAPI not configured' },
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

    console.log(`[${clientId}] Meta conversion webhook:`, JSON.stringify(payload, null, 2));

    // Extract lead ID from various KOMMO webhook formats
    let leadId: number | null = null;

    // Check for leads[status][0][id] format (status change webhook)
    const statusLeadKey = Object.keys(payload).find(key => key.match(/leads\[status\]\[\d+\]\[id\]/));
    if (statusLeadKey) {
      leadId = parseInt(payload[statusLeadKey], 10);
    }
    // Check for leads[update][0][id] format
    else {
      const updateLeadKey = Object.keys(payload).find(key => key.match(/leads\[update\]\[\d+\]\[id\]/));
      if (updateLeadKey) {
        leadId = parseInt(payload[updateLeadKey], 10);
      }
    }

    // Fallback to JSON format
    if (!leadId && payload.leads?.status?.[0]?.id) {
      leadId = payload.leads.status[0].id;
    }
    if (!leadId && payload.leads?.update?.[0]?.id) {
      leadId = payload.leads.update[0].id;
    }

    if (!leadId) {
      return NextResponse.json(
        { success: false, error: 'Could not extract lead ID' },
        { status: 400 }
      );
    }

    console.log(`[${clientId}] Processing conversion for lead: ${leadId}`);

    // Get lead data
    const leadData = await getLeadDataForConversion(leadId, config);
    if (!leadData) {
      return NextResponse.json(
        { success: false, error: 'Could not fetch lead data' },
        { status: 500 }
      );
    }

    // Verify lead is in transferido status (if configured)
    if (config.kommo.transferido_status_id && leadData.statusId !== config.kommo.transferido_status_id) {
      console.log(`[${clientId}] Lead not in transferido status (current: ${leadData.statusId}, expected: ${config.kommo.transferido_status_id})`);
      return NextResponse.json({
        success: true,
        message: 'Lead not in transferido status - conversion not sent',
        data: { leadId, currentStatus: leadData.statusId },
      });
    }

    // Check if we have trackingId (from [REF:xxx] in message)
    if (!leadData.trackingId) {
      console.log(`[${clientId}] No trackingId found for lead ${leadId} - cannot track conversion`);
      return NextResponse.json({
        success: true,
        message: 'No trackingId found - conversion not tracked',
        data: { leadId },
      });
    }

    // Send Purchase event to Meta CAPI with our trackingId as external_id
    const result = await sendPurchaseEvent(
      {
        pixel_id: config.meta.pixel_id,
        access_token: config.meta.access_token,
      },
      {
        trackingId: leadData.trackingId,
        phone: leadData.phone || undefined,
        value: leadData.monto || 0,
        currency: 'ARS',
      },
      config.meta.test_event_code
    );

    if (!result.success) {
      console.error(`[${clientId}] Failed to send conversion:`, result.error);
      return NextResponse.json({
        success: false,
        error: result.error,
        data: { leadId },
      });
    }

    console.log(`[${clientId}] Conversion sent successfully for lead ${leadId} with trackingId: ${leadData.trackingId}`);

    return NextResponse.json({
      success: true,
      message: 'Conversion sent to Meta CAPI',
      client: clientId,
      data: {
        leadId,
        trackingId: leadData.trackingId,
        monto: leadData.monto,
        hasPhone: !!leadData.phone,
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
 * GET /api/[clientId]/meta-conversion - Health check
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { clientId } = await params;
  const config = getClientConfig(clientId);

  const hasMetaConfig = !!(config?.meta?.pixel_id && config?.meta?.access_token);

  return NextResponse.json({
    status: config ? 'ok' : 'error',
    client: clientId,
    configured: !!config,
    metaConfigured: hasMetaConfig,
    message: hasMetaConfig
      ? 'Meta conversion endpoint ready'
      : config
        ? 'Meta CAPI not configured for this client'
        : `Client '${clientId}' not found`,
    timestamp: new Date().toISOString(),
  });
}
