import express, { RequestHandler } from 'express';
import { SSE } from 'express-sse';
import fs from 'fs';
import type { MqttClient } from 'mqtt';
import { isDeepStrictEqual } from 'util';
import { ClickConf, doLog, DoorState, formatTs, getDoorState, getRelayNotifyStates, getSensorNotifyStates, getSensorStatusStates, isShellyNotify, isShellyStatus, mqttOnMessage, sendShellyClick, sendShellyStatusRequest, setAsyncRepeating, setTimeout2, ShellySensorNum, SiteConf, SseEvent } from './misc.mjs';

// TODO: Switch to Gleam Refs
interface Model {
    connectedToDevice: boolean;
    doorState: DoorState;
    activeCooldown: { endTs: number } | undefined;
}

export async function createSite( siteConf: SiteConf, mqtt: MqttClient, logPrefix: string ): Promise<RequestHandler> {
    const { backend: conf } = siteConf;

    function log( s: string ): void {
        doLog( logPrefix + ' - ' + s );
    }

    const model: Model = {
        connectedToDevice: false,
        doorState: 'UNKNOWN',
        activeCooldown: undefined,
    };

    const sse = new SSE( );

    function setModelProp<Prop extends keyof Model>( prop: Prop, newValue: Model[Prop] ): boolean {
        if ( !isDeepStrictEqual( newValue, model[ prop ] ) ) {
            model[ prop ] = newValue;
            const event: SseEvent = {
                connectedToDevice: model.connectedToDevice,
                doorState: model.doorState,
                cooldownState: !!model.activeCooldown,
            }
            sse.updateInit( event );
            sse.send( event );
            return true;
        }
        return false;
    }

    function setConnectedToDevice( connectedToDevice: boolean ): void {
        if ( setModelProp( 'connectedToDevice', connectedToDevice ) ) {
            if ( model.connectedToDevice ) {
                log( 'CONNECTED to device' );
                enterCooldown( conf.outputForClick );
            }
            else {
                log( 'DISCONNECTED from device' );
            }
        }
    }

    function enterCooldown( conf: ClickConf ): void {
        const cooldownDuration = conf.duration + conf.cooldownMargin;
        const newEndTs = 1e-3*Date.now( ) + cooldownDuration;
        const oldEndTs = model.activeCooldown?.endTs ?? Number.NEGATIVE_INFINITY;
        if ( newEndTs > oldEndTs ) {
            const cooldown = { endTs: newEndTs };
            setModelProp( 'activeCooldown', cooldown );
            setTimeout( ( ) => {
                if ( model.activeCooldown === cooldown ) {
                    setModelProp( 'activeCooldown', undefined );
                }
            }, 1e3*cooldownDuration );
        }
    }

    // Request device status periodically
    let receivedStatus = false;
    setAsyncRepeating( 0, 1e3*conf.statusCheckInterval, async ( ) => {
        receivedStatus = false;
        await sendShellyStatusRequest( mqtt, conf.deviceName );
        setTimeout2( 1e3*conf.statusCheckTimeout, ( ) => {
            setConnectedToDevice( receivedStatus );
        } );
    } );

    // MQTT message handling
    const topics = [ `${conf.deviceName}/events/rpc` ];
    log( `Subscribing to ${ topics.join( ', ' ) }` );
    const sensorStates = new Map<ShellySensorNum,boolean>( );
    mqttOnMessage( mqtt, topics, async ( _, payload ) => {
        const json = JSON.parse( payload.toString( 'utf8' ) );
        if ( isShellyStatus( json ) ) {
            receivedStatus = true;
            setConnectedToDevice( receivedStatus );
            for ( const [ sensor, state ] of getSensorStatusStates( json ) ) {
                if ( sensor === conf.inputForDoorFullyOpened.sensor || sensor === conf.inputForDoorFullyClosed.sensor ) {
                    sensorStates.set( sensor, state );
                    const newDoorState = getDoorState( conf, sensorStates );
                    setModelProp( 'doorState', newDoorState );
                }
            }
        }
        else if ( isShellyNotify( json ) ) {
            for ( const [ sensor, state ] of getSensorNotifyStates( json ) ) {
                if ( sensor === conf.inputForDoorFullyOpened.sensor || sensor === conf.inputForDoorFullyClosed.sensor ) {
                    const oldDoorState = getDoorState( conf, sensorStates );
                    sensorStates.set( sensor, state );
                    const newDoorState = getDoorState( conf, sensorStates );
                    log( `Sensor notify: sensor = ${sensor}, sensor-state = ${state}, old-door-state = ${oldDoorState}, new-door-state = ${newDoorState}` );
                    setModelProp( 'doorState', newDoorState );
                }
            }
            for ( const [ relay, state ] of getRelayNotifyStates( json ) ) {
                if ( relay === conf.outputForClick.relay && state === conf.outputForClick.state ) {
                    log( `Relay notify: relay = ${relay}` );
                    enterCooldown( conf.outputForClick );
                }
            }
        }
    } );

    // Routes
    const handler = express.Router( );

    // REST
    handler.post( '/api/open', async ( _, resp ) => {
        const priorCooldown = model.activeCooldown;
        const priorDoorState = getDoorState( conf, sensorStates );
        const willExecute = ( !priorCooldown && priorDoorState === 'FULLY_CLOSED' );
        if ( willExecute ) {
            enterCooldown( conf.outputForClick );
            await sendShellyClick( mqtt, conf );
        }
        log( `${willExecute ? 'Executing' : 'Ignoring'} cmd OPEN: prior-cooldown = ${ formatTs( priorCooldown?.endTs ) }, prior-door-state = ${priorDoorState}` );
        resp.status( 200 ).json( { actionTaken: willExecute, priorCooldown, priorDoorState } );
    } );
    handler.post( '/api/close', async ( _, resp ) => {
        const priorCooldown = model.activeCooldown;
        const priorDoorState = getDoorState( conf, sensorStates );
        const willExecute = ( !priorCooldown && priorDoorState === 'FULLY_OPENED' );
        if ( willExecute ) {
            enterCooldown( conf.outputForClick );
            await sendShellyClick( mqtt, conf );
        }
        log( `${willExecute ? 'Executing' : 'Ignoring'} cmd CLOSE: prior-cooldown = ${ formatTs( priorCooldown?.endTs ) }, prior-door-state = ${priorDoorState}` );
        resp.status( 200 ).json( { actionTaken: willExecute, priorCooldown, priorDoorState } );
    } );
    handler.post( '/api/raw-click', async ( _, resp ) => {
        const priorCooldown = model.activeCooldown;
        const priorDoorState = getDoorState( conf, sensorStates );
        const willExecute = true;
        if ( willExecute ) {
            enterCooldown( conf.outputForClick );
            await sendShellyClick( mqtt, conf );
        }
        log( `${willExecute ? 'Executing' : 'Ignoring'} cmd RAW_CLICK: prior-cooldown = ${ formatTs( priorCooldown?.endTs ) }, prior-door-state = ${priorDoorState}` );
        resp.status( 200 ).json( { actionTaken: willExecute, priorCooldown, priorDoorState } );
    } );
    handler.get( '/api/events', sse.init );

    // Frontend
    const frontendDir = new URL( '../../frontend/build/dist/', import.meta.url ).pathname
    const indexHtmlCharset = 'utf8';
    const indexHtml0 = ( await fs.promises.readFile( frontendDir + '/index.html' ) ).toString( indexHtmlCharset );
    const indexHtml1 = indexHtml0.replaceAll( /\${title}/g, siteConf.frontend.title );
    const indexHtml2 = Buffer.from( indexHtml1, indexHtmlCharset );
    const indexHtmlHandler: RequestHandler = ( _, resp ) => {
        resp.set( 'Content-Type', 'text/html' );
        resp.send( indexHtml2 );
    };
    handler.get( '/ui/index.html', indexHtmlHandler );
    handler.get( '/ui', ( req, resp, next ) => {
        if ( !req.originalUrl.endsWith( '/' ) ) {
            resp.redirect( 301, 'ui/' );
        }
        else {
            indexHtmlHandler( req, resp, next );
        }
    } );
    handler.use( '/ui', express.static( frontendDir ) );

    return handler;
}
