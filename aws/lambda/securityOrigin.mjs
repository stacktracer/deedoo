const REQUIRED_ORIGIN = process.env.REQUIRED_ORIGIN;
if (!REQUIRED_ORIGIN || typeof REQUIRED_ORIGIN !== 'string') {
    throw new Error('Env var REQUIRED_ORIGIN is missing or invalid');
}

export function hasValidOrigin(event) {
    const method = event.requestContext.http.method;
    if (method === 'GET' || method === 'HEAD') {
        return true;
    } else {
        return (event.headers?.origin === REQUIRED_ORIGIN);
    }
}
