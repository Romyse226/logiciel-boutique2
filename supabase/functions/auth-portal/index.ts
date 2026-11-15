import { createClient, type Session, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

type JsonRecord = Record<string, unknown>;

function getSupabaseKey(legacyName: string, keySetName: string): string {
  const legacyKey = Deno.env.get(legacyName)?.trim();
  if (legacyKey) return legacyKey;

  const keySet = Deno.env.get(keySetName);
  if (!keySet) return '';
  try {
    const parsed = JSON.parse(keySet) as Record<string, unknown>;
    return typeof parsed.default === 'string' ? parsed.default : '';
  } catch {
    return '';
  }
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = getSupabaseKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
const serviceRoleKey = getSupabaseKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
const productionHost = 'logicielboutique.vercel.app';
const baseDomain = (Deno.env.get('BASE_DOMAIN') ?? productionHost).toLowerCase().replace(/^\.+|\.+$/g, '');
const rateLimitSecret = Deno.env.get('PIN_RATE_LIMIT_SECRET') ?? '';
const pathRouting = Deno.env.get('TENANT_ROUTING_MODE') === 'path'
  || (!Deno.env.get('TENANT_ROUTING_MODE') && baseDomain.endsWith('.vercel.app'));

let admin: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1';
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === productionHost) return true;
  if (baseDomain && (host === baseDomain || (!pathRouting && host.endsWith(`.${baseDomain}`)))) return true;
  return baseDomain === 'localhost' && isLocalHost(host);
}

function getAdminClient(): SupabaseClient {
  if (!admin) throw new Error('Authentication service is not initialized');
  return admin;
}

function getPublicClient(): SupabaseClient {
  if (!publicClient) throw new Error('Authentication service is not initialized');
  return publicClient;
}

function hostForOrigin(origin: string): string {
  return new URL(origin).hostname.toLowerCase();
}

function isRootHost(host: string): boolean {
  if (baseDomain) return host === baseDomain;
  return host === 'localhost' || host === '127.0.0.1';
}

function storeSlugForHost(host: string): string | null {
  if (isRootHost(host) || host === `www.${baseDomain}`) return null;
  if (baseDomain && host.endsWith(`.${baseDomain}`)) {
    const slug = host.slice(0, -(baseDomain.length + 1));
    return slug && !slug.includes('.') ? slug : null;
  }
  if (!baseDomain && host.endsWith('.localhost')) {
    return host.slice(0, -'.localhost'.length) || null;
  }
  return null;
}

function response(
  status: number,
  body: JsonRecord,
  origin: string,
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    },
  });
}

function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D+/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('225')) digits = digits.slice(3);
  if (digits.length !== 10) return null;
  return `225${digits}`;
}

function randomHex(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(value: string): Promise<string> {
  if (!rateLimitSecret) throw new Error('PIN_RATE_LIMIT_SECRET is not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(rateLimitSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function enforceRateLimit(request: Request, scope: string): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim();
  if (!ip) return false;

  const keyHash = await hmacHex(`${scope}:${ip}`);
  const { data, error } = await getAdminClient().rpc('consume_auth_ip_limit', { p_key_hash: keyHash });
  if (error) throw new Error('Rate limit could not be checked');
  return data === true;
}

function accountEmail(employeeId: string): string {
  return `employee-${employeeId}@accounts.invalid`;
}

async function findAuthUserId(email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await getAdminClient().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('Auth account lookup failed');
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user.id;
    if (data.users.length < 1000) return null;
  }
  throw new Error('Auth account lookup exceeded its safe limit');
}

async function ensureAuthUser(employeeId: string, linkedUserId: string | null): Promise<string> {
  if (linkedUserId) return linkedUserId;

  const email = accountEmail(employeeId);
  let userId: string | null = null;
  const { data, error } = await getAdminClient().auth.admin.createUser({
    email,
    password: randomHex(32),
    email_confirm: true,
  });

  if (!error) {
    userId = data.user.id;
  } else {
    userId = await findAuthUserId(email);
    if (!userId) throw new Error('Auth account could not be created');
  }

  const { data: linked, error: linkError } = await getAdminClient().rpc('link_employee_auth', {
    p_employee_id: employeeId,
    p_auth_user_id: userId,
  });
  if (linkError || linked !== true) throw new Error('Auth account could not be linked');
  return userId;
}

async function createSession(employeeId: string, linkedUserId: string | null): Promise<Session> {
  const userId = await ensureAuthUser(employeeId, linkedUserId);
  const email = accountEmail(employeeId);
  const { data, error } = await getAdminClient().auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) throw new Error('Supabase Auth session could not be created');

  const { data: verified, error: verifyError } = await getPublicClient().auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  if (verifyError || !verified.session || verified.user?.id !== userId) {
    throw new Error('Supabase Auth session could not be verified');
  }
  return verified.session;
}

async function findOwner(slug: string, phone: string): Promise<{
  id: string;
  auth_user_id: string | null;
  status: string;
}> {
  const { data: store, error: storeError } = await getAdminClient()
    .from('stores')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (storeError || !store) throw new Error('Compte introuvable');

  const { data: employee, error } = await getAdminClient()
    .from('employees')
    .select('id, auth_user_id, status, phone')
    .eq('store_id', store.id)
    .eq('is_owner', true)
    .maybeSingle();
  if (error || !employee || normalizePhone(employee.phone ?? '') !== phone) {
    throw new Error('Compte introuvable');
  }
  return employee;
}

function ok(data: JsonRecord): JsonRecord {
  return { ok: true, ...data };
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) return new Response('Origin not allowed', { status: 403 });
  if (request.method === 'OPTIONS') return response(204, {}, origin!);
  if (request.method !== 'POST') return response(405, { ok: false, error: 'Method not allowed' }, origin!);
  try {
    const missingConfiguration = [
      !supabaseUrl && 'SUPABASE_URL',
      !anonKey && 'SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEYS',
      !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS',
      !rateLimitSecret && 'PIN_RATE_LIMIT_SECRET',
    ].filter((name): name is string => Boolean(name));
    if (missingConfiguration.length > 0) {
      return response(503, {
        ok: false,
        error: `Authentication service is missing configuration: ${missingConfiguration.join(', ')}.`,
      }, origin!);
    }

    admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    publicClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await request.json() as JsonRecord;
    const action = typeof body.action === 'string' ? body.action : '';
    const host = hostForOrigin(origin!);

    if (action === 'signup') {
      if (!isRootHost(host)) return response(403, { ok: false, error: 'Store registration must start at the main domain' }, origin!);
      if (!await enforceRateLimit(request, 'signup')) {
        return response(429, { ok: false, error: 'Too many requests. Try again later.' }, origin!);
      }

      const storeName = typeof body.storeName === 'string' ? body.storeName.trim() : '';
      const ownerName = typeof body.ownerName === 'string' ? body.ownerName.trim() : '';
      const phone = typeof body.phone === 'string' ? normalizePhone(body.phone) : null;
      const storeSlug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
      const pin = typeof body.pin === 'string' ? body.pin : '';
      if (!storeName || !ownerName || !phone || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(storeSlug) || !/^\d{4}$/.test(pin)) {
        const invalidFields = [
          !storeName && 'store name',
          !ownerName && 'owner name',
          !phone && 'valid phone number',
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(storeSlug) && 'store address',
          !/^\d{4}$/.test(pin) && 'four-digit PIN',
        ].filter((field): field is string => Boolean(field));
        return response(400, {
          ok: false,
          error: `Check these fields: ${invalidFields.join(', ')}.`,
        }, origin!);
      }

      const { data, error } = await getAdminClient().rpc('create_store_owner', {
        p_store_name: storeName,
        p_owner_name: ownerName,
        p_phone: phone,
        p_slug: storeSlug,
        p_pin: pin,
      });
      if (error) {
        console.error('create_store_owner RPC failed', { code: error.code, message: error.message });
        const duplicateSlug = error.code === '23505'
          && `${error.message} ${error.details ?? ''}`.includes('stores_slug_unique');
        if (duplicateSlug) {
          return response(409, { ok: false, error: 'This store slug may already be in use. Choose another store name.' }, origin!);
        }
        if (error.code === '42883') {
          return response(500, { ok: false, error: 'The authentication database migration is missing or incomplete. Apply the latest migration.' }, origin!);
        }
        return response(500, { ok: false, error: 'Store creation failed. Check the Supabase function logs.' }, origin!);
      }
      const result = data as { ok?: boolean; employee_id?: string; name?: string; slug?: string; error?: string };
      if (!result?.ok || !result.employee_id || !result.slug) {
        return response(400, { ok: false, error: result?.error ?? 'Store registration could not be completed.' }, origin!);
      }
      const session = await createSession(result.employee_id, null);
      return response(200, ok({
        session,
        employeeId: result.employee_id,
        name: result.name ?? ownerName,
        isOwner: true,
        slug: result.slug,
      }), origin!);
    }

    const requestedSlug = typeof body.tenantSlug === 'string' ? body.tenantSlug.trim().toLowerCase() : '';
    const slug = pathRouting
      ? (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug) ? requestedSlug : null)
      : storeSlugForHost(host);
    if (!slug) {
      const location = pathRouting ? 'its /store/<slug> address' : 'its subdomain';
      return response(400, { ok: false, error: `Open this store using ${location}.` }, origin!);
    }
    if (!await enforceRateLimit(request, `${action}:${slug}`)) {
      return response(429, { ok: false, error: 'Too many requests. Try again later.' }, origin!);
    }

    if (action === 'login') {
      const phone = typeof body.phone === 'string' ? normalizePhone(body.phone) : null;
      const pin = typeof body.pin === 'string' ? body.pin : '';
      if (!phone || !/^\d{4}$/.test(pin)) {
        return response(400, { ok: false, error: 'Enter the phone number and four-digit PIN.' }, origin!);
      }

      const { data, error } = await getAdminClient().rpc('verify_owner_pin', {
        p_slug: slug,
        p_phone: phone,
        p_pin: pin,
      });
      if (error) throw new Error('PIN verification failed');
      const result = data as {
        ok?: boolean;
        employee_id?: string;
        auth_user_id?: string | null;
        name?: string;
      };
      if (!result?.ok || !result.employee_id) {
        return response(401, { ok: false, error: result?.error ?? 'Phone number or PIN is incorrect.' }, origin!);
      }
      const session = await createSession(result.employee_id, result.auth_user_id ?? null);
      return response(200, ok({
        session,
        employeeId: result.employee_id,
        name: result.name ?? 'Gérant',
        isOwner: true,
      }), origin!);
    }

    if (action === 'recovery-verify') {
      const phone = typeof body.phone === 'string' ? normalizePhone(body.phone) : null;
      const code = typeof body.code === 'string' ? body.code : '';
      if (!phone || !/^\d{4}$/.test(code)) {
        return response(400, { ok: false, error: 'Enter the phone number and four-digit code.' }, origin!);
      }

      const owner = await findOwner(slug, phone);
      if (owner.status !== 'active') {
        return response(400, { ok: false, error: 'Recovery is not available for this account.' }, origin!);
      }
      await ensureAuthUser(owner.id, owner.auth_user_id);

      const { data, error } = await getAdminClient().rpc('verify_owner_recovery_code', {
        p_slug: slug,
        p_phone: phone,
        p_code: code,
      });
      if (error) throw new Error('Recovery code verification failed');
      const result = data as { ok?: boolean; recovery_token?: string; error?: string };
      if (!result?.ok || !result.recovery_token) {
        return response(400, { ok: false, error: result?.error ?? 'Code is invalid or expired.' }, origin!);
      }
      return response(200, ok({ recoveryToken: result.recovery_token }), origin!);
    }

    if (action === 'recovery-complete') {
      const phone = typeof body.phone === 'string' ? normalizePhone(body.phone) : null;
      const recoveryToken = typeof body.recoveryToken === 'string' ? body.recoveryToken : '';
      const newPin = typeof body.newPin === 'string' ? body.newPin : '';
      if (!phone || !recoveryToken || !/^\d{4}$/.test(newPin)) {
        return response(400, { ok: false, error: 'The recovery authorization or new PIN is invalid.' }, origin!);
      }

      const { data, error } = await getAdminClient().rpc('complete_owner_pin_recovery', {
        p_slug: slug,
        p_phone: phone,
        p_recovery_token: recoveryToken,
        p_new_pin: newPin,
      });
      if (error) throw new Error('PIN update failed');
      const result = data as {
        ok?: boolean;
        employee_id?: string;
        auth_user_id?: string | null;
        name?: string;
        error?: string;
      };
      if (!result?.ok || !result.employee_id) {
        return response(400, { ok: false, error: result?.error ?? 'PIN could not be changed.' }, origin!);
      }

      await new Promise((resolve) => setTimeout(resolve, 1100));
      const session = await createSession(result.employee_id, result.auth_user_id ?? null);
      return response(200, ok({
        session,
        employeeId: result.employee_id,
        name: result.name ?? 'Gérant',
        isOwner: true,
      }), origin!);
    }

    if (action === 'accept-invite') {
      const token = typeof body.token === 'string' ? body.token : '';
      if (token.length < 32) return response(400, { ok: false, error: 'Invitation invalide.' }, origin!);

      const { data: employee, error: employeeError } = await getAdminClient()
        .from('employees')
        .select('id, store_id, name, auth_user_id, status, is_owner, can_edit_catalog, can_add_products, access_token')
        .eq('access_token', token)
        .maybeSingle();
      if (employeeError || !employee || employee.is_owner) {
        return response(400, { ok: false, error: 'Invitation introuvable ou expirée.' }, origin!);
      }
      if (employee.status === 'suspended') {
        return response(403, { ok: false, error: 'Accès suspendu par le gérant.' }, origin!);
      }

      const { data: store, error: storeError } = await getAdminClient()
        .from('stores')
        .select('slug')
        .eq('id', employee.store_id)
        .maybeSingle();
      if (storeError || !store || store.slug !== slug) {
        return response(403, { ok: false, error: 'Cette invitation appartient à une autre boutique.' }, origin!);
      }

      const session = await createSession(employee.id, employee.auth_user_id);
      const { data: claimed, error: claimError } = await getAdminClient()
        .from('employees')
        .update({
          status: 'active',
          access_token: randomHex(32),
          updated_at: new Date().toISOString(),
        })
        .eq('id', employee.id)
        .eq('access_token', token)
        .select('id')
        .maybeSingle();
      if (claimError || !claimed) {
        await getPublicClient().auth.signOut({ scope: 'local' });
        return response(409, { ok: false, error: 'Invitation déjà utilisée. Demande un nouveau lien au gérant.' }, origin!);
      }

      return response(200, ok({
        session,
        employeeId: employee.id,
        name: employee.name,
        isOwner: false,
        canEditCatalog: employee.can_edit_catalog,
        canAddProducts: employee.can_add_products,
      }), origin!);
    }

    return response(400, { ok: false, error: 'Unknown authentication action.' }, origin!);
  } catch {
    return response(500, { ok: false, error: 'Authentication could not be completed. Try again.' }, origin!);
  }
});
