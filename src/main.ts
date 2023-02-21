import * as MQTT from 'paho-mqtt';

const client = new MQTT.Client( 'FIXME', 8443, 'FIXME' );

client.onMessageArrived = msg => {
    console.log( { arrived: msg.payloadString } );
};
client.onMessageDelivered = msg => {
    console.log( { delivered: msg.payloadString } );
};
client.onConnectionLost = e => {
    console.error( { connectionFailed: e } );
};

client.connect( {
    useSSL: true,
    userName: 'FIXME',
    password: 'FIXME',
    onSuccess: ( ) => {
        client.subscribe( 'FIXME/events/rpc' );
    },
    onFailure: e => {
        console.error( { subscribeFailed: e } );
    },
} );
