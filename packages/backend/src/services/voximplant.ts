import crypto from 'node:crypto';
import { store } from '../db/index.js';
import { env } from '../config/env.js';
import { createAuditLog } from './audit-log.js';

const VOXIMPLANT_API = 'https://api.voximplant.com/platform_api';
const AUTO_CALLBACK_APPLICATION_NAME = 'amo-callback';
const AUTO_CALLBACK_RULE_NAME = 'amo-callback-rule';
const AUTO_CALLBACK_SCENARIO_NAME = 'amo-callback-scenario';
const AUTO_CALLBACK_RULE_PATTERN = '.*';
const AUTO_WEB_USER_NAME = 'amo_web_agent';
const AUTO_WEB_USER_DISPLAY_NAME = 'Amo Web Agent';
const CALLER_ID_SETUP_LINKS = {
  phoneNumbers: 'https://manage.voximplant.com/numbers/my_numbers',
  callerIds: 'https://manage.voximplant.com/settings/callerids',
  pstnCallerIdRules: 'https://voximplant.com/docs/references/voxengine/voxengine/callpstn',
} as const;
const AUTO_CALLBACK_SCENARIO_SCRIPT = `VoxEngine.addEventListener(AppEvents.Started, function () {
  var customData = VoxEngine.customData() || "";
  var payload = {};

  if (customData) {
    try {
      payload = JSON.parse(customData);
    } catch (e) {
      payload = { phoneNumber: customData };
    }
  }

  var destinationPhone = "";
  if (payload && typeof payload.phoneNumber === "string") {
    destinationPhone = payload.phoneNumber;
  } else if (payload && typeof payload.number === "string") {
    destinationPhone = payload.number;
  }
  destinationPhone = String(destinationPhone || "").trim();

  if (!destinationPhone) {
    Logger.write("Missing phoneNumber in script_custom_data");
    VoxEngine.terminate();
    return;
  }

  var agentPhone = "";
  if (payload && typeof payload.agentPhoneNumber === "string") {
    agentPhone = payload.agentPhoneNumber;
  } else if (payload && typeof payload.agentPhone === "string") {
    agentPhone = payload.agentPhone;
  }
  agentPhone = String(agentPhone || "").trim();

  var callerId = "";
  if (payload && typeof payload.callerId === "string") {
    callerId = payload.callerId.trim();
  } else if (payload && typeof payload.callerid === "string") {
    callerId = payload.callerid.trim();
  }

  function createPstnCall(phone) {
    return callerId ? VoxEngine.callPSTN(phone, callerId) : VoxEngine.callPSTN(phone);
  }

  function failAndTerminate(prefix, e) {
    Logger.write(prefix + ": " + e.code + " " + e.reason);
    VoxEngine.terminate();
  }

  if (!agentPhone) {
    var directCall = createPstnCall(destinationPhone);
    directCall.addEventListener(CallEvents.Failed, function (e) {
      failAndTerminate("Destination call failed", e);
    });
    directCall.addEventListener(CallEvents.Disconnected, function () {
      VoxEngine.terminate();
    });
    return;
  }

  var agentCall = createPstnCall(agentPhone);
  var destinationCall = null;
  var bridged = false;

  agentCall.addEventListener(CallEvents.Failed, function (e) {
    failAndTerminate("Agent call failed", e);
  });

  agentCall.addEventListener(CallEvents.Disconnected, function () {
    if (!bridged && destinationCall) {
      destinationCall.hangup();
    }
    VoxEngine.terminate();
  });

  agentCall.addEventListener(CallEvents.Connected, function () {
    destinationCall = createPstnCall(destinationPhone);

    destinationCall.addEventListener(CallEvents.Failed, function (e) {
      failAndTerminate("Destination call failed", e);
    });

    destinationCall.addEventListener(CallEvents.Connected, function () {
      if (bridged) return;
      bridged = true;
      VoxEngine.easyProcess(agentCall, destinationCall);
    });

    destinationCall.addEventListener(CallEvents.Disconnected, function () {
      if (!bridged) {
        agentCall.hangup();
      }
      VoxEngine.terminate();
    });
  });
});

VoxEngine.addEventListener(AppEvents.CallAlerting, function (event) {
  var incomingCall = event.call;
  var destinationPhone = String((event && event.destination) || "").trim();
  var callerId = "";

  if (!destinationPhone && incomingCall && typeof incomingCall.customData === "function") {
    try {
      var incomingCustomData = incomingCall.customData() || "";
      if (incomingCustomData) {
        var parsedCustomData = JSON.parse(incomingCustomData);
        if (parsedCustomData && typeof parsedCustomData.phoneNumber === "string") {
          destinationPhone = parsedCustomData.phoneNumber.trim();
        } else if (parsedCustomData && typeof parsedCustomData.number === "string") {
          destinationPhone = parsedCustomData.number.trim();
        }
        if (parsedCustomData && typeof parsedCustomData.callerId === "string") {
          callerId = parsedCustomData.callerId.trim();
        } else if (parsedCustomData && typeof parsedCustomData.callerid === "string") {
          callerId = parsedCustomData.callerid.trim();
        }
      }
    } catch (e) {
      // ignore malformed customData
    }
  }

  if (!destinationPhone) {
    Logger.write("Missing destination number for browser call");
    incomingCall.hangup();
    VoxEngine.terminate();
    return;
  }

  function createPstnCall(phone) {
    return callerId ? VoxEngine.callPSTN(phone, callerId) : VoxEngine.callPSTN(phone);
  }

  var pstnCall = createPstnCall(destinationPhone);
  var browserConnected = false;
  var pstnConnected = false;
  var bridged = false;
  var terminating = false;

  function tryBridge() {
    if (!browserConnected || !pstnConnected || bridged) return;
    bridged = true;
    VoxEngine.easyProcess(incomingCall, pstnCall);
  }

  function terminate() {
    if (terminating) return;
    terminating = true;
    VoxEngine.terminate();
  }

  function terminateWith(prefix, e) {
    Logger.write(prefix + ": " + e.code + " " + e.reason);
    if (incomingCall) {
      incomingCall.hangup();
    }
    if (pstnCall) {
      pstnCall.hangup();
    }
    terminate();
  }

  pstnCall.addEventListener(CallEvents.Failed, function (e) {
    terminateWith("Destination call failed", e);
  });

  pstnCall.addEventListener(CallEvents.Connected, function () {
    pstnConnected = true;
    incomingCall.answer();
    tryBridge();
  });

  incomingCall.addEventListener(CallEvents.Connected, function () {
    browserConnected = true;
    tryBridge();
  });

  incomingCall.addEventListener(CallEvents.Failed, function (e) {
    terminateWith("Browser call failed", e);
  });

  incomingCall.addEventListener(CallEvents.Disconnected, function () {
    if (pstnCall) {
      pstnCall.hangup();
    }
    terminate();
  });

  pstnCall.addEventListener(CallEvents.Disconnected, function () {
    if (incomingCall) {
      incomingCall.hangup();
    }
    terminate();
  });
});`;

interface VoximplantApiResponse {
  result?: unknown;
  error?: { code: number; msg: string };
  [key: string]: unknown;
}

type VoxHttpMethod = 'GET' | 'POST';

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a short-lived JWT for Voximplant service account auth.
 * Header: { alg: RS256, typ: JWT, kid: keyId }
 * Payload: { iss: accountId, iat: now, exp: now+300 }
 */
function buildJwt(accountId: string, keyId: string, privateKey: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: keyId })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: Number(accountId), iat: now, exp: now + 300 })).toString('base64url');
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(privateKey, 'base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * Make an authenticated request to Voximplant API using service account JWT.
 */
async function voximplantRequest(
  accountId: string,
  keyId: string,
  privateKey: string,
  method: string,
  params: Record<string, string> = {},
  httpMethod: VoxHttpMethod = 'GET',
): Promise<VoximplantApiResponse> {
  const token = buildJwt(accountId, keyId, privateKey);

  const url = new URL(`${VOXIMPLANT_API}/${method}`);
  let body: string | undefined;

  if (httpMethod === 'GET') {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  } else {
    body = new URLSearchParams(params).toString();
  }

  const res = await fetch(url.toString(), {
    method: httpMethod,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  const data = (await res.json()) as VoximplantApiResponse;

  if (data.error) {
    throw new Error(data.error.msg ?? `Voximplant API error: ${method}`);
  }

  return data;
}

/**
 * Validate Voximplant service account credentials by calling GetAccountInfo.
 */
export async function validateCredentials(accountId: string, keyId: string, privateKey: string): Promise<void> {
  await voximplantRequest(accountId, keyId, privateKey, 'GetAccountInfo');
}

/**
 * Connect a new Voximplant account: validate credentials, store, configure webhook.
 */
export async function connectAccount(
  accountId: string,
  keyId: string,
  privateKey: string,
  callbackRuleId?: number | null,
  agentPhoneNumber?: string | null,
  callerId?: string | null,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  // Validate credentials
  await validateCredentials(accountId, keyId, privateKey);

  // Check for duplicate
  const existing = store.findOne('voximplantAccounts', (r) => r.accountId === accountId);
  if (existing) {
    throw new Error('This Voximplant account is already connected');
  }

  let autoResources: { applicationId: number; scenarioId: number; ruleId: number };
  try {
    autoResources = await ensureAutoCallbackResources(accountId, keyId, privateKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Failed to auto-provision Voximplant callback flow: ${message}`);
  }

  const resolvedCallbackRuleId = toPositiveInt(callbackRuleId) ?? autoResources.ruleId;

  try {
    await ensureAutoWebUser(accountId, keyId, privateKey, autoResources.applicationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Failed to auto-provision Voximplant Web SDK user: ${message}`);
  }

  const resolvedCallerId = await resolveCallerId(accountId, keyId, privateKey, callerId);

  // Get account name
  let accountName: string | null = null;
  try {
    const info = await voximplantRequest(accountId, keyId, privateKey, 'GetAccountInfo');
    accountName = getAccountNameFromInfo(info) || null;
  } catch {
    // non-critical
  }

  // Configure webhook if base URL is set
  let webhookConfigured = false;
  if (env.VOXIMPLANT_WEBHOOK_BASE_URL) {
    try {
      const webhookUrl = `${env.VOXIMPLANT_WEBHOOK_BASE_URL}/api/voximplant/webhook`;
      await voximplantRequest(accountId, keyId, privateKey, 'SetAccountCallback', {
        callback_url: webhookUrl,
      });
      webhookConfigured = true;
    } catch {
      // Store account anyway, webhook can be retried
    }
  }

  const account = store.insert('voximplantAccounts', {
    accountId,
    keyId,
    privateKey,
    callbackRuleId: resolvedCallbackRuleId,
    agentPhoneNumber: agentPhoneNumber ? agentPhoneNumber.trim() : null,
    callerId: resolvedCallerId,
    accountName,
    webhookConfigured,
    status: 'active',
    statusMessage: webhookConfigured ? null : 'Webhook not configured',
    createdById: audit?.userId ?? null,
  });

  if (audit?.userId) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'voximplant_account',
      entityId: account.id as string,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return sanitizeAccount(account);
}

/**
 * Disconnect (delete) a Voximplant account.
 */
export async function disconnectAccount(
  idOrAccountId: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
): Promise<boolean> {
  const existing = resolveAccount(idOrAccountId);
  if (!existing) return false;

  const id = existing.id as string;
  const deleted = store.delete('voximplantAccounts', id);
  if (!deleted) return false;

  if (audit?.userId) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'voximplant_account',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return true;
}

/**
 * List all Voximplant accounts (sanitized).
 */
export function listAccounts() {
  const accounts = store.getAll('voximplantAccounts');
  return accounts.map(sanitizeAccount);
}

/**
 * Resolve by either internal record ID or Vox accountId.
 */
function resolveAccount(idOrAccountId: string) {
  const byId = store.getById('voximplantAccounts', idOrAccountId);
  if (byId) return byId;
  return store.findOne('voximplantAccounts', (r) => r.accountId === idOrAccountId);
}

/**
 * Get a single Voximplant account by ID (sanitized).
 */
export function getAccountById(idOrAccountId: string) {
  const account = resolveAccount(idOrAccountId);
  if (!account) return null;
  return sanitizeAccount(account);
}

/**
 * Get raw account by ID (with secrets — internal use only).
 */
export function getRawAccountById(idOrAccountId: string) {
  return resolveAccount(idOrAccountId);
}

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(n)) return null;
  const asInt = Math.trunc(n);
  return asInt > 0 ? asInt : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
}

function normalizeName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeCallerIdValue(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  // Keep only characters that may appear in human-entered phone numbers.
  const compact = raw.replace(/[()\-\s]/g, '');
  const normalized = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  if (/^\+[1-9]\d{5,14}$/.test(normalized)) return normalized;
  if (/^[1-9]\d{5,14}$/.test(normalized)) return `+${normalized}`;
  return null;
}

function getCallerIdSetupErrorDetails(extraMessage?: string): string {
  const parts = [
    'No valid outbound Caller ID found in this Voximplant account.',
    'Add at least one purchased number or verified Caller ID in the Voximplant control panel, then retry.',
    `Buy/add phone number: ${CALLER_ID_SETUP_LINKS.phoneNumbers}`,
    `Add/verify Caller ID: ${CALLER_ID_SETUP_LINKS.callerIds}`,
    `PSTN caller ID requirements: ${CALLER_ID_SETUP_LINKS.pstnCallerIdRules}`,
  ];
  if (extraMessage) {
    parts.push(`Details: ${extraMessage}`);
  }
  return parts.join(' ');
}

function extractCallerIdCandidates(result: unknown, keys: string[]): string[] {
  const records = asRecordArray(result);
  const candidates: string[] = [];

  for (const record of records) {
    for (const key of keys) {
      const candidate = normalizeCallerIdValue(record[key]);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

async function autoPickCallerId(
  accountId: string,
  keyId: string,
  privateKey: string,
): Promise<string> {
  const candidates: string[] = [];
  const sourceErrors: string[] = [];

  try {
    const numbers = await voximplantRequest(accountId, keyId, privateKey, 'GetPhoneNumbers', {
      count: '1000',
      offset: '0',
    });
    candidates.push(
      ...extractCallerIdCandidates(numbers.result, ['phone_number', 'phoneNumber', 'number', 'phone', 'did_number']),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'GetPhoneNumbers failed';
    sourceErrors.push(`GetPhoneNumbers: ${message}`);
  }

  try {
    const callerIds = await voximplantRequest(accountId, keyId, privateKey, 'GetCallerIDs', {
      active: 'true',
      count: '1000',
      offset: '0',
    });
    candidates.push(
      ...extractCallerIdCandidates(callerIds.result, [
        'callerid_number',
        'caller_number',
        'phone_number',
        'phoneNumber',
        'number',
      ]),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'GetCallerIDs failed';
    sourceErrors.push(`GetCallerIDs: ${message}`);
  }

  const uniqueCandidates = [...new Set(candidates)];
  if (uniqueCandidates.length > 0) {
    return uniqueCandidates[0];
  }

  const detail = sourceErrors.length === 2 ? sourceErrors.join('; ') : undefined;
  throw new Error(getCallerIdSetupErrorDetails(detail));
}

async function resolveCallerId(
  accountId: string,
  keyId: string,
  privateKey: string,
  callerId?: string | null,
): Promise<string> {
  const providedRaw = typeof callerId === 'string' ? callerId.trim() : '';
  if (providedRaw) {
    const normalizedProvided = normalizeCallerIdValue(providedRaw);
    if (!normalizedProvided) {
      throw new Error('Caller ID must be a valid E.164 number, for example +15551230000');
    }
    return normalizedProvided;
  }

  return autoPickCallerId(accountId, keyId, privateKey);
}

function getShortApplicationName(value: unknown): string {
  const normalized = normalizeName(value);
  if (!normalized) return '';
  const dotIndex = normalized.indexOf('.');
  return dotIndex === -1 ? normalized : normalized.slice(0, dotIndex);
}

function extractPositiveIntField(data: VoximplantApiResponse, key: string): number | null {
  const direct = toPositiveInt(data[key]);
  if (direct) return direct;

  const result = data.result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return toPositiveInt((result as Record<string, unknown>)[key]);
  }

  if (Array.isArray(result) && result.length > 0 && result[0] && typeof result[0] === 'object') {
    return toPositiveInt((result[0] as Record<string, unknown>)[key]);
  }

  return null;
}

function getAccountNameFromInfo(data: VoximplantApiResponse): string {
  const result = data.result as Record<string, unknown> | undefined;
  const accountNameRaw = (result?.account_name as string) || '';
  return accountNameRaw.replace(/\.voximplant\.com$/i, '').trim();
}

function generateAutoWebPassword(): string {
  return `Aa1!${crypto.randomBytes(18).toString('base64url')}`;
}

async function ensureAutoWebUser(
  accountId: string,
  keyId: string,
  privateKey: string,
  applicationId: number,
): Promise<{ userName: string; password: string }> {
  const password = generateAutoWebPassword();

  const users = await voximplantRequest(accountId, keyId, privateKey, 'GetUsers', {
    application_id: String(applicationId),
    user_name: AUTO_WEB_USER_NAME,
    count: '100',
  });
  const userList = asRecordArray(users.result);
  const existingUser = userList.find((user) => normalizeName(user.user_name) === AUTO_WEB_USER_NAME);
  const existingUserId = toPositiveInt(existingUser?.user_id);

  if (existingUserId) {
    await voximplantRequest(
      accountId,
      keyId,
      privateKey,
      'SetUserInfo',
      {
        user_id: String(existingUserId),
        user_password: password,
        user_active: 'true',
      },
      'POST',
    );
    return { userName: AUTO_WEB_USER_NAME, password };
  }

  const createdUser = await voximplantRequest(
    accountId,
    keyId,
    privateKey,
    'AddUser',
    {
      application_id: String(applicationId),
      user_name: AUTO_WEB_USER_NAME,
      user_display_name: AUTO_WEB_USER_DISPLAY_NAME,
      user_password: password,
      user_active: 'true',
    },
    'POST',
  );
  const createdUserId = extractPositiveIntField(createdUser, 'user_id');
  if (!createdUserId) {
    throw new Error('Failed to create Voximplant Web SDK user');
  }

  return { userName: AUTO_WEB_USER_NAME, password };
}

async function ensureAutoCallbackApplicationId(
  accountId: string,
  keyId: string,
  privateKey: string,
): Promise<number> {
  const apps = await voximplantRequest(accountId, keyId, privateKey, 'GetApplications', {
    application_name: AUTO_CALLBACK_APPLICATION_NAME,
    count: '100',
  });
  const appList = asRecordArray(apps.result);

  const existingApp = appList.find(
    (app) => getShortApplicationName(app.application_name) === AUTO_CALLBACK_APPLICATION_NAME,
  );
  const existingAppId = toPositiveInt(existingApp?.application_id);
  if (existingAppId) return existingAppId;

  const createdApp = await voximplantRequest(accountId, keyId, privateKey, 'AddApplication', {
    application_name: AUTO_CALLBACK_APPLICATION_NAME,
  });
  const createdAppId = extractPositiveIntField(createdApp, 'application_id');
  if (!createdAppId) {
    throw new Error('Failed to create Voximplant application for callback mode');
  }

  return createdAppId;
}

async function ensureAutoCallbackScenarioId(
  accountId: string,
  keyId: string,
  privateKey: string,
  applicationId: number,
): Promise<number> {
  const scenarios = await voximplantRequest(accountId, keyId, privateKey, 'GetScenarios', {
    application_id: String(applicationId),
    scenario_name: AUTO_CALLBACK_SCENARIO_NAME,
    count: '100',
  });
  const scenarioList = asRecordArray(scenarios.result);

  const existingScenario = scenarioList.find(
    (scenario) => normalizeName(scenario.scenario_name) === AUTO_CALLBACK_SCENARIO_NAME,
  );
  const existingScenarioId = toPositiveInt(existingScenario?.scenario_id);
  if (existingScenarioId) {
    await voximplantRequest(
      accountId,
      keyId,
      privateKey,
      'SetScenarioInfo',
      {
        scenario_id: String(existingScenarioId),
        scenario_script: AUTO_CALLBACK_SCENARIO_SCRIPT,
      },
      'POST',
    );
    return existingScenarioId;
  }

  const createdScenario = await voximplantRequest(
    accountId,
    keyId,
    privateKey,
    'AddScenario',
    {
      application_id: String(applicationId),
      scenario_name: AUTO_CALLBACK_SCENARIO_NAME,
      scenario_script: AUTO_CALLBACK_SCENARIO_SCRIPT,
    },
    'POST',
  );
  const createdScenarioId = extractPositiveIntField(createdScenario, 'scenario_id');
  if (!createdScenarioId) {
    throw new Error('Failed to create Voximplant scenario for callback mode');
  }

  return createdScenarioId;
}

async function ensureAutoCallbackRuleId(
  accountId: string,
  keyId: string,
  privateKey: string,
  applicationId: number,
  scenarioId: number,
): Promise<number> {
  const rules = await voximplantRequest(accountId, keyId, privateKey, 'GetRules', {
    application_id: String(applicationId),
    rule_name: AUTO_CALLBACK_RULE_NAME,
    with_scenarios: 'true',
    count: '100',
  });
  const ruleList = asRecordArray(rules.result);

  const existingRule = ruleList.find((rule) => normalizeName(rule.rule_name) === AUTO_CALLBACK_RULE_NAME);
  const existingRuleId = toPositiveInt(existingRule?.rule_id);
  if (existingRuleId) {
    const boundScenarios = asRecordArray(existingRule?.scenarios);
    const hasTargetScenario = boundScenarios.some((scenario) => toPositiveInt(scenario.scenario_id) === scenarioId);
    if (!hasTargetScenario) {
      await voximplantRequest(accountId, keyId, privateKey, 'BindScenario', {
        application_id: String(applicationId),
        rule_id: String(existingRuleId),
        scenario_id: String(scenarioId),
      });
    }
    return existingRuleId;
  }

  const createdRule = await voximplantRequest(accountId, keyId, privateKey, 'AddRule', {
    application_id: String(applicationId),
    rule_name: AUTO_CALLBACK_RULE_NAME,
    rule_pattern: AUTO_CALLBACK_RULE_PATTERN,
    scenario_id: String(scenarioId),
  });
  const createdRuleId = extractPositiveIntField(createdRule, 'rule_id');
  if (!createdRuleId) {
    throw new Error('Failed to create Voximplant rule for callback mode');
  }

  return createdRuleId;
}

async function ensureAutoCallbackResources(
  accountId: string,
  keyId: string,
  privateKey: string,
): Promise<{ applicationId: number; scenarioId: number; ruleId: number }> {
  const applicationId = await ensureAutoCallbackApplicationId(accountId, keyId, privateKey);
  const scenarioId = await ensureAutoCallbackScenarioId(accountId, keyId, privateKey, applicationId);
  const ruleId = await ensureAutoCallbackRuleId(accountId, keyId, privateKey, applicationId, scenarioId);
  return { applicationId, scenarioId, ruleId };
}

function extractCallSessionHistoryId(data: VoximplantApiResponse): string {
  const direct = data.call_session_history_id;
  if (typeof direct === 'string' && direct) return direct;
  if (typeof direct === 'number') return String(direct);

  const result = data.result;
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    const fromResult = record.call_session_history_id;
    if (typeof fromResult === 'string' && fromResult) return fromResult;
    if (typeof fromResult === 'number') return String(fromResult);
  }

  if (Array.isArray(result) && result.length > 0) {
    const first = result[0];
    if (first && typeof first === 'object') {
      const record = first as Record<string, unknown>;
      const fromArray = record.call_session_history_id;
      if (typeof fromArray === 'string' && fromArray) return fromArray;
      if (typeof fromArray === 'number') return String(fromArray);
    }
  }

  return '';
}

/**
 * Initiate outbound callback call via Voximplant StartScenarios.
 * Requires a rule with a scenario that reads script_custom_data.phoneNumber.
 */
export async function initiateCallback(
  accountId: string,
  keyId: string,
  privateKey: string,
  phoneNumber: string,
  callbackRuleId?: number | null,
  agentPhoneNumber?: string | null,
  callerId?: string | null,
): Promise<{ callSessionHistoryId: string; ruleId: number; callerId: string }> {
  const preferredRuleId = toPositiveInt(callbackRuleId);
  let ruleId = preferredRuleId;
  if (!ruleId) {
    const autoResources = await ensureAutoCallbackResources(accountId, keyId, privateKey);
    ruleId = autoResources.ruleId;
  }
  const normalizedAgentPhone =
    typeof agentPhoneNumber === 'string' && agentPhoneNumber.trim() ? agentPhoneNumber.trim() : null;
  const normalizedCallerId = await resolveCallerId(accountId, keyId, privateKey, callerId);

  const data = await voximplantRequest(
    accountId,
    keyId,
    privateKey,
    'StartScenarios',
    {
      rule_id: String(ruleId),
      script_custom_data: JSON.stringify({
        phoneNumber,
        agentPhoneNumber: normalizedAgentPhone,
        callerId: normalizedCallerId,
      }),
    },
    'POST',
  );

  return {
    callSessionHistoryId: extractCallSessionHistoryId(data),
    ruleId,
    callerId: normalizedCallerId,
  };
}

/**
 * Mask sensitive fields for API responses.
 */
function sanitizeAccount(account: Record<string, unknown>) {
  const keyId = account.keyId as string;
  const agentPhoneNumberRaw = account.agentPhoneNumber;
  const agentPhoneNumber =
    typeof agentPhoneNumberRaw === 'string' && agentPhoneNumberRaw.trim() ? agentPhoneNumberRaw.trim() : null;
  const callerIdRaw = account.callerId;
  const callerId = typeof callerIdRaw === 'string' && callerIdRaw.trim() ? callerIdRaw.trim() : null;
  return {
    ...account,
    keyId: keyId ? keyId.slice(0, 8) + '***' : '',
    privateKey: '***',
    agentPhoneNumber,
    callerId,
  };
}

/**
 * Fetch call recording URL via GetCallHistory.
 */
export async function getCallRecordingUrl(
  accountId: string,
  keyId: string,
  privateKey: string,
  callSessionHistoryId: string,
): Promise<string | null> {
  try {
    const data = await voximplantRequest(accountId, keyId, privateKey, 'GetCallHistory', {
      call_session_history_id: callSessionHistoryId,
      with_records: 'true',
    });
    const result = data.result as Record<string, unknown>[] | undefined;
    if (result && result.length > 0) {
      const records = result[0].records as { record_url?: string }[] | undefined;
      if (records && records.length > 0) {
        return records[0].record_url || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get login credentials for Voximplant Web SDK.
 * Returns the full login string: user@app.account.voximplant.com
 */
export async function getLoginCredentials(
  accountId: string,
  keyId: string,
  privateKey: string,
  callerId?: string | null,
): Promise<{ loginUrl: string; password: string; userName: string; accountName: string; callerId: string }> {
  const autoResources = await ensureAutoCallbackResources(accountId, keyId, privateKey);
  const webUser = await ensureAutoWebUser(accountId, keyId, privateKey, autoResources.applicationId);
  const resolvedCallerId = await resolveCallerId(accountId, keyId, privateKey, callerId);

  const info = await voximplantRequest(accountId, keyId, privateKey, 'GetAccountInfo');
  const accountName = getAccountNameFromInfo(info);
  if (!accountName) {
    throw new Error('Failed to resolve Voximplant account name for Web SDK login');
  }

  const loginUrl = `${webUser.userName}@${AUTO_CALLBACK_APPLICATION_NAME}.${accountName}.voximplant.com`;
  return {
    loginUrl,
    password: webUser.password,
    userName: webUser.userName,
    accountName,
    callerId: resolvedCallerId,
  };
}
