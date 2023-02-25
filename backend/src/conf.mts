import type { DeedooConf } from './misc.mjs';

const conf: DeedooConf = {
    https: {
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
        inputForDoorFullyOpen: { sensor: 0, state: true },
        inputForDoorFullyClosed: { sensor: 1, state: false },
        outputForClick: { relay: 0, state: true },
    },
};

export default conf;
