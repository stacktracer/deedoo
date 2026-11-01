import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || typeof SESSION_SECRET !== 'string' || !/^[0-9a-f]{64}$/i.test(SESSION_SECRET)) {
    throw new Error('Env variable SESSION_SECRET is missing or invalid');
}

const USERS = JSON.parse(process.env.USERS);
if (!USERS || typeof USERS !== 'object' || Array.isArray(USERS)) {
    throw new Error('Env variable USERS is missing or invalid');
}
const SIGNING_KEY = createHmac('sha256', Buffer.from(SESSION_SECRET, 'hex')).update(JSON.stringify(USERS)).digest();
function sign(value) {
    return createHmac('sha256', SIGNING_KEY).update(value).digest('hex');
}

const COOKIE_NAME = '__Host-deedoo';
const COOKIE_MAX_AGE = 35 * 86400;

export function createAuthCookie() {
    const expires = Date.now() + COOKIE_MAX_AGE*1000;
    const nonce = randomBytes(16).toString('hex');
    const payload = `${expires}.${nonce}`;
    const token = `${payload}.${sign(payload)}`;
    // SameSite=Strict prevents Android Firefox from sending the cookie when launched from a home-screen
    // shortcut (see https://bugzilla.mozilla.org/show_bug.cgi?id=1573860#c22) so use SameSite=Lax instead
    return `${COOKIE_NAME}=${token}; Max-Age=${COOKIE_MAX_AGE}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function getAuthCookie(event) {
    const headers = event.cookies ?? [event.headers?.cookie ?? event.headers?.Cookie ?? ''];
    for (const header of headers) {
        for (const part of header.split(';')) {
            const cookie = part.trim();
            if (cookie.startsWith(`${COOKIE_NAME}=`)) {
                return cookie.slice(COOKIE_NAME.length + 1);
            }
        }
    }
    return null;
}

export function hasValidAuthCookie(event) {
    const token = getAuthCookie(event);
    if (!token) {
        return false;
    }
    const match = /^(\d+)\.([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(token);
    if (!match) {
        return false;
    }
    const expires = Number(match[1]);
    const now = Date.now();
    if (!Number.isSafeInteger(expires) || expires <= now) {
        return false;
    }
    const payload = `${match[1]}.${match[2]}`;
    const expected = Buffer.from(sign(payload), 'hex');
    const supplied = Buffer.from(match[3], 'hex');
    return timingSafeEqual(expected, supplied);
}
