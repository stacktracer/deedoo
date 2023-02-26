import MQTT from 'async-mqtt';
import cookieParser from 'cookie-parser';
import express, { RequestHandler } from 'express';
import { SSE } from 'express-sse';
import fs from 'fs';
import https from 'https';
import type { AddressInfo } from 'net';
import { isDeepStrictEqual } from 'util';
import conf from './conf.mjs';
import { DoorState, getDoorState, getRelayNotifyStates, getSensorNotifyStates, getSensorStatusStates, isShellyNotify, isShellyStatus, logListenAddr, parseAuthHeader, requireNonNullish, sendShellyClick, sendShellyStatusRequest, ShellySensorNum } from './misc.mjs';


// SSE
const sse = new SSE( );


// MQTT
const mqtt = await MQTT.connectAsync( conf.mqtt );

// TODO: Request Shelly status periodically
// TODO: Check periodically whether we've heard from Shelly recently
// FIXME: Log timestamps

// FIXME: Subscribe to shelly-is-online topic

interface Model {
    isBackendConnectedToMqtt: boolean;
    doorState: DoorState;
    recentClickTs: number;
}
const model: Model = {
    isBackendConnectedToMqtt: true,
    doorState: 'UNKNOWN',
    recentClickTs: Date.now( ) * 1e-3,
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
            if ( sensor === conf.shelly.inputForDoorFullyOpen.sensor || sensor === conf.shelly.inputForDoorFullyClosed.sensor ) {
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
            if ( sensor === conf.shelly.inputForDoorFullyOpen.sensor || sensor === conf.shelly.inputForDoorFullyClosed.sensor ) {
                const oldDoorState = getDoorState( conf.shelly, sensorStates );
                sensorStates.set( sensor, state );
                const newDoorState = getDoorState( conf.shelly, sensorStates );
                console.log( `Sensor notify: sensor = ${sensor}, sensor-state = ${state}, old-door-state = ${oldDoorState}, new-door-state = ${newDoorState}` );
                setModelProp( 'doorState', newDoorState );
            }
        }
        for ( const [ relay, state ] of getRelayNotifyStates( json ) ) {
            if ( relay === conf.shelly.outputForClick.relay && state === conf.shelly.outputForClick.state ) {
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
        await sendShellyClick( mqtt, conf.shelly );
    }
    console.log( `${willExecute ? 'Executing' : 'Ignoring'} cmd OPEN: door-state = ${doorState}` );
    resp.status( 200 ).json( { actionTaken: willExecute, priorDoorState: doorState } );
} );

apiHandler.post( '/close', async ( _, resp ) => {
    const doorState = getDoorState( conf.shelly, sensorStates );
    const willExecute = ( doorState === 'FULLY_OPEN' );
    if ( willExecute ) {
        await sendShellyClick( mqtt, conf.shelly );
    }
    console.log( `${willExecute ? 'Executing' : 'Ignoring'} cmd CLOSE: door-state = ${doorState}` );
    resp.status( 200 ).json( { actionTaken: willExecute, priorDoorState: doorState } );
} );

apiHandler.post( '/click', async ( _, resp ) => {
    const doorState = getDoorState( conf.shelly, sensorStates );
    const willExecute = true;
    if ( willExecute ) {
        await sendShellyClick( mqtt, conf.shelly );
    }
    console.log( `${willExecute ? 'Executing' : 'Ignoring'} cmd CLICK: door-state = ${doorState}` );
    resp.status( 200 ).json( { actionTaken: willExecute, priorDoorState: doorState } );
} );


// UI
const uiDir = new URL( '../../frontend/build/dist/', import.meta.url ).pathname;
const uiHandler = express.static( uiDir );


// HTTPS
const app = express( );
app.use( cookieParser( conf.https.cookieSigningSecret ) );
const auth: RequestHandler = ( req, resp, next ) => {
    // Client provided a signed cookie for a recognized user
    if ( req.signedCookies[ 'user' ] && conf.https.auth[ req.signedCookies[ 'user' ] ] ) {
        next( );
        return;
    }

    // Client didn't provide a cookie, but did provide credentials
    if ( req.headers.authorization ) {
        const [ username, password ] = parseAuthHeader( req.headers.authorization );
        if ( username && conf.https.auth[ username ] && password === conf.https.auth[ username ] ) {
            resp.cookie( 'user', username, {
                sameSite: 'strict',
                httpOnly: true,
                secure: true,
                signed: true,
                maxAge: 100*365*86400*1000,
            } );
            next( );
            return;
        }
    }

    // Client provided neither a cookie nor credentials
    resp.setHeader( 'WWW-Authenticate', 'Basic' );
    resp.status( 401 );
    const e = new Error( 'Not authenticated' );
    ( e as any ).status = 401;
    next( e );
};
app.use( '/ui', auth, uiHandler );
app.use( '/api', auth, apiHandler );
const httpsKey = fs.readFileSync( conf.https.keyFile );
const httpsCert = fs.readFileSync( conf.https.certFile );
const server = https.createServer( { key: httpsKey, cert: httpsCert }, app );
server.on( 'listening', ( ) => {
    logListenAddr( requireNonNullish( server.address( ) ) as AddressInfo, true );
} );
server.listen( conf.https.port, conf.https.host );
