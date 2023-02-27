import type { AsyncMqttClient } from 'async-mqtt';
import type { AddressInfo } from 'net';
import os from 'os';
import url from 'url';
import type { Disposer } from './disposer';

export interface DeedooConf {
    https: HttpsConf;
    mqtt: MqttConf;
    shelly: ShellyConf;
    behavior: BehaviorConf;
}

export interface HttpsConf {
    host: string;
    port: number;
    certFile: string;
    keyFile: string;
    cookieSigningSecret: string;
    auth: Record<string,string>;
}

export interface MqttConf {
    protocol: string;
    host: string;
    port: number;
    clientId: string;
    username: string;
    password: string;
}

export interface ShellyConf {
    deviceName: string;
    inputForDoorFullyOpened: { sensor: ShellySensorNum, state: boolean };
    inputForDoorFullyClosed: { sensor: ShellySensorNum, state: boolean };
    outputForClick: { relay: ShellyRelayNum, state: boolean, duration: number };
}

export interface BehaviorConf {
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

export function log( s: string ): void {
    console.log( '[' + formatTs( 1e-3*Date.now( ) ) + '] ' + s );
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
                log( `Listening at ${ifaceUrl} (${ifaceName})` );
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
        log( `Listening at ${addrUrl} (???)` );
    }
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

export type ShellySensorNum = 0 | 1;
export type ShellyRelayNum = 0 | 1;

export function sendShellyStatusRequest( mqtt: AsyncMqttClient, shellyDevice: string ): Promise<void> {
    return mqtt.publish( `${shellyDevice}/rpc`, JSON.stringify( {
        id: 0,
        method: 'Shelly.GetStatus',
        src: `${shellyDevice}/events`,
    } ), { qos: 2 } );
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

let shellyRecentClick = {};
export async function sendShellyClick( mqtt: AsyncMqttClient, conf: ShellyConf ): Promise<void> {
    await mqtt.publish( `${conf.deviceName}/rpc`, JSON.stringify( {
        method: 'Switch.Set',
        params: {
            id: conf.outputForClick.relay,
            on: conf.outputForClick.state,
        },
    } ), { qos: 2 } );

    const thisClick = {};
    shellyRecentClick = thisClick;
    setTimeout2( 1e3*conf.outputForClick.duration, async ( ) => {
        if ( shellyRecentClick === thisClick ) {
            await mqtt.publish( `${conf.deviceName}/rpc`, JSON.stringify( {
                method: 'Switch.Set',
                params: {
                    id: conf.outputForClick.relay,
                    on: !conf.outputForClick.state,
                },
            } ), { qos: 2 } );
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

export function getDoorState( conf: ShellyConf, sensorStates: Map<ShellySensorNum,boolean> ): DoorState {
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
