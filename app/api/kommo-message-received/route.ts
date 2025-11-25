import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/kommo-message-received
 * Webhook que KOMMO dispara cuando llega un mensaje nuevo
 * Detecta si el mensaje tiene adjuntos (foto del comprobante)
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    console.log('[KOMMO Message Received] Payload completo:', JSON.stringify(payload, null, 2));

    // Extraer datos del mensaje
    const message = payload.message || payload;
    const leadId = message.entity_id;
    const messageType = message.message_type; // 'in' = mensaje entrante del usuario
    const attachments = message.attachments || [];

    console.log('[KOMMO Message Received] Datos extraídos:', {
      leadId,
      messageType,
      hasAttachments: attachments.length > 0,
      attachmentCount: attachments.length,
    });

    // Solo procesar mensajes entrantes del usuario (no salientes del bot)
    if (messageType !== 'in') {
      console.log('[KOMMO Message Received] Mensaje saliente, ignorando...');
      return NextResponse.json({ success: true, message: 'Outgoing message ignored' });
    }

    // Verificar si tiene adjuntos (imagen, PDF, archivo)
    const hasAttachment = attachments.length > 0;

    if (!hasAttachment) {
      console.log('[KOMMO Message Received] No hay adjuntos, ignorando...');
      return NextResponse.json({ success: true, message: 'No attachment found' });
    }

    // Verificar tipo de archivo (imagen o PDF)
    const attachment = attachments[0];
    const attachmentType = attachment.type; // 'image', 'file', 'audio', 'video'
    const fileName = attachment.file_name || attachment.name || 'unknown';
    const fileUrl = attachment.link || attachment.url;

    console.log('[KOMMO Message Received] Adjunto detectado:', {
      type: attachmentType,
      fileName,
      fileUrl,
    });

    // Validar que sea imagen o PDF (comprobante válido)
    const validTypes = ['image', 'file'];
    const isValidAttachment = validTypes.includes(attachmentType);

    if (!isValidAttachment) {
      console.log('[KOMMO Message Received] Tipo de adjunto no válido, esperando imagen o archivo');
      return NextResponse.json({
        success: true,
        message: 'Attachment type not valid for proof'
      });
    }

    // COMPROBANTE DETECTADO - Cambiar status del lead
    console.log('[KOMMO Message Received] ✅ Comprobante detectado! Cambiando status del lead...');

    const statusChanged = await changeLeadStatus(leadId);

    if (statusChanged) {
      console.log('[KOMMO Message Received] Status del lead actualizado exitosamente');

      // Opcional: Agregar nota interna con info del comprobante
      await addNoteToLead(leadId, fileName, fileUrl);
    }

    return NextResponse.json({
      success: true,
      message: 'Proof received and lead status updated',
      data: {
        leadId,
        attachmentType,
        fileName,
        statusChanged,
      },
    });

  } catch (error) {
    console.error('[KOMMO Message Received] Error:', error);
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
 * Cambia el status del lead a "Comprobante Recibido"
 */
async function changeLeadStatus(leadId: number): Promise<boolean> {
  const kommoToken = process.env.KOMMO_ACCESS_TOKEN?.trim();
  const kommoSubdomain = process.env.KOMMO_SUBDOMAIN?.trim();

  // TODO: Obtener este ID desde tu pipeline de KOMMO
  // Andá a Settings → Pipelines → Mirá el ID del status "Comprobante Recibido"
  const COMPROBANTE_RECIBIDO_STATUS_ID = parseInt(
    process.env.KOMMO_COMPROBANTE_STATUS_ID || '0'
  );

  if (!kommoToken || !kommoSubdomain || !COMPROBANTE_RECIBIDO_STATUS_ID) {
    console.warn('[KOMMO Message Received] Config incompleta, no se puede cambiar status');
    return false;
  }

  try {
    const response = await fetch(
      `https://${kommoSubdomain}.kommo.com/api/v4/leads/${leadId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${kommoToken}`,
        },
        body: JSON.stringify({
          status_id: COMPROBANTE_RECIBIDO_STATUS_ID,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[KOMMO Message Received] Error al cambiar status:', {
        status: response.status,
        body: errorText,
      });
      return false;
    }

    console.log('[KOMMO Message Received] Status cambiado exitosamente');
    return true;

  } catch (error) {
    console.error('[KOMMO Message Received] Error al cambiar status:', error);
    return false;
  }
}

/**
 * Agrega nota interna al lead con info del comprobante
 */
async function addNoteToLead(
  leadId: number,
  fileName: string,
  fileUrl?: string
): Promise<boolean> {
  const kommoToken = process.env.KOMMO_ACCESS_TOKEN?.trim();
  const kommoSubdomain = process.env.KOMMO_SUBDOMAIN?.trim();

  if (!kommoToken || !kommoSubdomain) {
    return false;
  }

  const noteText = `📎 Comprobante recibido: ${fileName}${fileUrl ? `\nURL: ${fileUrl}` : ''}`;

  try {
    const response = await fetch(
      `https://${kommoSubdomain}.kommo.com/api/v4/leads/notes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${kommoToken}`,
        },
        body: JSON.stringify([
          {
            entity_id: leadId,
            note_type: 'common',
            params: {
              text: noteText,
            },
          },
        ]),
      }
    );

    return response.ok;
  } catch (error) {
    console.error('[KOMMO Message Received] Error al agregar nota:', error);
    return false;
  }
}

/**
 * Crea una tarea de seguimiento si el usuario no envía comprobante en X tiempo
 * (Esta función se puede llamar desde un cron job o scheduled task)
 */
async function createFollowUpTask(leadId: number): Promise<boolean> {
  const kommoToken = process.env.KOMMO_ACCESS_TOKEN?.trim();
  const kommoSubdomain = process.env.KOMMO_SUBDOMAIN?.trim();

  if (!kommoToken || !kommoSubdomain) {
    return false;
  }

  // Fecha de vencimiento: 24 horas desde ahora
  const completeBefore = Math.floor(Date.now() / 1000) + (24 * 60 * 60);

  try {
    const response = await fetch(
      `https://${kommoSubdomain}.kommo.com/api/v4/tasks`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${kommoToken}`,
        },
        body: JSON.stringify([
          {
            entity_id: leadId,
            entity_type: 'leads',
            text: 'Seguimiento: Usuario no envió comprobante de pago',
            complete_till: completeBefore,
            task_type_id: 1, // Llamada (task type, ajustar según tu config)
          },
        ]),
      }
    );

    return response.ok;
  } catch (error) {
    console.error('[KOMMO Message Received] Error al crear task:', error);
    return false;
  }
}

/**
 * GET /api/kommo-message-received
 * Health check
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'KOMMO message webhook endpoint',
    timestamp: new Date().toISOString(),
  });
}
