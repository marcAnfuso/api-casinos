/**
 * Meta Conversions API (CAPI) client
 * Sends conversion events to Meta for attribution tracking
 * Uses external_id for matching instead of fbclid
 */

import crypto from 'crypto';

interface UserData {
  external_id?: string[]; // Our custom tracking ID (hashed)
  fbc?: string;           // Click ID (fbclid in fbc format) - optional
  fbp?: string;           // Browser ID
  em?: string[];          // Email (hashed)
  ph?: string[];          // Phone (hashed)
  client_ip_address?: string;
  client_user_agent?: string;
}

interface CustomData {
  currency?: string;
  value?: number;
  content_name?: string;
  content_category?: string;
}

interface ConversionEvent {
  event_name: 'Purchase' | 'Lead' | 'CompleteRegistration' | 'InitiateCheckout';
  event_time: number;
  event_id?: string;
  event_source_url?: string;
  action_source: 'website' | 'app' | 'phone_call' | 'chat' | 'email' | 'other';
  user_data: UserData;
  custom_data?: CustomData;
}

interface MetaCapiConfig {
  pixel_id: string;
  access_token: string;
}

/**
 * Hash value with SHA256 for Meta CAPI (required for PII fields)
 */
function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex');
}

/**
 * Format fbclid to fbc format: fb.1.{timestamp}.{fbclid}
 * @deprecated Use external_id instead
 */
export function formatFbc(fbclid: string, timestamp?: number): string {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  return `fb.1.${ts}.${fbclid}`;
}

/**
 * Extract tracking ID from [REF:xxx] format in message text
 * The tracking ID is our custom 6-char ID used for matching conversions
 */
export function extractTrackingIdFromMessage(messageText: string): string | null {
  const match = messageText.match(/\[REF:([^\]]+)\]/);
  return match ? match[1] : null;
}

// Alias for backwards compatibility
export const extractFbclidFromMessage = extractTrackingIdFromMessage;

/**
 * Send conversion event to Meta CAPI
 */
export async function sendConversionEvent(
  config: MetaCapiConfig,
  event: ConversionEvent,
  testEventCode?: string
): Promise<{ success: boolean; error?: string; response?: unknown }> {
  const url = `https://graph.facebook.com/v18.0/${config.pixel_id}/events`;

  const body: {
    data: ConversionEvent[];
    access_token: string;
    test_event_code?: string;
  } = {
    data: [event],
    access_token: config.access_token,
  };

  // Add test event code for debugging (remove in production)
  if (testEventCode) {
    body.test_event_code = testEventCode;
  }

  try {
    console.log('[Meta CAPI] Sending event:', JSON.stringify(event, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.error('[Meta CAPI] Error:', responseData);
      return {
        success: false,
        error: responseData.error?.message || 'Unknown error',
        response: responseData,
      };
    }

    console.log('[Meta CAPI] Success:', responseData);
    return {
      success: true,
      response: responseData,
    };
  } catch (error) {
    console.error('[Meta CAPI] Request failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Request failed',
    };
  }
}

/**
 * Send Purchase event to Meta CAPI
 * Called when a lead deposits (comprobante confirmed)
 * Uses external_id (our tracking ID) for matching with pixel events
 */
export async function sendPurchaseEvent(
  config: MetaCapiConfig,
  data: {
    trackingId: string;  // Our 6-char tracking ID from [REF:xxx]
    phone?: string;
    value: number;
    currency?: string;
    eventSourceUrl?: string;
    userAgent?: string;
    ipAddress?: string;
  },
  testEventCode?: string
): Promise<{ success: boolean; error?: string }> {
  const eventTime = Math.floor(Date.now() / 1000);

  // Use external_id (hashed) for matching with pixel events
  const userData: UserData = {
    external_id: [hashValue(data.trackingId)],
  };

  // Add optional user data for better matching
  if (data.phone) {
    // Normalize phone: remove spaces, dashes, and +
    const normalizedPhone = data.phone.replace(/[\s\-\+]/g, '');
    userData.ph = [hashValue(normalizedPhone)];
  }

  if (data.userAgent) {
    userData.client_user_agent = data.userAgent;
  }

  if (data.ipAddress) {
    userData.client_ip_address = data.ipAddress;
  }

  const event: ConversionEvent = {
    event_name: 'Comprar' as ConversionEvent['event_name'],
    event_time: eventTime,
    event_id: `comprar_${eventTime}_${Math.random().toString(36).substr(2, 9)}`,
    action_source: 'website',
    user_data: userData,
    custom_data: {
      currency: data.currency || 'ARS',
      value: data.value,
    },
  };

  if (data.eventSourceUrl) {
    event.event_source_url = data.eventSourceUrl;
  }

  return sendConversionEvent(config, event, testEventCode);
}

/**
 * Send Lead event to Meta CAPI
 * Called when a user creates an account/registers
 * Uses external_id (our tracking ID) for matching with pixel events
 */
export async function sendLeadEvent(
  config: MetaCapiConfig,
  data: {
    trackingId: string;  // Our 6-char tracking ID from [REF:xxx]
    phone?: string;
    email?: string;
    eventSourceUrl?: string;
  },
  testEventCode?: string
): Promise<{ success: boolean; error?: string }> {
  const eventTime = Math.floor(Date.now() / 1000);

  // Use external_id (hashed) for matching with pixel events
  const userData: UserData = {
    external_id: [hashValue(data.trackingId)],
  };

  if (data.phone) {
    const normalizedPhone = data.phone.replace(/[\s\-\+]/g, '');
    userData.ph = [hashValue(normalizedPhone)];
  }

  if (data.email) {
    userData.em = [hashValue(data.email)];
  }

  const event: ConversionEvent = {
    event_name: 'Lead',
    event_time: eventTime,
    event_id: `lead_${eventTime}_${Math.random().toString(36).substr(2, 9)}`,
    action_source: 'website',
    user_data: userData,
  };

  if (data.eventSourceUrl) {
    event.event_source_url = data.eventSourceUrl;
  }

  return sendConversionEvent(config, event, testEventCode);
}
