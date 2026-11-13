// Explicit per-process boundaries. Never pass the whole Worker or operator env.
const API_KEYS = [
  'DATABASE_URL', 'DATABASE_MAX_CONNECTIONS', 'AUTH_ISSUER', 'AUTH_USERINFO_URL',
  'CATALOG_MEDIA_ORIGIN', 'CATALOG_MEDIA_TENANT', 'CATALOG_MEDIA_TOKEN',
  'DANFE_CA_BUNDLE_FILE', 'DANFE_MCP_TOKEN', 'DANFE_MCP_TOOL_PREFIX', 'DANFE_MCP_URL',
  'DOCUSEAL_API_TOKEN', 'DOCUSEAL_EMAIL_READY', 'DOCUSEAL_TENANT_TEMPLATES',
  'DOCUSEAL_URL', 'DOCUSEAL_WEBHOOK_SECRET', 'ERP_AUTH_CLIENT_ID', 'ERP_AUTH_CLIENT_SECRET',
  'ERP_BACKGROUND_WORKERS_ENABLED', 'ERP_CERT_KEY', 'ERP_CNPJ_WS_ENABLED',
  'ERP_CTE_AUTOMATION_SUBJECT', 'ERP_CTE_AUTOMATION_TENANT_ID',
  'ERP_FISCAL_AUTOMATION_SUBJECT', 'ERP_FISCAL_AUTOMATION_TENANT_ID',
  'ERP_FISCAL_ENGINE_TOKEN', 'ERP_FISCAL_ENGINE_URL', 'ERP_MCP_ALLOWED_ORIGINS',
  'ERP_MCP_ORIGIN', 'ERP_MP_ACCESS_TOKEN', 'ERP_MP_RETURN_URL', 'ERP_WEB_ORIGIN',
  'FISCAL_A1_CA_BUNDLE_FILE', 'FISCAL_A1_KEYRING', 'LANGFUSE_TRACING_ENVIRONMENT',
  'NFE_PRODUCTION_ENABLED', 'NFE_PRODUCTION_TENANT_ID', 'SEFAZ_MONITOR_ENABLED',
  'SMTP_FROM', 'SMTP_HOST', 'SMTP_PASSWORD', 'SMTP_PORT', 'SMTP_SECURITY', 'SMTP_USERNAME',
];
const WEB_KEYS = ['AUTH_ISSUER', 'ERP_WEB_ORIGIN', 'ERP_AUTH_CLIENT_ID',
  'ERP_AUTH_CLIENT_SECRET', 'ERP_SESSION_SECRET', 'ERP_DEFAULT_TENANT_ID', 'ERP_FISCAL_API_URL'];
const SYSTEM_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'SSL_CERT_FILE', 'SSL_CERT_DIR'];

function select(env, keys) {
  return Object.fromEntries(keys.filter(key => typeof env[key] === 'string' && env[key] !== '')
    .map(key => [key, env[key]]));
}

export function childEnvironments(env) {
  const common = select(env, SYSTEM_KEYS);
  return {
    api: { ...common, ...select(env, API_KEYS), API_BIND_ADDRESS: '127.0.0.1:8080',
      DATABASE_MAX_CONNECTIONS: env.DATABASE_MAX_CONNECTIONS || '5',
      ERP_BACKGROUND_WORKERS_ENABLED: env.ERP_BACKGROUND_WORKERS_ENABLED || 'false' },
    web: { ...common, ...select(env, WEB_KEYS), NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1', HOSTNAME: '0.0.0.0', PORT: '3000',
      ERP_API_URL: 'http://127.0.0.1:8080' },
  };
}

function origin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash) throw Error('Invalid origin');
  return url.origin;
}

export function runtimeConfiguration(env) {
  try {
    if (env.RUNTIME_MODE !== 'application' || !/^[a-f0-9]{40}$/.test(env.ERP_SOURCE_SHA || '')
      || env.ERP_ACTIVATION_SOURCE_SHA !== env.ERP_SOURCE_SHA
      || env.ERP_RECOVERY_VERIFIED !== 'true' || env.ERP_AUTH_VERIFIED !== 'true'
      || !/^[a-z0-9]{20}$/.test(env.SUPABASE_PROJECT_REF || '')
      || typeof env.ERP_SESSION_SECRET !== 'string' || new TextEncoder().encode(env.ERP_SESSION_SECRET).length < 32
      || !env.ERP_AUTH_CLIENT_ID || !env.ERP_AUTH_CLIENT_SECRET) return null;
    origin(env.AUTH_ISSUER);
    origin(env.ERP_WEB_ORIGIN);
    const userinfo = new URL(env.AUTH_USERINFO_URL || `${env.AUTH_ISSUER}/oauth/userinfo`);
    if (userinfo.origin !== origin(env.AUTH_ISSUER) || userinfo.username || userinfo.password || userinfo.hash) return null;
    const database = new URL(env.DATABASE_URL);
    const username = decodeURIComponent(database.username);
    const reference = env.SUPABASE_PROJECT_REF;
    const direct = database.hostname === `db.${reference}.supabase.co`;
    const session = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(database.hostname)
      && username.endsWith(`.${reference}`);
    const parameters = [...database.searchParams.keys()];
    if (!['postgres:', 'postgresql:'].includes(database.protocol) || !(direct || session)
      || database.port !== '5432' || !database.password || database.pathname.length < 2
      || database.pathname.slice(1).includes('/') || database.hash
      || !username || ['postgres', 'supabase_admin'].includes(username.split('.')[0])
      || parameters.length !== new Set(parameters).size
      || parameters.some(key => !['sslmode', 'sslrootcert', 'application_name'].includes(key))
      || database.searchParams.get('sslmode') !== 'verify-full') return null;
    const connections = env.DATABASE_MAX_CONNECTIONS || '5';
    if (!/^\d+$/.test(connections) || Number(connections) < 1 || Number(connections) > 10
      || !['true', 'false'].includes(env.ERP_BACKGROUND_WORKERS_ENABLED || 'false')) return null;
    const processes = childEnvironments(env);
    return { sourceSha: env.ERP_SOURCE_SHA, processes,
      containerEnvironment: { ...processes.api, ...processes.web } };
  } catch {
    return null;
  }
}
