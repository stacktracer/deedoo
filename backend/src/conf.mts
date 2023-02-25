import type { Conf } from './misc.mjs';

const conf: Conf = {
    serve: {
        host: '127.0.0.1',
        port: 8443,
        certFile: 'FIXME',
        keyFile: 'FIXME',
        cookieSigningSecret: 'FIXME',
        auth: {
            'FIXME': 'FIXME',
        },
    },
    mqtt: {
        protocol: 'mqtts',
        host: '127.0.0.1',
        port: 1883,
        clientId: 'deedoo',
        username: 'FIXME',
        password: 'FIXME',
    },
    shelly: {
        deviceName: 'shellyplus2pm-FIXME',
        sensorForDoorFullyOpen: 0,
        sensorForDoorFullyClosed: 1,
        relayForClick: 0,
    },
};

export default conf;
