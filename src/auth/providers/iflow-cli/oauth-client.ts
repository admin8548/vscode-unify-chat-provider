import { randomBytes } from 'node:crypto';
import {
  IFLOW_OAUTH_AUTHORIZE_ENDPOINT,
  IFLOW_OAUTH_CLIENT_ID,
  IFLOW_OAUTH_CLIENT_SECRET,
  IFLOW_OAUTH_TOKEN_ENDPOINT,
  IFLOW_REDIRECT_URI,
  IFLOW_USER_INFO_ENDPOINT,
} from './constants';
import { authLog } from '../../../logger';

function generateState(): string {
  return randomBytes(32).toString('base64url');
}

export interface IFlowAuthorization {
  url: string;
  state: string;
  redirectUri: string;
}

export function authorizeIFlow(): IFlowAuthorization {
  const state = generateState();
  const redirectUri = IFLOW_REDIRECT_URI;

  const url = new URL(IFLOW_OAUTH_AUTHORIZE_ENDPOINT);
  url.searchParams.set('loginMethod', 'phone');
  url.searchParams.set('type', 'phone');
  url.searchParams.set('redirect', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('client_id', IFLOW_OAUTH_CLIENT_ID);

  return { url: url.toString(), state, redirectUri };
}

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
  scope?: unknown;
};

function isTokenResponse(value: unknown): value is TokenResponse {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseTokenResponse(value: unknown): TokenResponse {
  if (!isTokenResponse(value)) {
    throw new Error('Invalid token response');
  }
  return value;
}

function parseExpiresInSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeBearerTokenType(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw.toLowerCase() === 'bearer') {
    return 'Bearer';
  }
  return 'Bearer';
}

export type IFlowTokenExchangeResult =
  | {
      type: 'success';
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      tokenType: string;
    }
  | { type: 'failed'; error: string };

export async function exchangeIFlowCode(options: {
  code: string;
  redirectUri: string;
}): Promise<IFlowTokenExchangeResult> {
  authLog.verbose('iflow-cli', 'Exchanging authorization code for tokens');

  const basic = Buffer.from(
    `${IFLOW_OAUTH_CLIENT_ID}:${IFLOW_OAUTH_CLIENT_SECRET}`,
    'utf8',
  ).toString('base64');

  const response = await fetch(IFLOW_OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: options.redirectUri,
      client_id: IFLOW_OAUTH_CLIENT_ID,
      client_secret: IFLOW_OAUTH_CLIENT_SECRET,
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    authLog.error(
      'iflow-cli',
      `Token exchange failed (status: ${response.status})`,
      errorText,
    );
    return {
      type: 'failed',
      error: errorText || `Token exchange failed: ${response.status}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { type: 'failed', error: 'Failed to parse token response' };
  }

  const tokenPayload = parseTokenResponse(payload);

  const accessToken =
    typeof tokenPayload.access_token === 'string'
      ? tokenPayload.access_token.trim()
      : '';
  const refreshToken =
    typeof tokenPayload.refresh_token === 'string'
      ? tokenPayload.refresh_token.trim()
      : '';

  if (!accessToken) {
    return { type: 'failed', error: 'Missing access token in response' };
  }

  const tokenType = normalizeBearerTokenType(tokenPayload.token_type);
  const expiresInSeconds = parseExpiresInSeconds(tokenPayload.expires_in);
  const expiresAt =
    expiresInSeconds !== undefined
      ? Date.now() + expiresInSeconds * 1000
      : undefined;

  return {
    type: 'success',
    accessToken,
    refreshToken: refreshToken || undefined,
    expiresAt,
    tokenType,
  };
}

export type IFlowTokenRefreshResult =
  | {
      type: 'success';
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      tokenType: string;
    }
  | { type: 'failed'; error: string };

export async function refreshIFlowToken(options: {
  refreshToken: string;
}): Promise<IFlowTokenRefreshResult> {
  authLog.verbose('iflow-cli', 'Refreshing access token');

  const basic = Buffer.from(
    `${IFLOW_OAUTH_CLIENT_ID}:${IFLOW_OAUTH_CLIENT_SECRET}`,
    'utf8',
  ).toString('base64');

  const response = await fetch(IFLOW_OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: options.refreshToken,
      client_id: IFLOW_OAUTH_CLIENT_ID,
      client_secret: IFLOW_OAUTH_CLIENT_SECRET,
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    authLog.error(
      'iflow-cli',
      `Token refresh failed (status: ${response.status})`,
      errorText,
    );
    return {
      type: 'failed',
      error: errorText || `Token refresh failed: ${response.status}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { type: 'failed', error: 'Failed to parse token refresh response' };
  }

  const tokenPayload = parseTokenResponse(payload);

  const accessToken =
    typeof tokenPayload.access_token === 'string'
      ? tokenPayload.access_token.trim()
      : '';
  const refreshToken =
    typeof tokenPayload.refresh_token === 'string'
      ? tokenPayload.refresh_token.trim()
      : '';

  if (!accessToken) {
    return { type: 'failed', error: 'Missing access token in response' };
  }

  const tokenType = normalizeBearerTokenType(tokenPayload.token_type);
  const expiresInSeconds = parseExpiresInSeconds(tokenPayload.expires_in);
  const expiresAt =
    expiresInSeconds !== undefined
      ? Date.now() + expiresInSeconds * 1000
      : undefined;

  return {
    type: 'success',
    accessToken,
    refreshToken: refreshToken || options.refreshToken,
    expiresAt,
    tokenType,
  };
}

type UserInfoResponse = {
  success?: unknown;
  data?: unknown;
};

type UserInfoData = {
  apiKey?: unknown;
  email?: unknown;
  phone?: unknown;
};

function isUserInfoResponse(value: unknown): value is UserInfoResponse {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseUserInfoResponse(value: unknown): UserInfoResponse {
  if (!isUserInfoResponse(value)) {
    throw new Error('Invalid user info response');
  }
  return value;
}

function isUserInfoData(value: unknown): value is UserInfoData {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseUserInfoData(value: unknown): UserInfoData {
  if (!isUserInfoData(value)) {
    throw new Error('Invalid user info data');
  }
  return value;
}

function normalizeAccountIdentifier(email: unknown, phone: unknown): string | undefined {
  const emailValue = typeof email === 'string' ? email.trim() : '';
  if (emailValue) {
    return emailValue;
  }
  const phoneValue = typeof phone === 'string' ? phone.trim() : '';
  return phoneValue || undefined;
}

export type IFlowUserInfoResult =
  | { type: 'success'; apiKey: string; email?: string }
  | { type: 'failed'; error: string };

export async function fetchIFlowUserInfo(options: {
  accessToken: string;
}): Promise<IFlowUserInfoResult> {
  const accessToken = options.accessToken.trim();
  if (!accessToken) {
    return { type: 'failed', error: 'Access token is empty' };
  }

  const url = new URL(IFLOW_USER_INFO_ENDPOINT);
  url.searchParams.set('accessToken', accessToken);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    authLog.error(
      'iflow-cli',
      `Fetch user info failed (status: ${response.status})`,
      errorText,
    );
    return {
      type: 'failed',
      error: errorText || `Fetch user info failed: ${response.status}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { type: 'failed', error: 'Failed to parse user info response' };
  }

  const parsed = parseUserInfoResponse(payload);
  if (parsed.success !== true) {
    return { type: 'failed', error: 'User info request not successful' };
  }

  const data = parseUserInfoData(parsed.data);
  const apiKey = typeof data.apiKey === 'string' ? data.apiKey.trim() : '';
  if (!apiKey) {
    return { type: 'failed', error: 'Missing apiKey in user info response' };
  }

  const email = normalizeAccountIdentifier(data.email, data.phone);
  return { type: 'success', apiKey, email };
}

