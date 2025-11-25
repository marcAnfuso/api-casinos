/**
 * Multi-tenant configuration loader
 * Supports multiple clients/casinos with different KOMMO + backend + Google + proxy configs
 */

import clientsConfig from '@/config/clients.json';

export interface KommoConfig {
  access_token: string;
  subdomain: string;
  whatsapp_scope_id?: string;
  username_field_id: number;
  password_field_id: number;
  comprobante_status_id: number;
}

export interface BackendConfig {
  type: string;
  api_url: string;
  api_token: string;
  skin_id?: string;
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
  backend: BackendConfig;
  google?: GoogleConfig;
  proxy?: ProxyConfig;
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
  const rawConfig = (clientsConfig.clients as Record<string, any>)[clientId];

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
      comprobante_status_id: rawConfig.kommo.comprobante_status_id,
    },
    backend: {
      type: rawConfig.backend.type,
      api_url: rawConfig.backend.api_url,
      api_token: resolveEnvVar(rawConfig.backend.api_token) || '',
      skin_id: rawConfig.backend.skin_id,
    },
  };

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
 */
export function validateClientConfig(config: ClientConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.kommo.access_token) {
    errors.push('KOMMO access_token is missing');
  }

  if (!config.kommo.subdomain) {
    errors.push('KOMMO subdomain is missing');
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
