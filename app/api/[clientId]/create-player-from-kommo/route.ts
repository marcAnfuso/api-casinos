import { NextRequest, NextResponse } from 'next/server';
import axios, { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getClientConfig, validateClientConfig, ClientConfig } from '@/lib/config';
import { createGoogleContact } from '@/lib/google-contacts';

interface RouteParams {
  params: Promise<{ clientId: string }>;
}

interface KommoCustomField {
  field_id: number;
  field_code?: string;
  field_name?: string;
  values: { value: string }[];
}

/**
 * Envía mensaje directo al usuario via WhatsApp (usando canal integrado en KOMMO)
 */
async function sendWhatsAppMessageToUser(
  leadId: number,
  username: string,
  password: string,
  config: ClientConfig
): Promise<boolean> {
  if (!config.kommo.access_token || !config.kommo.subdomain) {
    console.warn('[KOMMO Create Player] KOMMO credentials not configured');
    return false;
  }

  if (!config.kommo.whatsapp_scope_id) {
    console.warn('[KOMMO Create Player] KOMMO_WHATSAPP_SCOPE_ID not configured');
  }

  const messageText = `🎰 ¡Cuenta creada exitosamente!

Usuario: ${username}
Contraseña: ${password}

Podés iniciar sesión en: https://bet30.blog`;

  try {
    const payload: {
      conversation_id: number;
      scope_id?: string;
      message: { text: string };
    } = {
      conversation_id: leadId,
      message: { text: messageText },
    };

    if (config.kommo.whatsapp_scope_id) {
      payload.scope_id = config.kommo.whatsapp_scope_id;
    }

    const response = await fetch(
      `https://${config.kommo.subdomain}.kommo.com/api/v4/talks/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.kommo.access_token}`,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[KOMMO Create Player] WhatsApp error:', { status: response.status, body: errorText });
      return false;
    }

    console.log('[KOMMO Create Player] WhatsApp message sent successfully');
    return true;
  } catch (error) {
    console.error('[KOMMO Create Player] WhatsApp error:', error);
    return false;
  }
}

/**
 * Envía una nota al lead en KOMMO con las credenciales
 */
async function sendCredentialsToKommo(
  leadId: number,
  username: string,
  password: string,
  config: ClientConfig
): Promise<void> {
  if (!config.kommo.access_token || !config.kommo.subdomain) {
    console.warn('[KOMMO Create Player] KOMMO credentials not configured');
    return;
  }

  const noteText = `🎰 Cuenta creada exitosamente

Usuario: ${username}
Contraseña: ${password}

Podés iniciar sesión en: https://bet30.blog`;

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
    console.log('[KOMMO Create Player] Note sent successfully');
  } catch (error) {
    console.error('[KOMMO Create Player] Note error:', error);
  }
}

/**
 * Actualiza los custom fields del lead con username y password
 */
async function updateLeadCustomFields(
  leadId: number,
  username: string,
  password: string,
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
          custom_fields_values: [
            {
              field_id: config.kommo.username_field_id,
              values: [{ value: username }],
            },
            {
              field_id: config.kommo.password_field_id,
              values: [{ value: password }],
            },
          ],
        }),
      }
    );

    return response.ok;
  } catch (error) {
    console.error('[KOMMO Create Player] Custom fields error:', error);
    return false;
  }
}

/**
 * Genera username con formato: bet + 8 dígitos random
 */
function generateUsername(): string {
  const randomDigits = Math.floor(10000000 + Math.random() * 90000000);
  return `bet${randomDigits}`;
}

/**
 * Genera password simple
 */
function generatePassword(): string {
  return 'Pass1234';
}

/**
 * POST /api/[clientId]/create-player-from-kommo
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

  // Validate configuration
  const validation = validateClientConfig(config);
  if (!validation.valid) {
    return NextResponse.json(
      { success: false, error: 'Invalid configuration', details: validation.errors },
      { status: 500 }
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

    // Extract data from webhook
    let leadId: number | null = null;
    let email: string | null = null;
    let name: string | null = null;
    let phone: string | null = null;

    for (const [key, value] of Object.entries(payload)) {
      if (key.includes('leads[') && key.includes('[id]')) {
        leadId = parseInt(value as string);
      }
      if (key.toLowerCase().includes('email')) {
        email = value as string;
      }
      if (key.toLowerCase().includes('phone') || key.toLowerCase().includes('telefono')) {
        phone = value as string;
      }
      if (key.toLowerCase().includes('name') && !email) {
        name = value as string;
      }
    }

    if (!leadId) {
      return NextResponse.json(
        { success: false, error: 'Lead ID not found in payload' },
        { status: 400 }
      );
    }

    // Fetch missing data from KOMMO API
    if (!email || !phone || !name) {
      try {
        const leadResponse = await fetch(
          `https://${config.kommo.subdomain}.kommo.com/api/v4/leads/${leadId}?with=contacts`,
          { headers: { 'Authorization': `Bearer ${config.kommo.access_token}` } }
        );

        if (leadResponse.ok) {
          const leadData = await leadResponse.json();
          const contactId = leadData._embedded?.contacts?.[0]?.id;

          if (contactId) {
            const contactResponse = await fetch(
              `https://${config.kommo.subdomain}.kommo.com/api/v4/contacts/${contactId}`,
              { headers: { 'Authorization': `Bearer ${config.kommo.access_token}` } }
            );

            if (contactResponse.ok) {
              const contactData = await contactResponse.json();

              if (!email) {
                const emailField = contactData.custom_fields_values?.find(
                  (f: KommoCustomField) => f.field_code === 'EMAIL' || f.field_name === 'Email'
                );
                email = emailField?.values?.[0]?.value || null;
              }

              if (!phone) {
                const phoneField = contactData.custom_fields_values?.find(
                  (f: KommoCustomField) => f.field_code === 'PHONE' || f.field_name === 'Phone'
                );
                phone = phoneField?.values?.[0]?.value || null;
              }

              if (!name) {
                name = contactData.name || null;
              }
            }
          }
        }
      } catch (error) {
        console.error(`[${clientId}] Error fetching KOMMO data:`, error);
      }
    }

    // Generate credentials
    const username = generateUsername();
    const password = generatePassword();

    console.log(`[${clientId}] Creating player:`, { username, name, phone });

    // Create player in backend (with proxy if configured)
    const playerData = {
      userName: username,
      password: password,
      skinId: config.backend.skin_id,
      agentId: null,
      language: 'es',
    };

    // Retry logic for residential proxy (different IP each attempt)
    const MAX_RETRIES = 3;
    let lastError: Error | null = null;
    let result: unknown = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const axiosConfig: AxiosRequestConfig = {
          headers: {
            'Content-Type': 'application/json-patch+json',
            'Authorization': `Bearer ${config.backend.api_token}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
            'Origin': 'https://admin.bet30.store',
            'Referer': 'https://admin.bet30.store/',
          },
          timeout: 30000,
        };

        // Add proxy if configured (using HttpsProxyAgent to handle SSL through proxy)
        if (config.proxy) {
          console.log(`[${clientId}] Attempt ${attempt}/${MAX_RETRIES} - Using residential proxy`);
          const proxyUrl = `http://${config.proxy.username}:${config.proxy.password}@${config.proxy.host}:${config.proxy.port}`;
          const httpsAgent = new HttpsProxyAgent(proxyUrl, {
            rejectUnauthorized: false, // Skip cert validation through proxy tunnel
          });
          axiosConfig.httpsAgent = httpsAgent;
          axiosConfig.proxy = false; // Disable axios built-in proxy, use agent instead
        }

        const response = await axios.post(config.backend.api_url, playerData, axiosConfig);

        if (response.headers['content-type']?.includes('text/html')) {
          const htmlPreview = typeof response.data === 'string'
            ? response.data.substring(0, 500)
            : 'Unable to read HTML';
          console.error(`[${clientId}] Attempt ${attempt} - Backend returned HTML:`, htmlPreview);
          throw new Error('Backend returned HTML - IP might be blocked');
        }

        if (response.status !== 200 && response.status !== 201) {
          throw new Error(`Backend error: ${response.status}`);
        }

        result = response.data;
        console.log(`[${clientId}] Player created on attempt ${attempt}:`, result);
        break; // Success, exit retry loop

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[${clientId}] Attempt ${attempt}/${MAX_RETRIES} failed:`, lastError.message);

        if (attempt < MAX_RETRIES) {
          // Wait a bit before retrying (new proxy IP)
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    if (!result) {
      throw lastError || new Error('All retry attempts failed');
    }

    // Update KOMMO custom fields
    const customFieldsUpdated = await updateLeadCustomFields(leadId, username, password, config);

    // Create Google Contact (using username as contact name)
    let googleContactCreated = false;
    if (config.google && phone) {
      googleContactCreated = await createGoogleContact(
        { name: username, phone, email: email || undefined },
        config.google
      );
    }

    // Send WhatsApp message
    const whatsappSent = await sendWhatsAppMessageToUser(leadId, username, password, config);

    // Fallback to note if WhatsApp fails
    if (!whatsappSent) {
      await sendCredentialsToKommo(leadId, username, password, config);
    }

    return NextResponse.json({
      success: true,
      message: 'Player created successfully',
      client: clientId,
      username,
      password,
      player_data: result,
      custom_fields_updated: customFieldsUpdated,
      google_contact_created: googleContactCreated,
      whatsapp_sent: whatsappSent,
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
 * GET /api/[clientId]/create-player-from-kommo - Health check
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { clientId } = await params;
  const config = getClientConfig(clientId);

  return NextResponse.json({
    status: config ? 'ok' : 'error',
    client: clientId,
    configured: !!config,
    message: config ? 'Ready to receive webhooks' : `Client '${clientId}' not found`,
    timestamp: new Date().toISOString(),
  });
}
