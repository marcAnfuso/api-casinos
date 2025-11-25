/**
 * Google Contacts API Integration
 * Creates contacts in Google Contacts using OAuth 2.0
 */

import { google } from 'googleapis';
import { GoogleConfig } from './config';

interface ContactData {
  name: string;
  phone: string;
  email?: string;
}

/**
 * Creates a new contact in Google Contacts
 */
export async function createGoogleContact(
  data: ContactData,
  googleConfig: GoogleConfig
): Promise<boolean> {
  if (!googleConfig.client_id || !googleConfig.client_secret || !googleConfig.refresh_token) {
    console.warn('[Google Contacts] Missing OAuth credentials');
    return false;
  }

  try {
    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      googleConfig.client_id,
      googleConfig.client_secret,
      'http://localhost:3000'
    );

    // Set refresh token
    oauth2Client.setCredentials({
      refresh_token: googleConfig.refresh_token,
    });

    // Create People API client
    const people = google.people({
      version: 'v1',
      auth: oauth2Client,
    });

    // Prepare contact data
    const contact: any = {
      names: [
        {
          givenName: data.name,
        },
      ],
      phoneNumbers: [
        {
          value: data.phone,
          type: 'mobile',
        },
      ],
    };

    // Add email if provided
    if (data.email) {
      contact.emailAddresses = [
        {
          value: data.email,
          type: 'home',
        },
      ];
    }

    // Create contact
    const response = await people.people.createContact({
      requestBody: {
        ...contact,
      },
    });

    console.log('[Google Contacts] Contact created successfully:', {
      name: data.name,
      resourceName: response.data.resourceName,
    });

    return true;
  } catch (error) {
    console.error('[Google Contacts] Error creating contact:', error);
    return false;
  }
}
