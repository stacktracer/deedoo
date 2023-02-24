import MQTT from 'async-mqtt';
import express from 'express';
import { SSE } from 'express-sse';
import http from 'http';
import type { AddressInfo } from 'net';
import { isDeepStrictEqual } from 'util';
import conf from './config.mjs';
import { DoorState, getDoorState, getRelayNotifyStates, getSensorNotifyStates, getSensorStatusStates, isShellyNotify, isShellyStatus, logListenAddr, requireNonNullish, sendShellyClick, sendShellyStatusRequest, ShellySensorNum } from './misc.mjs';


// FIXME: Auth


// SSE
const sse = new SSE( );


// MQTT
const mqtt = await MQTT.connectAsync( conf.mqtt );

// TODO: Request Shelly status periodically
// TODO: Check periodically whether we've heard from Shelly recently

interface Model {
    isBackendConnectedToMqtt: boolean;
    doorState: DoorState;
    recentClickTs: number;
}
const model: Model = {
    isBackendConnectedToMqtt: true,
    doorState: 'UNKNOWN',
    recentClickTs: new Date( ).getTime( ) * 1e-3,
};
function setModelProp<Prop extends keyof Model>( prop: Prop, newValue: Model[Prop] ) {
    if ( !isDeepStrictEqual( newValue, model[ prop ] ) ) {
        model[ prop ] = newValue;
        sse.updateInit( model );
        sse.send( model );
    }
}

const checkMqttConnected = ( ) => {
    setModelProp( 'isBackendConnectedToMqtt', mqtt.connected );
};
mqtt.on( 'connect', checkMqttConnected );
mqtt.on( 'message', checkMqttConnected );
mqtt.on( 'packetsend', checkMqttConnected );
mqtt.on( 'packetreceive', checkMqttConnected );
mqtt.on( 'disconnect', checkMqttConnected );
mqtt.on( 'error', checkMqttConnected );
mqtt.on( 'close', checkMqttConnected );
mqtt.on( 'end', checkMqttConnected );
mqtt.on( 'offline', checkMqttConnected );
mqtt.on( 'reconnect', checkMqttConnected );
mqtt.on( 'outgoingEmpty', checkMqttConnected );
checkMqttConnected( );

const topics = [ `${conf.shelly.deviceName}/events/rpc` ];
console.log( `Subscribing to ${ topics.join( ', ' ) }` );
await mqtt.subscribe( topics );

const sensorStates = new Map<ShellySensorNum,boolean>( );
mqtt.on( 'message', async ( _, payload ) => {
    const json = JSON.parse( payload.toString( 'utf8' ) );
    if ( isShellyStatus( json ) ) {
        for ( const [ sensor, state ] of getSensorStatusStates( json ) ) {
            if ( sensor === conf.shelly.sensorForDoorFullyOpen || sensor === conf.shelly.sensorForDoorFullyClosed ) {
                const oldDoorState = getDoorState( conf.shelly, sensorStates );
                sensorStates.set( sensor, state );
                const newDoorState = getDoorState( conf.shelly, sensorStates );
                console.log( `Sensor status: sensor = ${sensor}, sensor-state = ${state}, old-door-state = ${oldDoorState}, new-door-state = ${newDoorState}` );
                setModelProp( 'doorState', newDoorState );
            }
        }
    }
    else if ( isShellyNotify( json ) ) {
        for ( const [ sensor, state ] of getSensorNotifyStates( json ) ) {
            if ( sensor === conf.shelly.sensorForDoorFullyOpen || sensor === conf.shelly.sensorForDoorFullyClosed ) {
                const oldDoorState = getDoorState( conf.shelly, sensorStates );
                sensorStates.set( sensor, state );
                const newDoorState = getDoorState( conf.shelly, sensorStates );
                console.log( `Sensor notify: sensor = ${sensor}, sensor-state = ${state}, old-door-state = ${oldDoorState}, new-door-state = ${newDoorState}` );
                setModelProp( 'doorState', newDoorState );
            }
        }
        for ( const [ relay, state ] of getRelayNotifyStates( json ) ) {
            if ( relay === conf.shelly.relayForClick && state === true ) {
                const newClickTs = json.params.ts;
                console.log( `Relay notify: relay = ${relay}, click-ts = ${newClickTs}` );
                setModelProp( 'recentClickTs', newClickTs );
            }
        }
    }
} );

console.log( 'Requesting initial status' );
await sendShellyStatusRequest( mqtt, conf.shelly.deviceName );


// API
const apiHandler = express.Router( );

apiHandler.get( '/events', sse.init );

apiHandler.post( '/open', async ( _, resp ) => {
    const doorState = getDoorState( conf.shelly, sensorStates );
    const willExecute = ( doorState === 'FULLY_CLOSED' );
    if ( willExecute ) {
        await sendShellyClick( mqtt, conf.shelly.deviceName, conf.shelly.relayForClick );
    }
    console.log( `${willExecute ? 'Executing' : 'Ignoring'} cmd OPEN: door-state = ${doorState}` );
    resp.status( 200 ).json( { actionTaken: willExecute, priorDoorState: doorState } );
} );

apiHandler.post( '/close', async ( _, resp ) => {
    const doorState = getDoorState( conf.shelly, sensorStates );
    const willExecute = ( doorState === 'FULLY_OPEN' );
    if ( willExecute ) {
        await sendShellyClick( mqtt, conf.shelly.deviceName, conf.shelly.relayForClick );
    }
    console.log( `${willExecute ? 'Executing' : 'Ignoring'} cmd CLOSE: door-state = ${doorState}` );
    resp.status( 200 ).json( { actionTaken: willExecute, priorDoorState: doorState } );
} );

apiHandler.post( '/click', async ( _, resp ) => {
    const doorState = getDoorState( conf.shelly, sensorStates );
    const willExecute = true;
    if ( willExecute ) {
        await sendShellyClick( mqtt, conf.shelly.deviceName, conf.shelly.relayForClick );
    }
    console.log( `${willExecute ? 'Executing' : 'Ignoring'} cmd CLICK: door-state = ${doorState}` );
    resp.status( 200 ).json( { actionTaken: willExecute, priorDoorState: doorState } );
} );


// UI
const uiDir = new URL( '../../frontend/build/dist/', import.meta.url ).pathname;
const uiHandler = express.static( uiDir );


// Serve
const app = express( );
app.use( '/ui', uiHandler );
app.use( '/api', apiHandler );
const server = http.createServer( app );
server.on( 'listening', ( ) => {
    logListenAddr( requireNonNullish( server.address( ) ) as AddressInfo );
} );
server.listen( conf.serve.port, conf.serve.host );
