const USERS = JSON.parse(process.env.USERS);
if (!USERS || typeof USERS !== 'object' || Array.isArray(USERS)) {
    throw new Error('Env variable USERS is missing or invalid');
}

const TOKENS = new Set(
    Object.entries(USERS).map(([user, pass]) => {
        if (!user || user.includes(':') || hasCtrlChars(user)) {
            throw new Error('Env variable USERS is invalid');
        }
        if (!pass || typeof pass !== 'string' || hasCtrlChars(pass)) {
            throw new Error('Env variable USERS is invalid');
        }
        return Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
    })
);

function hasCtrlChars(s) {
    return /[\x00-\x1F\x7F]/.test(s);
}

export function hasValidCredentials(event) {
    const header = event.headers?.authorization ?? event.headers?.Authorization;
    const prefixMatch = typeof header === 'string' ? /^Basic +/i.exec(header) : null;
    return prefixMatch !== null && TOKENS.has(header.slice(prefixMatch[0].length));
}
