/**
 * AI Vision Validator using OpenAI GPT-4o-mini
 * Validates if an image or PDF is a payment receipt/proof
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export interface ValidationResult {
  isPaymentProof: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  monto?: number;
}

/**
 * Checks if a file is a PDF based on name or MIME type
 */
function isPdfFile(fileName: string, mimeType?: string): boolean {
  return fileName.toLowerCase().endsWith('.pdf') ||
    (mimeType?.includes('application/pdf') ?? false);
}

/**
 * Downloads image and converts to base64
 */
async function imageUrlToBase64(imageUrl: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error('[Vision] Failed to download image:', response.status);
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      base64,
      mimeType: contentType,
    };
  } catch (error) {
    console.error('[Vision] Error downloading image:', error);
    return null;
  }
}

/**
 * Downloads a PDF and converts its first page to a PNG base64 image
 */
async function pdfUrlToBase64Image(pdfUrl: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const response = await fetch(pdfUrl);
    if (!response.ok) {
      console.error('[Vision] Failed to download PDF:', response.status);
      return null;
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    console.log(`[Vision] PDF downloaded: ${pdfBuffer.length} bytes`);

    // Dynamic import to avoid Turbopack bundling issues
    const { pdf } = await import('pdf-to-img');

    // Convert first page to PNG
    const pages = await pdf(pdfBuffer);
    for await (const page of pages) {
      // Return only the first page
      return {
        base64: Buffer.from(page).toString('base64'),
        mimeType: 'image/png',
      };
    }

    console.error('[Vision] PDF conversion returned no pages');
    return null;
  } catch (error) {
    console.error('[Vision] Error converting PDF to image:', error);
    return null;
  }
}

/**
 * Validates if an image or PDF is a payment proof using OpenAI Vision
 */
export async function validatePaymentProof(
  imageUrl: string,
  fileName: string
): Promise<ValidationResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  // If no API key, skip validation and assume it's valid
  if (!apiKey) {
    console.warn('[Vision] OPENAI_API_KEY not configured, skipping validation');
    return {
      isPaymentProof: true,
      confidence: 'low',
      reason: 'Validation skipped - no API key configured',
    };
  }

  // Download and convert to base64 (handle both images and PDFs)
  const isPdf = isPdfFile(fileName);
  let imageData: { base64: string; mimeType: string } | null;

  if (isPdf) {
    console.log(`[Vision] PDF detected (${fileName}), converting first page to image...`);
    imageData = await pdfUrlToBase64Image(imageUrl);
  } else {
    imageData = await imageUrlToBase64(imageUrl);
  }

  if (!imageData) {
    return {
      isPaymentProof: false,
      confidence: 'low',
      reason: isPdf ? 'Failed to convert PDF to image' : 'Failed to download image',
    };
  }

  const prompt = `Analiza esta imagen y determina si es un comprobante de pago, transferencia bancaria, o recibo de transacción financiera.

Responde SOLO en este formato JSON exacto:
{
  "isPaymentProof": true/false,
  "confidence": "high"/"medium"/"low",
  "reason": "explicación breve en español",
  "monto": número o null
}

Para el campo "monto":
- Si es un comprobante de pago, extrae el monto/importe principal de la transacción (solo el número, sin símbolo de moneda)
- Busca campos como "Importe", "Monto", "Total", "Transferiste", "Le pagaste", etc.
- Si hay varios montos, usa el monto principal de la transacción (no comisiones ni saldos)
- Si no podés determinar el monto, devolvé null

Criterios para considerar como comprobante de pago (debe mostrar una TRANSACCIÓN REALIZADA con datos específicos):
- Screenshot de transferencia bancaria COMPLETADA (debe decir "Transferiste", "Enviaste", "Operación realizada", "Comprobante", etc.)
- Comprobante de Mercado Pago, PayPal, o apps de pago que muestre una operación CONCRETADA
- Recibo de cajero automático con detalle de operación
- Comprobante de depósito con número de operación
- Screenshot de wallet crypto mostrando una transacción ENVIADA
- Debe tener al menos: monto + estado de la operación (exitosa/completada) o número de referencia/comprobante

NO es comprobante de pago (MUY IMPORTANTE - rechazar estos casos):
- Pantalla principal/home de apps bancarias mostrando saldo disponible
- Pantallas que solo muestran saldo o balance sin detalle de transferencia
- Listados de movimientos o historial sin una transacción específica abierta
- Pantallas con botones como "Transferir", "Pagar", "Ingresar" (es la home, NO un comprobante)
- Screenshots que muestran opciones del banco pero no una operación realizada
- Fotos personales, selfies, memes
- Screenshots de conversaciones
- Imágenes de productos
- Documentos que no sean financieros`;

  // Retry loop
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Vision] Attempt ${attempt}/${MAX_RETRIES} - Analyzing ${isPdf ? 'PDF' : 'image'}: ${fileName}`);

      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${imageData.mimeType};base64,${imageData.base64}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 256,
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Vision] OpenAI API error (attempt ${attempt}):`, response.status, errorText);

        // If not last attempt, wait and retry
        if (attempt < MAX_RETRIES) {
          console.log(`[Vision] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }

        // Last attempt failed
        return {
          isPaymentProof: true, // Fail open - don't block if API fails
          confidence: 'low',
          reason: 'API error after all retries',
        };
      }

      const data = await response.json();
      const textResponse = data.choices?.[0]?.message?.content;

      if (!textResponse) {
        if (attempt < MAX_RETRIES) {
          console.log(`[Vision] Empty response, retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        return {
          isPaymentProof: true,
          confidence: 'low',
          reason: 'Empty API response after all retries',
        };
      }

      // Parse JSON from response
      const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[Vision] Could not parse JSON from response:', textResponse);
        return {
          isPaymentProof: true,
          confidence: 'low',
          reason: 'Could not parse response',
        };
      }

      const result = JSON.parse(jsonMatch[0]) as ValidationResult;
      console.log('[Vision] Validation result:', result);

      return result;

    } catch (error) {
      console.error(`[Vision] Validation error (attempt ${attempt}):`, error);

      if (attempt < MAX_RETRIES) {
        console.log(`[Vision] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }

      return {
        isPaymentProof: true, // Fail open
        confidence: 'low',
        reason: 'Validation error after all retries',
      };
    }
  }

  // Should never reach here, but just in case
  return {
    isPaymentProof: true,
    confidence: 'low',
    reason: 'Unknown error',
  };
}
