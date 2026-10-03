// Server-only configuration. Nothing here is exposed to the browser: none of
// these variables carry the NEXT_PUBLIC_ prefix.

function env(name: string): string {
  const raw = (process.env[name] ?? "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

export type PoolType = "citizen" | "employee" | "admin";

const apiUrl = env("CLEAN_AM_API_URL").replace(/\/+$/, "");
const defaultUserPoolId = env("COGNITO_USER_POOL_ID");
const citizenUserPoolId = env("COGNITO_CITIZEN_USER_POOL_ID") || defaultUserPoolId;
const employeeUserPoolId = env("COGNITO_EMPLOYEE_USER_POOL_ID");
const adminUserPoolId = env("COGNITO_ADMIN_USER_POOL_ID");

function regionFor(id: string): string {
  return (/^([a-z]{2}(?:-[a-z]+)+-\d)_/.exec(id)?.[1] ?? env("COGNITO_REGION")) || "eu-west-1";
}

export const config = {
  apiUrl,
  cognito: {
    region: regionFor(citizenUserPoolId),
    userPoolId: citizenUserPoolId,
    clientId: env("COGNITO_CITIZEN_CLIENT_ID") || env("COGNITO_CLIENT_ID"),
    clientSecret: env("COGNITO_CITIZEN_CLIENT_SECRET") || env("COGNITO_CLIENT_SECRET"),
    clientSecretArn: env("COGNITO_CITIZEN_CLIENT_SECRET_ARN") || env("COGNITO_CLIENT_SECRET_ARN"),
    domain: env("COGNITO_DOMAIN").replace(/\/+$/, ""),
  },
  employeePool: {
    region: regionFor(employeeUserPoolId || citizenUserPoolId),
    userPoolId: employeeUserPoolId,
    clientId: env("COGNITO_EMPLOYEE_CLIENT_ID"),
    clientSecret: env("COGNITO_EMPLOYEE_CLIENT_SECRET"),
    clientSecretArn: env("COGNITO_EMPLOYEE_CLIENT_SECRET_ARN"),
  },
  adminPool: {
    region: regionFor(adminUserPoolId || citizenUserPoolId),
    userPoolId: adminUserPoolId,
    clientId: env("COGNITO_ADMIN_CLIENT_ID"),
    clientSecret: env("COGNITO_ADMIN_CLIENT_SECRET"),
    clientSecretArn: env("COGNITO_ADMIN_CLIENT_SECRET_ARN"),
  },
  /** Set only when Google is configured on the user pool (backend -c googleClientId=...). */
  googleSignIn: env("GOOGLE_SIGN_IN").toLowerCase() === "true",
  secureCookies: process.env.NODE_ENV === "production",
};

export function poolConfig(pool: PoolType = "citizen") {
  if (pool === "employee") return config.employeePool;
  if (pool === "admin") return config.adminPool;
  return config.cognito;
}

export function assertConfig(): void {
  const missing = [
    ["CLEAN_AM_API_URL", config.apiUrl],
    ["COGNITO_USER_POOL_ID", config.cognito.userPoolId],
    ["COGNITO_CLIENT_ID", config.cognito.clientId],
    ["COGNITO_CLIENT_SECRET_ARN (or COGNITO_CLIENT_SECRET)", config.cognito.clientSecretArn || config.cognito.clientSecret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`CLEAN-AM is not configured. Missing: ${missing.join(", ")}. See .env.example.`);
  }
}

// ---------------------------------------------------------------------------
// The Cognito app client secret
// ---------------------------------------------------------------------------
const secretPromises = new Map<PoolType, Promise<string>>();
let warned = false;

export function clientSecret(pool: PoolType = "citizen"): Promise<string> {
  const current = poolConfig(pool);
  const { clientSecret: plain, clientSecretArn: arn } = current;
  if (!arn) {
    if (plain && /[\s"']/.test(plain) && !warned) {
      warned = true;
      console.error(`[config] Client secret for ${pool} contains spaces or quotes. Paste only the secret itself.`);
    }
    if (plain) return Promise.resolve(plain);
    // If employee/admin pool is not individually configured, fall back to main citizen secret
    if (pool !== "citizen" && (config.cognito.clientSecret || config.cognito.clientSecretArn)) {
      return clientSecret("citizen");
    }
  } else if (plain && !warned) {
    warned = true;
    console.warn(`[config] Client secret for ${pool} is ignored because clientSecretArn is set.`);
  }

  let promise = secretPromises.get(pool);
  if (!promise) {
    promise = loadClientSecret(arn, current.region, pool).catch((error) => {
      secretPromises.delete(pool);
      // Fallback for staff if pool secret missing:
      if (pool !== "citizen" && config.cognito.clientSecretArn) {
        return clientSecret("citizen");
      }
      console.error(`[config] Could not read ${pool} client secret from Secrets Manager (${String(error?.name ?? error)}).`);
      throw error;
    });
    secretPromises.set(pool, promise);
  }
  return promise;
}

async function loadClientSecret(arn: string | undefined, defaultRegion: string, pool: PoolType): Promise<string> {
  if (!arn) {
    if (pool !== "citizen" && config.cognito.clientSecretArn) {
      return clientSecret("citizen");
    }
    throw new Error(`Client secret ARN for ${pool} is not set. See .env.example.`);
  }
  const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
  const region = arn.split(":")[3] || defaultRegion;
  const result = await new SecretsManagerClient({ region }).send(new GetSecretValueCommand({ SecretId: arn }));
  const value = (result.SecretString ?? "").trim();
  if (!value) throw new Error(`The Cognito client secret in Secrets Manager for ${pool} is empty.`);
  return value;
}
