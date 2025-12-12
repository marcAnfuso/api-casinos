/**
 * Multi-tenant configuration loader
 * Supports multiple clients/casinos with different KOMMO + backend + Google + proxy configs
 */

import clientsConfig from '@/config/clients.json';

export interface KommoConfig {
  access_token: string;
  subdomain: string;
  whatsapp_scope_id?: string;
  username_field_id?: number;  // Optional - only for player creation
  password_field_id?: number;  // Optional - only for player creation
  esperando_comprobante_status_id?: number;
  comprobante_recibido_status_id?: number;
  comprobante_no_recibido_status_id?: number;
  no_respondio_status_id?: number;
  transferido_status_id?: number;  // Status when deposit is confirmed (triggers Meta CAPI)
  reintento_status_id?: number;    // Status for failed player creation - triggers retry
  intentos_comprobante_field_id?: number;
  max_intentos_comprobante?: number;
  fbclid_field_id?: number;  // Custom field to store fbclid from [REF:xxx]
  monto_field_id?: number;   // Custom field with deposit amount
}

export interface MetaConfig {
  pixel_id: string;
  access_token: string;
  test_event_code?: string;  // For testing in Meta Events Manager
}

export interface BackendConfig {
  type: string;
  api_url: string;
  api_token: string;
  skin_id?: string;
  username_prefix?: string;
  username_digits?: number;
}

export interface GoogleConfig {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

export interface ProxyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ClientConfig {
  name: string;
  kommo: KommoConfig;
  backend?: BackendConfig;  // Optional - not all clients need player creation
  google?: GoogleConfig;
  proxy?: ProxyConfig;
  meta?: MetaConfig;
}

interface RawClientConfig {
  name: string;
  kommo: {
    access_token: string;
    subdomain: string;
    whatsapp_scope_id?: string;
    username_field_id?: number;  // Optional - only for player creation
    password_field_id?: number;  // Optional - only for player creation
    esperando_comprobante_status_id?: number;
    comprobante_recibido_status_id?: number;
    comprobante_no_recibido_status_id?: number;
    no_respondio_status_id?: number;
    transferido_status_id?: number;
    reintento_status_id?: number;
    intentos_comprobante_field_id?: number;
    max_intentos_comprobante?: number;
    fbclid_field_id?: number;
    monto_field_id?: number;
  };
  backend?: {  // Optional - not all clients need player creation
    type: string;
    api_url: string;
    api_token: string;
    skin_id?: string;
    username_prefix?: string;
    username_digits?: number;
  };
  google?: {
    client_id: string;
    client_secret: string;
    refresh_token: string;
  };
  proxy?: {
    host: string;
    port: string;
    username: string;
    password: string;
  };
  meta?: {
    pixel_id: string;
    access_token: string;
    test_event_code?: string;
  };
}

/**
 * Resolve environment variable references in config values
 * "env:VAR_NAME" → process.env.VAR_NAME
 */
function resolveEnvVar(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value.toString();

  if (value.startsWith('env:')) {
    const envVarName = value.substring(4);
    const envValue = process.env[envVarName];

    if (!envValue) {
      console.warn(`[Config] Environment variable ${envVarName} not found`);
      return null;
    }

    return envValue.trim();
  }

  return value;
}

/**
 * Get configuration for a specific client
 */
export function getClientConfig(clientId: string): ClientConfig | null {
  const rawConfig = (clientsConfig.clients as Record<string, RawClientConfig>)[clientId];

  if (!rawConfig) {
    console.error(`[Config] Client '${clientId}' not found in config`);
    return null;
  }

  // Resolve all env vars in the config
  const config: ClientConfig = {
    name: rawConfig.name,
    kommo: {
      access_token: resolveEnvVar(rawConfig.kommo.access_token) || '',
      subdomain: rawConfig.kommo.subdomain,
      whatsapp_scope_id: resolveEnvVar(rawConfig.kommo.whatsapp_scope_id) || undefined,
      username_field_id: rawConfig.kommo.username_field_id,
      password_field_id: rawConfig.kommo.password_field_id,
      esperando_comprobante_status_id: rawConfig.kommo.esperando_comprobante_status_id,
      comprobante_recibido_status_id: rawConfig.kommo.comprobante_recibido_status_id,
      comprobante_no_recibido_status_id: rawConfig.kommo.comprobante_no_recibido_status_id,
      no_respondio_status_id: rawConfig.kommo.no_respondio_status_id,
      transferido_status_id: rawConfig.kommo.transferido_status_id,
      reintento_status_id: rawConfig.kommo.reintento_status_id,
      intentos_comprobante_field_id: rawConfig.kommo.intentos_comprobante_field_id,
      max_intentos_comprobante: rawConfig.kommo.max_intentos_comprobante,
      fbclid_field_id: rawConfig.kommo.fbclid_field_id,
      monto_field_id: rawConfig.kommo.monto_field_id,
    },
  };

  // Add backend config if present
  if (rawConfig.backend) {
    config.backend = {
      type: rawConfig.backend.type,
      api_url: rawConfig.backend.api_url,
      api_token: resolveEnvVar(rawConfig.backend.api_token) || '',
      skin_id: rawConfig.backend.skin_id,
      username_prefix: rawConfig.backend.username_prefix,
      username_digits: rawConfig.backend.username_digits,
    };
  }

  // Add Google config if present
  if (rawConfig.google) {
    const googleClientId = resolveEnvVar(rawConfig.google.client_id);
    const clientSecret = resolveEnvVar(rawConfig.google.client_secret);
    const refreshToken = resolveEnvVar(rawConfig.google.refresh_token);

    if (googleClientId && clientSecret && refreshToken) {
      config.google = {
        client_id: googleClientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      };
    }
  }

  // Add Proxy config if present
  if (rawConfig.proxy) {
    const host = resolveEnvVar(rawConfig.proxy.host);
    const port = resolveEnvVar(rawConfig.proxy.port);
    const username = resolveEnvVar(rawConfig.proxy.username);
    const password = resolveEnvVar(rawConfig.proxy.password);

    if (host && port && username && password) {
      config.proxy = {
        host,
        port: parseInt(port),
        username,
        password,
      };
    }
  }

  // Add Meta CAPI config if present
  if (rawConfig.meta) {
    const pixelId = resolveEnvVar(rawConfig.meta.pixel_id);
    const metaAccessToken = resolveEnvVar(rawConfig.meta.access_token);
    const testEventCode = rawConfig.meta.test_event_code;

    if (pixelId && metaAccessToken) {
      config.meta = {
        pixel_id: pixelId,
        access_token: metaAccessToken,
        test_event_code: testEventCode,
      };
    }
  }

  return config;
}

/**
 * Get all available client IDs
 */
export function getAvailableClients(): string[] {
  return Object.keys(clientsConfig.clients);
}

/**
 * Validate that a client has all required config
 * Note: Only validates KOMMO config as mandatory. Backend is optional.
 */
export function validateClientConfig(config: ClientConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.kommo.access_token) {
    errors.push('KOMMO access_token is missing');
  }

  if (!config.kommo.subdomain) {
    errors.push('KOMMO subdomain is missing');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that a client has backend config (for player creation)
 */
export function validateBackendConfig(config: ClientConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.backend) {
    errors.push('Backend config is missing');
    return { valid: false, errors };
  }

  if (!config.backend.api_token) {
    errors.push('Backend API token is missing');
  }

  if (!config.backend.api_url) {
    errors.push('Backend API URL is missing');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
