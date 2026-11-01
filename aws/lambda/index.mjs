import { IoTDataPlaneClient, PublishCommand, GetRetainedMessageCommand } from '@aws-sdk/client-iot-data-plane';
import { createAuthCookie, hasValidAuthCookie } from './securityAuthCookie.mjs';
import { hasValidCredentials } from './securityBasicAuth.mjs';
import { hasValidOrigin } from './securityOrigin.mjs';
import { serveStatic } from './static.mjs';

const iot = new IoTDataPlaneClient({});

async function doHandleReq(event) {
    const path = event.rawPath;
    const method = event.requestContext.http.method;
    if (path.startsWith('/api/')) {
        const match = /^\/api\/([^/]+)\/(.+)$/.exec(path);
        if (!match) {
            return { statusCode: 404 };
        }
        const [, doorName, pathInDoor] = match;
        const topicPrefix = `deedoo-shelly-${doorName}`;
        switch (pathInDoor) {
            case 'door-state': {
                switch (method) {
                    case 'GET':
                        try {
                            const result = await iot.send(new GetRetainedMessageCommand({ topic: `${topicPrefix}/door-state` }));
                            const timePmillis = result.lastModifiedTime;
                            const ageMillis = Date.now() - timePmillis;
                            const msg = JSON.parse(Buffer.from(result.payload).toString('utf8'));
                            const status = msg?.doorState;
                            if (typeof status !== 'string') {
                                throw new Error('Invalid door-state message');
                            }
                            const origCooldownRemainingMillis = msg?.cooldownRemainingMillis;
                            if (!Number.isFinite(origCooldownRemainingMillis)) {
                                throw new Error('Invalid door-state message');
                            }
                            const cooldownRemainingMillis = origCooldownRemainingMillis - ageMillis;
                            return {
                                statusCode: 200,
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status, timePmillis, ageMillis, cooldownRemainingMillis }),
                            };
                        } catch (e) {
                            if (e.name === 'ResourceNotFoundException') {
                                return { statusCode: 404 };
                            } else {
                                throw e;
                            }
                        }
                    default:
                        return { statusCode: 405, headers: { Allow: 'GET' } };
                }
            }
            case 'open-door': {
                switch (method) {
                    case 'POST':
                        await iot.send(new PublishCommand({ topic: `${topicPrefix}/open-door` }));
                        return { statusCode: 200 };
                    default:
                        return { statusCode: 405, headers: { Allow: 'POST' } };
                }
            }
            case 'close-door': {
                switch (method) {
                    case 'POST':
                        await iot.send(new PublishCommand({ topic: `${topicPrefix}/close-door` }));
                        return { statusCode: 200 };
                    default:
                        return { statusCode: 405, headers: { Allow: 'POST' } };
                }
            }
            case 'raw-click': {
                switch (method) {
                    case 'POST':
                        await iot.send(new PublishCommand({ topic: `${topicPrefix}/click` }));
                        return { statusCode: 200 };
                    default:
                        return { statusCode: 405, headers: { Allow: 'POST' } };
                }
            }
            default: {
                return { statusCode: 404 };
            }
        }
    } else if (method === 'GET' || method === 'HEAD') {
        const res = await serveStatic(method, path);
        if (res) {
            return res;
        } else {
            return { statusCode: 404 };
        }
    } else {
        return { statusCode: 404 };
    }
}

function withCacheControlNoStore(res) {
    return {
        ...res,
        headers: {
            ...res.headers,
            'Cache-Control': 'no-store',
        },
    };
}

function withCookie(res, cookie) {
    return {
        ...res,
        cookies: [
            ...(res.cookies ?? []),
            cookie,
        ],
    };
}

function getUnauthorizedResponse() {
    return {
        statusCode: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Deedoo"', 'Content-Type': 'text/plain' },
        body: 'Unauthorized',
    };
}

export const handler = async (event) => {
    if (!hasValidOrigin(event)) {
        let res = { statusCode: 403 };
        res = withCacheControlNoStore(res);
        return res;
    }
    if (hasValidAuthCookie(event)) {
        let res = await doHandleReq(event);
        res = withCacheControlNoStore(res);
        return res;
    }
    if (hasValidCredentials(event)) {
        let res = await doHandleReq(event);
        res = withCookie(res, createAuthCookie());
        res = withCacheControlNoStore(res);
        return res;
    }
    let res = getUnauthorizedResponse();
    res = withCacheControlNoStore(res);
    return res;
};
