export default {
    serve: {
        host: '127.0.0.1',
        port: 8443,
        certFile: 'FIXME',
        keyFile: 'FIXME',
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
        sensorForDoorFullyOpen: 0 as const,
        sensorForDoorFullyClosed: 1 as const,
        relayForClick: 0 as const,
    },
};
