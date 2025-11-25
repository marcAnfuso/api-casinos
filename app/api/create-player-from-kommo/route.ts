import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { createGoogleContact } from '@/lib/google-contacts';

interface KommoWebhookPayload {
  leads?: {
    update?: Array<{
      id: number;
      name?: string;
    }>;
  };
  contacts?: {
    update?: Array<{
      id: number;
      name?: string;
      custom_fields?: Array<{
        id: number;
        name: string;
        values: Array<{
          value: string;
        }>;
      }>;
    }>;
  };
}

interface KommoNotePayload {
  entity_id: number;
  note_type: string;
  params: {
    text: string;
  };
}

/**
 * Extrae el Lead ID del payload de KOMMO
 */
function extractLeadIdFromKommo(payload: KommoWebhookPayload): number | null {
  if (payload.leads?.update && payload.leads.update[0]?.id) {
    return payload.leads.update[0].id;
  }
  return null;
}

/**
 * Envía mensaje directo al usuario via WhatsApp (usando canal integrado en KOMMO)
 */
async function sendWhatsAppMessageToUser(
  leadId: number,
  username: string,
  password: string
): Promise<boolean> {
  const kommoToken = process.env.KOMMO_ACCESS_TOKEN?.trim();
  const kommoSubdomain = process.env.KOMMO_SUBDOMAIN?.trim();
  const kommoScopeId = process.env.KOMMO_WHATSAPP_SCOPE_ID?.trim();

  if (!kommoToken || !kommoSubdomain) {
    console.warn('[KOMMO Create Player] KOMMO_ACCESS_TOKEN o KOMMO_SUBDOMAIN no configurados');
    return false;
  }

  if (!kommoScopeId) {
    console.warn('[KOMMO Create Player] KOMMO_WHATSAPP_SCOPE_ID no configurado - intentando sin scope_id');
  }

  const messageText = `🎰 ¡Cuenta creada exitosamente!

Usuario: ${username}
Contraseña: ${password}

Podés iniciar sesión en: https://bet30.blog`;

  try {
    // Preparar payload con scope_id si está configurado
    const payload: {
      conversation_id: number;
      scope_id?: string;
      message: { text: string };
    } = {
      conversation_id: leadId,
      message: {
        text: messageText,
      },
    };

    // Agregar scope_id solo si está configurado
    if (kommoScopeId) {
      payload.scope_id = kommoScopeId;
    }

    console.log('[KOMMO Create Player] Enviando mensaje WhatsApp:', {
      leadId,
      scopeId: kommoScopeId || 'no configurado',
    });

    // Enviar mensaje via WhatsApp integrado en KOMMO
    const response = await fetch(
      `https://${kommoSubdomain}.kommo.com/api/v4/talks/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${kommoToken}`,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[KOMMO Create Player] Error al enviar mensaje WhatsApp:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });
      return false;
    }

    const result = await response.json();
    console.log('[KOMMO Create Player] Mensaje WhatsApp enviado exitosamente:', result);
    return true;
  } catch (error) {
    console.error('[KOMMO Create Player] Error al enviar WhatsApp:', error);
    return false;
  }
}

/**
 * Envía una nota al lead en KOMMO con las credenciales del jugador (backup interno)
 */
async function sendCredentialsToKommo(
  leadId: number,
  username: string,
  password: string
): Promise<void> {
  const kommoToken = process.env.KOMMO_ACCESS_TOKEN?.trim();
  const kommoSubdomain = process.env.KOMMO_SUBDOMAIN?.trim();

  if (!kommoToken || !kommoSubdomain) {
    console.warn('[KOMMO Create Player] KOMMO_ACCESS_TOKEN o KOMMO_SUBDOMAIN no configurados');
    return;
  }

  const noteText = `🎰 Cuenta creada exitosamente

Usuario: ${username}
Contraseña: ${password}

Podés iniciar sesión en: https://bet30.blog`;

  const notePayload: KommoNotePayload[] = [
    {
      entity_id: leadId,
      note_type: 'common',
      params: {
        text: noteText,
      },
    },
  ];

  try {
    const response = await fetch(
      `https://${kommoSubdomain}.kommo.com/api/v4/leads/notes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${kommoToken}`,
        },
        body: JSON.stringify(notePayload),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[KOMMO Create Player] Error al enviar nota a KOMMO:', errorData);
      throw new Error(`KOMMO API error: ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    console.log('[KOMMO Create Player] Nota enviada exitosamente a KOMMO:', result);
  } catch (error) {
    console.error('[KOMMO Create Player] Error al comunicarse con KOMMO:', error);
    // No lanzamos el error para no fallar todo el proceso si solo falla el envío de la nota
  }
}

/**
 * Actualiza los custom fields del lead con username y password
 */
async function updateLeadCustomFields(
  leadId: number,
  username: string,
  password: string
): Promise<boolean> {
  const kommoToken = process.env.KOMMO_ACCESS_TOKEN?.trim();
  const kommoSubdomain = process.env.KOMMO_SUBDOMAIN?.trim();
  const usernameFieldId = process.env.KOMMO_USERNAME_FIELD_ID?.trim();
  const passwordFieldId = process.env.KOMMO_PASSWORD_FIELD_ID?.trim();

  if (!kommoToken || !kommoSubdomain) {
    console.warn('[KOMMO Create Player] KOMMO_ACCESS_TOKEN o KOMMO_SUBDOMAIN no configurados');
    return false;
  }

  if (!usernameFieldId || !passwordFieldId) {
    console.warn('[KOMMO Create Player] KOMMO_USERNAME_FIELD_ID o KOMMO_PASSWORD_FIELD_ID no configurados');
    return false;
  }

  try {
    const payload = {
      custom_fields_values: [
        {
          field_id: parseInt(usernameFieldId),
          values: [
            {
              value: username,
            },
          ],
        },
        {
          field_id: parseInt(passwordFieldId),
          values: [
            {
              value: password,
            },
          ],
        },
      ],
    };

    console.log('[KOMMO Create Player] Actualizando custom fields del lead:', {
      leadId,
      usernameFieldId,
      passwordFieldId,
    });

    const response = await fetch(
      `https://${kommoSubdomain}.kommo.com/api/v4/leads/${leadId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${kommoToken}`,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[KOMMO Create Player] Error al actualizar custom fields:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });
      return false;
    }

    const result = await response.json();
    console.log('[KOMMO Create Player] Custom fields actualizados exitosamente:', result);
    return true;
  } catch (error) {
    console.error('[KOMMO Create Player] Error al actualizar custom fields:', error);
    return false;
  }
}

/**
 * Extrae el email del payload de KOMMO
 */
function extractEmailFromKommo(payload: KommoWebhookPayload): string | null {
  if (payload.contacts?.update) {
    for (const contact of payload.contacts.update) {
      if (contact.custom_fields) {
        const emailField = contact.custom_fields.find(
          (field) => field.name === 'Email' || field.name === 'email' || field.name === 'E-mail'
        );
        if (emailField && emailField.values[0]?.value) {
          return emailField.values[0].value;
        }
      }
    }
  }
  return null;
}

/**
 * Extrae el nombre del payload de KOMMO
 */
function extractNameFromKommo(payload: KommoWebhookPayload): string | null {
  // Intentar desde contacts.update
  if (payload.contacts?.update && payload.contacts.update[0]?.name) {
    return payload.contacts.update[0].name;
  }

  // Intentar desde leads.update
  if (payload.leads?.update && payload.leads.update[0]?.name) {
    return payload.leads.update[0].name;
  }

  return null;
}

/**
 * Genera username con formato: bet + 8 dígitos random
 * Ejemplo: bet12345678, bet98765432
 */
function generateUsername(): string {
  const randomDigits = Math.floor(10000000 + Math.random() * 90000000); // 8 dígitos: 10000000-99999999
  return `bet${randomDigits}`;
}

/**
 * Genera password simple
 */
function generatePassword(): string {
  return 'Pass1234'; // Password simple como solicitado
}

/**
 * POST /api/create-player-from-kommo
 * Recibe webhook de KOMMO y crea jugador en la plataforma
 */
export async function POST(request: NextRequest) {
  try {
    // Log del Content-Type para ver qué formato está enviando KOMMO
    const contentType = request.headers.get('content-type');
    console.log('[KOMMO Create Player] Content-Type recibido:', contentType);

    // Leer el body como texto primero para ver qué formato tiene
    const rawBody = await request.text();
    console.log('[KOMMO Create Player] Raw body (decoded):', decodeURIComponent(rawBody).substring(0, 1000));

    // Intentar parsear según el formato
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payload: any;

    if (contentType?.includes('application/x-www-form-urlencoded')) {
      // KOMMO envía form-urlencoded, convertir a objeto
      const params = new URLSearchParams(rawBody);
      payload = {};

      // Convertir todos los parámetros a un objeto
      for (const [key, value] of params.entries()) {
        console.log('[KOMMO Create Player] Param:', key, '=', value);
        payload[key] = value;
      }
    } else {
      // Asumir JSON
      payload = JSON.parse(rawBody);
    }

    console.log('[KOMMO Create Player] Payload completo:', JSON.stringify(payload, null, 2));

    // Extraer Lead ID directamente de los params
    let leadId: number | null = null;
    let email: string | null = null;
    let name: string | null = null;
    let phone: string | null = null;

    // Buscar en los params que vienen del webhook del Salesbot
    for (const [key, value] of Object.entries(payload)) {
      // Lead ID: leads[ad][0][id] o leads[add][0][id]
      if (key.includes('leads[') && key.includes('[id]')) {
        leadId = parseInt(value as string);
      }
      // Email: puede venir como custom_field o como param directo
      if (key.toLowerCase().includes('email')) {
        email = value as string;
      }
      // Phone: puede venir como custom_field o como param directo
      if (key.toLowerCase().includes('phone') || key.toLowerCase().includes('telefono')) {
        phone = value as string;
      }
      // Name: puede venir del lead o contact
      if (key.toLowerCase().includes('name') && !email) {
        name = value as string;
      }
    }

    console.log('[KOMMO Create Player] Datos extraídos del webhook:', { leadId, email, name, phone });

    if (!leadId) {
      console.warn('[KOMMO Create Player] No se encontró Lead ID en el payload');
      return NextResponse.json(
        { success: false, error: 'Lead ID not found in payload' },
        { status: 400 }
      );
    }

    // Si no hay email en el webhook, obtenerlo desde la API de KOMMO
    if (!email) {
      console.log('[KOMMO Create Player] Email no encontrado en webhook, consultando API de KOMMO...');

      const kommoToken = process.env.KOMMO_ACCESS_TOKEN?.trim();
      const kommoSubdomain = process.env.KOMMO_SUBDOMAIN?.trim();

      if (!kommoToken || !kommoSubdomain) {
        throw new Error('KOMMO_ACCESS_TOKEN o KOMMO_SUBDOMAIN no configurados');
      }

      try {
        // Obtener el lead con sus contactos
        const leadResponse = await fetch(
          `https://${kommoSubdomain}.kommo.com/api/v4/leads/${leadId}?with=contacts`,
          {
            headers: {
              'Authorization': `Bearer ${kommoToken}`,
            },
          }
        );

        if (!leadResponse.ok) {
          throw new Error(`Error al obtener lead de KOMMO: ${leadResponse.status}`);
        }

        const leadData = await leadResponse.json();
        console.log('[KOMMO Create Player] Lead data:', JSON.stringify(leadData, null, 2));

        // Extraer contacto principal
        const contactId = leadData._embedded?.contacts?.[0]?.id;

        if (contactId) {
          // Obtener detalles del contacto
          const contactResponse = await fetch(
            `https://${kommoSubdomain}.kommo.com/api/v4/contacts/${contactId}`,
            {
              headers: {
                'Authorization': `Bearer ${kommoToken}`,
              },
            }
          );

          if (contactResponse.ok) {
            const contactData = await contactResponse.json();
            console.log('[KOMMO Create Player] Contact data:', JSON.stringify(contactData, null, 2));

            // Buscar el campo de email
            const emailField = contactData.custom_fields_values?.find(
              (field: { field_code?: string; field_name?: string }) =>
                field.field_code === 'EMAIL' || field.field_name === 'Email'
            );

            if (emailField && emailField.values?.[0]?.value) {
              email = emailField.values[0].value;
              console.log('[KOMMO Create Player] Email encontrado en API:', email);
            }

            // Buscar el campo de teléfono
            const phoneField = contactData.custom_fields_values?.find(
              (field: { field_code?: string; field_name?: string }) =>
                field.field_code === 'PHONE' || field.field_name === 'Phone' || field.field_name === 'Teléfono'
            );

            if (phoneField && phoneField.values?.[0]?.value) {
              phone = phoneField.values[0].value;
              console.log('[KOMMO Create Player] Teléfono encontrado en API:', phone);
            }

            // Buscar el nombre si no lo tenemos
            if (!name && contactData.name) {
              name = contactData.name;
            }
          }
        }
      } catch (error) {
        console.error('[KOMMO Create Player] Error al obtener datos de KOMMO:', error);
      }
    }

    // Email es opcional - solo para logging
    if (!email) {
      console.warn('[KOMMO Create Player] No se pudo obtener email (opcional - solo para logs)');
    }

    // Generar datos del player
    const username = generateUsername(); // bet + 6 dígitos random
    const password = generatePassword(); // Password simple

    console.log('[KOMMO Create Player] Creando jugador:', { username, email: email || 'N/A', name: name || 'N/A' });

    // Crear jugador en la plataforma
    const playerData = {
      userName: username,
      password: password,
      skinId: "1025c6bf14cd",
      agentId: null,
      language: "es"
    };

    const bearerToken = process.env.PLAYER_API_TOKEN?.trim();
    if (!bearerToken) {
      throw new Error('PLAYER_API_TOKEN no configurado en variables de entorno');
    }

    console.log('[KOMMO Create Player] Request a bet30:', {
      url: 'https://admin.bet30.store/api/services/app/Players/AddPlayer',
      method: 'POST',
      tokenPresent: !!bearerToken,
      tokenLength: bearerToken.length,
      tokenPrefix: bearerToken.substring(0, 10) + '...',
      body: playerData
    });

    // DEBUGGING: Log completo del token (TEMPORAL - REMOVER DESPUÉS)
    console.log('[KOMMO Create Player] Token completo para debugging:', bearerToken);
    console.log('[KOMMO Create Player] Body exacto:', JSON.stringify(playerData));

    try {
      // Configurar proxy de Decodo (residencial)
      const proxyHost = process.env.DECODO_PROXY_HOST?.trim();
      const proxyPort = process.env.DECODO_PROXY_PORT?.trim();
      const proxyUsername = process.env.DECODO_PROXY_USERNAME?.trim();
      const proxyPassword = process.env.DECODO_PROXY_PASSWORD?.trim();

      let axiosConfig: any = {
        headers: {
          'Content-Type': 'application/json-patch+json',
          'Authorization': `Bearer ${bearerToken}`,
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 30000, // 30 segundos
      };

      // Agregar proxy si está configurado
      if (proxyHost && proxyPort && proxyUsername && proxyPassword) {
        console.log('[KOMMO Create Player] Usando proxy residencial Decodo');
        axiosConfig.proxy = {
          host: proxyHost,
          port: parseInt(proxyPort),
          auth: {
            username: proxyUsername,
            password: proxyPassword,
          },
        };
      } else {
        console.log('[KOMMO Create Player] Proxy no configurado, request directo a bet30');
      }

      const response = await axios.post(
        'https://admin.bet30.store/api/services/app/Players/AddPlayer',
        playerData,
        axiosConfig
      );

      console.log('[KOMMO Create Player] Respuesta de bet30:', {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers['content-type'],
      });

      // Verificar si es HTML (error de firewall)
      if (response.headers['content-type']?.includes('text/html')) {
        throw new Error(`bet30 API retornó HTML (status ${response.status}). IP bloqueada por firewall.`);
      }

      if (response.status !== 200) {
        throw new Error(`bet30 API error: ${response.status} ${response.statusText}`);
      }

      const result = response.data;

      console.log('[KOMMO Create Player] Jugador creado exitosamente:', result);

      // Actualizar custom fields del lead con las credenciales
      const customFieldsUpdated = await updateLeadCustomFields(leadId, username, password);

      // Crear contacto en Google Contacts (si hay nombre y teléfono)
      let googleContactCreated = false;
      if (name && phone) {
        googleContactCreated = await createGoogleContact({
          name,
          phone,
          email: email || undefined,
        });
      } else {
        console.warn('[KOMMO Create Player] No se pudo crear contacto en Google - falta nombre o teléfono');
      }

      // Primero intentar enviar mensaje directo via WhatsApp
      const whatsappSent = await sendWhatsAppMessageToUser(leadId, username, password);

      // Si WhatsApp falla, enviar nota interna como backup
      if (!whatsappSent) {
        console.log('[KOMMO Create Player] WhatsApp falló, enviando nota interna como backup...');
        await sendCredentialsToKommo(leadId, username, password);
      }

      return NextResponse.json({
        success: true,
        message: 'Player created successfully',
        username: username,
        password: password, // IMPORTANTE: En producción, nunca devuelvas la password en la respuesta
        player_data: result,
        custom_fields_updated: customFieldsUpdated,
        google_contact_created: googleContactCreated,
        whatsapp_sent: whatsappSent,
        kommo_note_sent: !whatsappSent, // Solo se envía nota si WhatsApp falla
      });

    } catch (axiosError) {
      console.error('[KOMMO Create Player] Error en request a bet30:', axiosError);
      throw axiosError;
    }

  } catch (error) {
    console.error('[KOMMO Create Player] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/create-player-from-kommo
 * Health check endpoint
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'KOMMO Create Player endpoint is ready',
    timestamp: new Date().toISOString(),
  });
}
