import MQTT from 'async-mqtt';
import cookieParser from 'cookie-parser';
import express, { RequestHandler } from 'express';
import { SSE } from 'express-sse';
import fs from 'fs';
import https from 'https';
import type { AddressInfo } from 'net';
import { isDeepStrictEqual } from 'util';
import { DeedooConf, DoorState, formatTs, getDoorState, getRelayNotifyStates, getSensorNotifyStates, getSensorStatusStates, isNullish, isShellyNotify, isShellyStatus, log, logListenAddr, parseAuthHeader, requireNonNullish, sendShellyClick, sendShellyStatusRequest, setAsyncRepeating, setTimeout2, ShellySensorNum, SseEvent } from './misc.mjs';


// Conf
const conf = ( await import( new URL( '../conf.mjs', import.meta.url ).href ) ).default as DeedooConf;


// SSE
const sse = new SSE( );


// MQTT
const mqtt = await MQTT.connectAsync( conf.mqtt );

// TODO: Switch to Gleam Refs
interface Model {
    mqttAndBackendConnected: boolean;
    mqttAndDeviceConnected: boolean;
    backendAndDeviceConnected: boolean;
    doorState: DoorState;
    activeCooldown: { endTs: number } | undefined;
}
const model: Model = {
    mqttAndBackendConnected: true,
    mqttAndDeviceConnected: false,
    backendAndDeviceConnected: false,
    doorState: 'UNKNOWN',
    activeCooldown: undefined,
};
function setModelProp<Prop extends keyof Model>( prop: Prop, newValue: Model[Prop] ): void {
    if ( !isDeepStrictEqual( newValue, model[ prop ] ) ) {
        model[ prop ] = newValue;
        setModelProp( 'backendAndDeviceConnected', model.mqttAndBackendConnected && model.mqttAndDeviceConnected );
        if ( prop === 'backendAndDeviceConnected' ) {
            log( model.backendAndDeviceConnected ? 'CONNECTED to device' : 'DISCONNECTED from device' );
            if ( model.backendAndDeviceConnected ) {
                enterCooldown( conf.behavior.cooldownAfterConnect );
            }
        }
        const event: SseEvent = {
            connectedToDevice: model.backendAndDeviceConnected,
            doorState: model.doorState,
            cooldownState: !isNullish( model.activeCooldown ),
        }
        sse.updateInit( event );
        sse.send( event );
    }
}
function enterCooldown( duration: number ): void {
    const newEndTs = 1e-3*Date.now( ) + duration;
    const oldEndTs = model.activeCooldown?.endTs ?? Number.NEGATIVE_INFINITY;
    if ( newEndTs > oldEndTs ) {
        const cooldown = { endTs: newEndTs };
        model.activeCooldown = cooldown;
        setTimeout( ( ) => {
            if ( model.activeCooldown === cooldown ) {
                setModelProp( 'activeCooldown', undefined );
            }
        }, 1e3*duration );
    }
}

const checkMqttConnected = ( ) => {
    setModelProp( 'mqttAndBackendConnected', mqtt.connected );
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
log( `Subscribing to ${ topics.join( ', ' ) }` );
await mqtt.subscribe( topics );

let receivedStatus = false;

// Check device status periodically
setAsyncRepeating( 0, 1e3*conf.behavior.statusCheckInterval, async ( ) => {
    receivedStatus = false;
    await sendShellyStatusRequest( mqtt, conf.shelly.deviceName );
    setTimeout2( 1e3*conf.behavior.statusCheckTimeout, ( ) => {
        setModelProp( 'mqttAndDeviceConnected', receivedStatus );
    } );
} );

// Handle messages from device
const sensorStates = new Map<ShellySensorNum,boolean>( );
mqtt.on( 'message', async ( _, payload ) => {
    const json = JSON.parse( payload.toString( 'utf8' ) );
    if ( isShellyStatus( json ) ) {
        receivedStatus = true;
        setModelProp( 'mqttAndDeviceConnected', true );
        for ( const [ sensor, state ] of getSensorStatusStates( json ) ) {
            if ( sensor === conf.shelly.inputForDoorFullyOpened.sensor || sensor === conf.shelly.inputForDoorFullyClosed.sensor ) {
                sensorStates.set( sensor, state );
                const newDoorState = getDoorState( conf.shelly, sensorStates );
                setModelProp( 'doorState', newDoorState );
            }
        }
    }
    else if ( isShellyNotify( json ) ) {
        for ( const [ sensor, state ] of getSensorNotifyStates( json ) ) {
            if ( sensor === conf.shelly.inputForDoorFullyOpened.sensor || sensor === conf.shelly.inputForDoorFullyClosed.sensor ) {
                const oldDoorState = getDoorState( conf.shelly, sensorStates );
                sensorStates.set( sensor, state );
                const newDoorState = getDoorState( conf.shelly, sensorStates );
                log( `Sensor notify: sensor = ${sensor}, sensor-state = ${state}, old-door-state = ${oldDoorState}, new-door-state = ${newDoorState}` );
                setModelProp( 'doorState', newDoorState );
            }
        }
        for ( const [ relay, state ] of getRelayNotifyStates( json ) ) {
            if ( relay === conf.shelly.outputForClick.relay && state === conf.shelly.outputForClick.state ) {
                log( `Relay notify: relay = ${relay}` );
                enterCooldown( conf.behavior.cooldownAfterClick );
            }
        }
    }
} );


// API
const apiHandler = express.Router( );

apiHandler.get( '/events', sse.init );

apiHandler.post( '/open', async ( _, resp ) => {
    const priorCooldown = model.activeCooldown;
    const priorDoorState = getDoorState( conf.shelly, sensorStates );
    const willExecute = ( !priorCooldown && priorDoorState === 'FULLY_CLOSED' );
    if ( willExecute ) {
        enterCooldown( conf.behavior.cooldownAfterClick );
        await sendShellyClick( mqtt, conf.shelly );
    }
    log( `${willExecute ? 'Executing' : 'Ignoring'} cmd OPEN: prior-cooldown = ${ formatTs( priorCooldown?.endTs ) }, prior-door-state = ${priorDoorState}` );
    resp.status( 200 ).json( { actionTaken: willExecute, priorCooldown, priorDoorState } );
} );

apiHandler.post( '/close', async ( _, resp ) => {
    const priorCooldown = model.activeCooldown;
    const priorDoorState = getDoorState( conf.shelly, sensorStates );
    const willExecute = ( !priorCooldown && priorDoorState === 'FULLY_OPENED' );
    if ( willExecute ) {
        enterCooldown( conf.behavior.cooldownAfterClick );
        await sendShellyClick( mqtt, conf.shelly );
    }
    log( `${willExecute ? 'Executing' : 'Ignoring'} cmd CLOSE: prior-cooldown = ${ formatTs( priorCooldown?.endTs ) }, prior-door-state = ${priorDoorState}` );
    resp.status( 200 ).json( { actionTaken: willExecute, priorCooldown, priorDoorState } );
} );

apiHandler.post( '/raw-click', async ( _, resp ) => {
    const priorCooldown = model.activeCooldown;
    const priorDoorState = getDoorState( conf.shelly, sensorStates );
    const willExecute = true;
    if ( willExecute ) {
        enterCooldown( conf.behavior.cooldownAfterClick );
        await sendShellyClick( mqtt, conf.shelly );
    }
    log( `${willExecute ? 'Executing' : 'Ignoring'} cmd RAW_CLICK: prior-cooldown = ${ formatTs( priorCooldown?.endTs ) }, prior-door-state = ${priorDoorState}` );
    resp.status( 200 ).json( { actionTaken: willExecute, priorCooldown, priorDoorState } );
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
