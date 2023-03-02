import type { RequestHandler } from 'express';
import type { IClientOptions, MqttClient, OnMessageCallback } from 'mqtt';
import type { AddressInfo } from 'net';
import os from 'os';
import url from 'url';
import type { Disposer } from './disposer';

export interface DeedooConf {
    https: HttpsConf;
    mqtt: MqttConf;
    sites: Record<string,SiteConf>;
}

export interface HttpsConf {
    host: string;
    port: number;
    certFile: string;
    keyFile: string;
    cookieSigningSecret: string;
    auth: Record<string,string>;
}

export type MqttConf = IClientOptions;

export interface SiteConf {
    frontend: SiteFrontendConf;
    backend: SiteBackendConf;
}

export interface SiteFrontendConf {
    title: string;
}

export interface SiteBackendConf {
    deviceName: string;
    inputForDoorFullyOpened: { sensor: ShellySensorNum, state: boolean };
    inputForDoorFullyClosed: { sensor: ShellySensorNum, state: boolean };
    outputForClick: { relay: ShellyRelayNum, state: boolean, duration: number };

    statusCheckInterval: number;
    statusCheckTimeout: number;
    cooldownAfterConnect: number;
    cooldownAfterClick: number;
}

export function isNullish( t: unknown ): t is null | undefined {
    return ( t === null || t === undefined );
}

export function requireNonNullish<T>( t: T | null | undefined ): T {
    if ( isNullish( t ) ) {
        throw new Error( );
    }
    return t;
}

const timeFormat = new Intl.DateTimeFormat( 'en-US', {
    timeZoneName: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    second: '2-digit',
} );
export function formatTs( ts: number ): string;
export function formatTs( ts: undefined ): undefined;
export function formatTs( ts: number | undefined ): string | undefined;
export function formatTs( ts: number | undefined ): string | undefined {
    if ( ts === undefined ) {
        return undefined;
    }
    const tsFloor = Math.floor( ts );
    const millis = Math.round( 1e3*( ts - tsFloor ) );
    const FFF = millis.toFixed( 0 ).padStart( 3, '0' );
    let yyyy = '????';
    let mm = '??';
    let dd = '??';
    let HH = '??';
    let MM = '??';
    let SS = '??';
    let ZZZ = '???';
    for ( const part of timeFormat.formatToParts( new Date( 1e3*tsFloor ) ) ) {
        switch ( part.type ) {
            case 'year': yyyy = part.value; break;
            case 'month': mm = part.value; break;
            case 'day': dd = part.value; break;
            case 'hour': HH = part.value; break;
            case 'minute': MM = part.value; break;
            case 'second': SS = part.value; break;
            case 'timeZoneName': ZZZ = part.value; break;
        }
    }
    return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}.${FFF} ${ZZZ}`;
}

export function getLogString( s: string ): string {
    const time = formatTs( 1e-3*Date.now( ) );
    return `[${time}] ${s}`;
}

export function doLog( s: string ): void {
    console.log( getLogString( s ) );
}

export function logListenAddr( addrInfo: AddressInfo, isHttps: boolean ) {
    const { family, address, port } = addrInfo;

    // Log the KNOWN interfaces we're listening on
    let ifaceFound = false;
    const isAllInterfaces = ( family === 'IPv4' && address === '0.0.0.0' ) || ( family === 'IPv6' && address === '::' );
    for ( const [ ifaceName, ifaceAddrs ] of Object.entries( os.networkInterfaces( ) ) ) {
        for ( const ifaceAddr of ifaceAddrs ?? [] ) {
            if ( ifaceAddr.family === family && ( isAllInterfaces || ifaceAddr.address === address ) ) {
                const ifaceUrl = url.format( {
                    protocol: ( isHttps ? 'https' : 'http' ),
                    hostname: ( family === 'IPv4' ? ifaceAddr.address : `[${ifaceAddr.address}]` ),
                    port,
                } );
                doLog( `Listening at ${ifaceUrl} (${ifaceName})` );
                ifaceFound = true;
            }
        }
    }

    // Log if we're listening on an UNKNOWN interface
    if ( !ifaceFound ) {
        const addrUrl = url.format( {
            protocol: 'http',
            hostname: ( family === 'IPv4' ? address : `[${address}]` ),
            port,
        } );
        doLog( `Listening at ${addrUrl} (???)` );
    }
}

export function createAuthHandler( conf: HttpsConf ): RequestHandler {
    return ( req, resp, next ) => {
        // Client provided a signed cookie for a recognized user
        if ( req.signedCookies[ 'user' ] && conf.auth[ req.signedCookies[ 'user' ] ] ) {
            next( );
            return;
        }

        // Client didn't provide a cookie, but did provide credentials
        if ( req.headers.authorization ) {
            const [ username, password ] = parseAuthHeader( req.headers.authorization );
            if ( username && conf.auth[ username ] && password === conf.auth[ username ] ) {
                doLog( `Accepting credentials: client = ${req.ip}, req = ${req.originalUrl}, user = ${username}` );
                resp.cookie( 'user', username, {
                    sameSite: 'strict',
                    httpOnly: true,
                    secure: true,
                    signed: true,
                    maxAge: 365*86400*1000,
                } );
                next( );
                return;
            }
            else {
                doLog( `Rejecting credentials: client = ${req.ip}, req = ${req.originalUrl}, user = ${username}` );
            }
        }

        // Client provided neither a cookie nor valid credentials
        resp.setHeader( 'WWW-Authenticate', 'Basic' );
        resp.status( 401 );
        next( getLogString( `Unauthenticated request: client = ${req.ip}, req = ${req.originalUrl}` ) );
    };
}

function requireTwoTuple( array: Array<string> ): [ string, string ] {
    if ( array.length !== 2 ) {
        throw new Error( 'Not a 2-tuple: ' + JSON.stringify( array ) );
    }
    return ( array as [ string, string ] );
}

export function parseAuthHeader( authHeader: string ): [ username: string, password: string ] {
    const [ scheme, params ] = requireTwoTuple( authHeader.split( ' ' ) );
    switch ( scheme ) {
        case 'Basic': return requireTwoTuple( Buffer.from( params, 'base64' ).toString( ).split( ':' ) );
        default: throw new Error( 'Auth scheme not supported: ' + scheme );
    }
}

export function mqttOnMessage( mqtt: MqttClient, topics: string | Array<string>, callback: OnMessageCallback ): void {
    const topicSet = new Set( topics );
    mqtt.subscribe( topics, e => {
        if ( e ) {
            throw e;
        }
        else {
            mqtt.on( 'message', async ( topic, payload, packet ) => {
                if ( topicSet.has( topic ) ) {
                    callback( topic, payload, packet );
                }
            } );
        }
    } );
}

export function mqttPublish( mqtt: MqttClient, topic: string, message: string | Buffer ): Promise<void> {
    return new Promise( ( resolve, reject ) => {
        mqtt.publish( topic, message, { qos: 2 }, e => {
            if ( e ) {
                reject( e );
            }
            else {
                resolve( );
            }
        } );
    } );
}

export type ShellySensorNum = 0 | 1;
export type ShellyRelayNum = 0 | 1;

export function sendShellyStatusRequest( mqtt: MqttClient, shellyDevice: string ): Promise<void> {
    return mqttPublish( mqtt, `${shellyDevice}/rpc`, JSON.stringify( {
        id: 0,
        method: 'Shelly.GetStatus',
        src: `${shellyDevice}/events`,
    } ) );
}

export function setAsyncRepeating( delay_MILLIS: number, interval_MILLIS: number, asyncFn: ( ) => Promise<unknown> ): Disposer {
    // clearTimeout is not sufficient if fn does something async
    let running = true;
    let handle = setTimeout2( delay_MILLIS, async function g( ) {
        if ( running ) {
            await asyncFn( );
            if ( running ) {
                handle = setTimeout2( interval_MILLIS, g );
            }
        }
    } );
    return ( ) => {
        running = false;
        clearTimeout( handle );
    };
}

export function setTimeout2( delay_MILLIS: number, fn: ( ) => unknown ): ReturnType<typeof setTimeout> {
    return setTimeout( fn, delay_MILLIS );
}

const shellyRecentClicksByDeviceByMqtt = new WeakMap<MqttClient,Map<string,object>>( );
function setShellyRecentClick( mqtt: MqttClient, deviceName: string, value: object ): void {
    let clicksByDevice = shellyRecentClicksByDeviceByMqtt.get( mqtt );
    if ( !clicksByDevice ) {
        clicksByDevice = new Map( );
        shellyRecentClicksByDeviceByMqtt.set( mqtt, clicksByDevice );
    }
    clicksByDevice.set( deviceName, value );
}
function getShellyRecentClick( mqtt: MqttClient, deviceName: string ): object | undefined {
    return shellyRecentClicksByDeviceByMqtt.get( mqtt )?.get( deviceName );
}
export async function sendShellyClick( mqtt: MqttClient, conf: SiteBackendConf ): Promise<void> {
    const { deviceName, outputForClick } = conf;
    await mqttPublish( mqtt, `${deviceName}/rpc`, JSON.stringify( {
        method: 'Switch.Set',
        params: {
            id: outputForClick.relay,
            on: outputForClick.state,
        },
    } ) );
    const thisClick = {};
    setShellyRecentClick( mqtt, deviceName, thisClick );
    setTimeout2( 1e3*outputForClick.duration, async ( ) => {
        if ( getShellyRecentClick( mqtt, deviceName ) === thisClick ) {
            await mqttPublish( mqtt, `${deviceName}/rpc`, JSON.stringify( {
                method: 'Switch.Set',
                params: {
                    id: outputForClick.relay,
                    on: !outputForClick.state,
                },
            } ) );
        }
    } );
}

function isObject<T extends object>( x: unknown, _isType: ( x: Record<any,any> ) => boolean ): x is T {
    return ( typeof x === 'object' && x !== null && _isType( x ) );
}

export interface ShellyStatus {
    result: {
        sys: {
            restart_required: boolean;
            available_updates: unknown;
        };
        'input:0'?: { state: boolean };
        'input:1'?: { state: boolean };
        'switch:0'?: { output: boolean };
        'switch:1'?: { output: boolean };
    };
}
export interface ShellyNotify {
    method: 'NotifyStatus';
    params: {
        ts: number;
        'input:0'?: { state: boolean };
        'input:1'?: { state: boolean };
        'switch:0'?: { output: boolean };
        'switch:1'?: { output: boolean };
    };
}
function isSensorOrUndef( x: unknown ): x is { state: boolean } | undefined {
    return ( x === undefined || isObject( x, x => typeof x[ 'state' ] === 'boolean' ) );
}
function isRelayOrUndef( x: unknown ): x is { state: boolean } | undefined {
    return ( x === undefined || isObject( x, x => typeof x[ 'output' ] === 'boolean' ) );
}
export function isShellyStatus( x: unknown ): x is ShellyStatus {
    return isObject( x, x => (
        isObject( x[ 'result' ], result => (
            isObject( result[ 'sys' ], sys => (
                typeof sys[ 'restart_required' ] === 'boolean'
                && sys[ 'available_updates' ] !== undefined
            ) )
            && isSensorOrUndef( result[ 'input:0' ] )
            && isSensorOrUndef( result[ 'input:1' ] )
            && isRelayOrUndef( result[ 'switch:0' ] )
            && isRelayOrUndef( result[ 'switch:1' ] )
        ) )
    ) );
}
export function isShellyNotify( x: unknown ): x is ShellyNotify {
    return isObject( x, x => (
        x[ 'method' ] === 'NotifyStatus'
        && isObject( x[ 'params' ], params => (
            typeof params[ 'ts' ] === 'number'
            && isSensorOrUndef( params[ 'input:0' ] )
            && isSensorOrUndef( params[ 'input:1' ] )
            && isRelayOrUndef( params[ 'switch:0' ] )
            && isRelayOrUndef( params[ 'switch:1' ] )
        ) )
    ) );
}
export function getSensorStatusStates( status: ShellyStatus ): Map<ShellySensorNum,boolean> {
    const map = new Map<ShellySensorNum,boolean>( );
    const state0 = status.result[ 'input:0' ]?.state;
    const state1 = status.result[ 'input:1' ]?.state;
    if ( state0 !== undefined ) {
        map.set( 0, state0 );
    }
    if ( state1 !== undefined ) {
        map.set( 1, state1 );
    }
    return map;
}
export function getSensorNotifyStates( notify: ShellyNotify ): Map<ShellySensorNum,boolean> {
    const map = new Map<ShellySensorNum,boolean>( );
    const state0 = notify.params[ 'input:0' ]?.state;
    const state1 = notify.params[ 'input:1' ]?.state;
    if ( state0 !== undefined ) {
        map.set( 0, state0 );
    }
    if ( state1 !== undefined ) {
        map.set( 1, state1 );
    }
    return map;
}
export function getRelayNotifyStates( notify: ShellyNotify ): Map<ShellyRelayNum,boolean> {
    const map = new Map<ShellyRelayNum,boolean>( );
    const state0 = notify.params[ 'switch:0' ]?.output;
    const state1 = notify.params[ 'switch:1' ]?.output;
    if ( state0 !== undefined ) {
        map.set( 0, state0 );
    }
    if ( state1 !== undefined ) {
        map.set( 1, state1 );
    }
    return map;
}

export type DoorState = 'FULLY_OPENED' | 'FULLY_CLOSED' | 'PARTWAY' | 'ERROR' | 'UNKNOWN';

export function getDoorState( conf: SiteBackendConf, sensorStates: Map<ShellySensorNum,boolean> ): DoorState {
    const isFullyOpened = ( sensorStates.get( conf.inputForDoorFullyOpened.sensor ) === conf.inputForDoorFullyOpened.state );
    const isFullyClosed = ( sensorStates.get( conf.inputForDoorFullyClosed.sensor ) === conf.inputForDoorFullyClosed.state );
    if ( isFullyOpened === undefined || isFullyClosed === undefined ) {
        return 'UNKNOWN';
    }
    else if ( isFullyOpened && !isFullyClosed ) {
        return 'FULLY_OPENED';
    }
    else if ( !isFullyOpened && isFullyClosed ) {
        return 'FULLY_CLOSED';
    }
    else if ( !isFullyOpened && !isFullyClosed ) {
        return 'PARTWAY';
    }
    else {
        return 'ERROR';
    }
}

export interface SseEvent {
    connectedToDevice: boolean;
    doorState: DoorState;
    cooldownState: boolean;
}
