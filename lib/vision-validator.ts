/**
 * AI Vision Validator using Google Gemini
 * Validates if an image is a payment receipt/proof
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

export interface ValidationResult {
  isPaymentProof: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
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
 * Validates if an image is a payment proof using Gemini Vision
 */
export async function validatePaymentProof(
  imageUrl: string,
  geminiApiKey: string | undefined
): Promise<ValidationResult> {
  // If no API key, skip validation and assume it's valid
  if (!geminiApiKey) {
    console.warn('[Vision] GEMINI_API_KEY not configured, skipping validation');
    return {
      isPaymentProof: true,
      confidence: 'low',
      reason: 'Validation skipped - no API key configured',
    };
  }

  // Download and convert image
  const imageData = await imageUrlToBase64(imageUrl);
  if (!imageData) {
    return {
      isPaymentProof: false,
      confidence: 'low',
      reason: 'Failed to download image',
    };
  }

  const prompt = `Analiza esta imagen y determina si es un comprobante de pago, transferencia bancaria, o recibo de transacción financiera.

Responde SOLO en este formato JSON exacto:
{
  "isPaymentProof": true/false,
  "confidence": "high"/"medium"/"low",
  "reason": "explicación breve en español"
}

Criterios para considerar como comprobante de pago:
- Screenshot de transferencia bancaria
- Comprobante de Mercado Pago, PayPal, o apps de pago
- Recibo de cajero automático
- Comprobante de depósito
- Screenshot de wallet crypto mostrando transacción

NO es comprobante de pago:
- Fotos personales, selfies, memes
- Screenshots de conversaciones
- Imágenes de productos
- Documentos que no sean financieros`;

  // Retry loop
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Vision] Attempt ${attempt}/${MAX_RETRIES}...`);

      const response = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: imageData.mimeType,
                    data: imageData.base64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 256,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Vision] Gemini API error (attempt ${attempt}):`, response.status, errorText);

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
      const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

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
