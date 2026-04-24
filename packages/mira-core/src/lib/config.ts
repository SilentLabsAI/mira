const MIRA_USER_ID_ENV = 'MIRA_USER_ID';

function clean(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

export function requireEnv(name: string): string {
    const value = clean(process.env[name]);
    if (!value) {
        throw new Error(`[MIRA] Missing required environment variable: ${name}`);
    }
    return value;
}

export function requireAnyEnv(names: string[]): string {
    for (const name of names) {
        const value = clean(process.env[name]);
        if (value) return value;
    }

    throw new Error(`[MIRA] Missing required environment variable: ${names.join(' or ')}`);
}

export function resolveMiraUserId(userId?: string): string {
    const resolved = clean(userId) || clean(process.env[MIRA_USER_ID_ENV]);
    if (!resolved) {
        throw new Error(`[MIRA] Missing user id. Pass userId explicitly or set ${MIRA_USER_ID_ENV}.`);
    }
    return resolved;
}
