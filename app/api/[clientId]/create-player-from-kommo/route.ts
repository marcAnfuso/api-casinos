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
 * Mueve el lead a un status específico en KOMMO
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
      console.error('[KOMMO Create Player] Failed to move lead to status:', statusId);
      return false;
    }

    console.log(`[KOMMO Create Player] Lead ${leadId} moved to status ${statusId}`);
    return true;
  } catch (error) {
    console.error('[KOMMO Create Player] Error moving lead:', error);
    return false;
  }
}

/**
 * Agrega una nota al lead en KOMMO
 */
async function addNoteToLead(
  leadId: number,
  noteText: string,
  config: ClientConfig
): Promise<void> {
  if (!config.kommo.access_token || !config.kommo.subdomain) {
    return;
  }

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
  } catch (error) {
    console.error('[KOMMO Create Player] Error adding note:', error);
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

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[KOMMO Create Player] Custom fields update failed:', {
        status: response.status,
        body: errorBody,
        leadId,
        username_field_id: config.kommo.username_field_id,
        password_field_id: config.kommo.password_field_id,
      });
      return false;
    }

    console.log('[KOMMO Create Player] Custom fields updated successfully for lead:', leadId);
    return true;
  } catch (error) {
    console.error('[KOMMO Create Player] Custom fields error:', error);
    return false;
  }
}

/**
 * Genera username con formato configurable: prefix + N dígitos random
 */
function generateUsername(prefix: string = 'vet', digits: number = 4): string {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  const randomDigits = Math.floor(min + Math.random() * (max - min + 1));
  return `${prefix}${randomDigits}`;
}

/**
 * Genera password: Pass + 5 dígitos random
 */
function generatePassword(): string {
  const randomDigits = Math.floor(10000 + Math.random() * 90000); // 5 dígitos (10000-99999)
  return `Pass${randomDigits}`;
}

/**
 * Obtiene el status actual del lead
 */
async function getCurrentLeadStatus(
  leadId: number,
  config: ClientConfig
): Promise<number | null> {
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
    return lead.status_id || null;
  } catch {
    return null;
  }
}

/**
 * Lista de User-Agents reales para rotar y evitar detección de WAF
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
  'Mozilla/5.0 (iPad; CPU OS 17_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1.2 Mobile/15E148 Safari/604.1',
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
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

  // This endpoint requires backend config for player creation
  if (!config.backend) {
    return NextResponse.json(
      { success: false, error: 'Backend not configured for this client' },
      { status: 400 }
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

    // Check if lead is already in REINTENTO (to detect retry loop)
    const currentStatusId = await getCurrentLeadStatus(leadId, config);
    const isAlreadyInReintento = currentStatusId === config.kommo.reintento_status_id;
    if (isAlreadyInReintento) {
      console.log(`[${clientId}] Lead ${leadId} is already in REINTENTO - this is a retry attempt`);
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

    // Generate credentials using client config
    const usernamePrefix = config.backend.username_prefix || 'vet';
    const usernameDigits = config.backend.username_digits || 4;
    let username = generateUsername(usernamePrefix, usernameDigits);
    const password = generatePassword();

    console.log(`[${clientId}] Creating player:`, { username, name, phone });

    // Retry logic for residential proxy (different IP each attempt) and duplicate username
    const MAX_RETRIES = 10;
    const MAX_USERNAME_RETRIES = 3;
    const RETRY_DELAY_MS = 2000; // 2 seconds between retries
    let lastError: Error | null = null;
    let result: unknown = null;
    let usernameAttempts = 0;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Create player data with current username
        const playerData = {
          userName: username,
          password: password,
          skinId: config.backend.skin_id,
          agentId: null,
          language: 'es',
        };

        const randomUserAgent = getRandomUserAgent();
        const axiosConfig: AxiosRequestConfig = {
          headers: {
            'Content-Type': 'application/json-patch+json',
            'Authorization': `Bearer ${config.backend.api_token}`,
            'User-Agent': randomUserAgent,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
            'Origin': 'https://admin.bet30.store',
            'Referer': 'https://admin.bet30.store/',
          },
          timeout: 30000,
        };

        // Add proxy if configured (using HttpsProxyAgent to handle SSL through proxy)
        if (config.proxy) {
          console.log(`[${clientId}] Attempt ${attempt}/${MAX_RETRIES} - Using residential proxy with UA: ${randomUserAgent.substring(0, 50)}...`);
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

        // Check if response indicates duplicate username error
        const responseData = response.data;
        if (responseData?.result === 'ERROR' || responseData?.success === false) {
          usernameAttempts++;
          if (usernameAttempts < MAX_USERNAME_RETRIES) {
            console.log(`[${clientId}] Username ${username} already exists, generating new one (attempt ${usernameAttempts}/${MAX_USERNAME_RETRIES})`);
            username = generateUsername(usernamePrefix, usernameDigits);
            continue; // Retry with new username without waiting
          } else {
            throw new Error('Max username generation attempts reached');
          }
        }

        result = responseData;
        console.log(`[${clientId}] Player created on attempt ${attempt}:`, result);
        break; // Success, exit retry loop

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[${clientId}] Attempt ${attempt}/${MAX_RETRIES} failed:`, lastError.message);

        if (attempt < MAX_RETRIES) {
          // Wait before retrying (new proxy IP)
          console.log(`[${clientId}] Waiting ${RETRY_DELAY_MS / 1000}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    if (!result) {
      // All retries failed - check if this is a retry loop
      if (isAlreadyInReintento && config.kommo.ayuda_manual_status_id) {
        // Lead was already in REINTENTO and failed again → move to AYUDA MANUAL
        console.log(`[${clientId}] Retry loop detected! Moving lead ${leadId} to AYUDA MANUAL`);
        await moveLeadToStatus(leadId, config.kommo.ayuda_manual_status_id, config);
        await addNoteToLead(
          leadId,
          `🚨 AYUDA MANUAL REQUERIDA\n\nEl lead falló múltiples veces al crear jugador.\nÚltimo error: ${lastError?.message || 'Unknown error'}\n\nRequiere intervención manual.`,
          config
        );

        return NextResponse.json({
          success: false,
          needs_manual_help: true,
          message: 'Retry loop detected, moved to manual help queue',
          client: clientId,
          lead_id: leadId,
          error: lastError?.message || 'All retry attempts failed',
        });
      }

      // First failure - move to REINTENTO status if configured
      if (config.kommo.reintento_status_id) {
        console.log(`[${clientId}] All retries failed, moving lead ${leadId} to REINTENTO status`);
        await moveLeadToStatus(leadId, config.kommo.reintento_status_id, config);
        await addNoteToLead(
          leadId,
          `⚠️ Error al crear jugador - Reintentando automáticamente\n\nError: ${lastError?.message || 'Unknown error'}\nIntentos: ${MAX_RETRIES}`,
          config
        );

        // Return success with retry flag - don't update credentials fields
        return NextResponse.json({
          success: false,
          retry_scheduled: true,
          message: 'Player creation failed, moved to retry queue',
          client: clientId,
          lead_id: leadId,
          error: lastError?.message || 'All retry attempts failed',
        });
      }

      // No retry status configured, throw error as before
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

    // Move lead to CREACION Y ENVIO USER status (Salesbot will send credentials)
    let movedToCreacionEnvio = false;
    if (config.kommo.creacion_envio_user_status_id) {
      movedToCreacionEnvio = await moveLeadToStatus(leadId, config.kommo.creacion_envio_user_status_id, config);
      console.log(`[${clientId}] Lead ${leadId} moved to CREACION Y ENVIO USER status`);
    } else {
      // Fallback: send credentials as internal note if status not configured
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
      moved_to_creacion_envio: movedToCreacionEnvio,
      google_contact_created: googleContactCreated,
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
