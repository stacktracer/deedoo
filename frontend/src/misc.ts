import { Disposer } from './disposer';

export function isNullish( t: unknown ): t is null | undefined {
    return ( t === null || t === undefined );
}

export function requireNonNullish<T>( t: T | null | undefined ): T {
    if ( isNullish( t ) ) {
        throw new Error( );
    }
    return t;
}

/**
 * Returns true if this call modified the element's classList.
 */
export function setCssClassPresent( element: Element, className: string, wantPresent: boolean ): boolean {
    const alreadyPresent = element.classList.contains( className );
    if ( wantPresent && !alreadyPresent ) {
        element.classList.add( className );
        return true;
    }
    else if ( !wantPresent && alreadyPresent ) {
        element.classList.remove( className );
        return true;
    }
    return false;
}

export type DoorState = 'FULLY_OPENED' | 'FULLY_CLOSED' | 'PARTWAY' | 'ERROR' | 'UNKNOWN';

export interface SseEvent {
    connectedToDevice: boolean;
    doorState: DoorState;
    cooldownState: boolean;
}

export function attachEventSourceListener<K extends keyof EventSourceEventMap>( eventSource: EventSource, type: K, listener: ( this: EventSource, ev: EventSourceEventMap[K] ) => any, options?: boolean | AddEventListenerOptions ): Disposer {
    eventSource.addEventListener( type, listener, options );
    return ( ) => {
        eventSource.removeEventListener( type, listener, options );
    };
}

export function attachEventListener<K extends keyof WindowEventMap>( window: Window, type: K, useCapture: boolean, listener: ( this: Window, ev: WindowEventMap[K] ) => unknown ): Disposer;
export function attachEventListener<K extends keyof HTMLElementEventMap>( element: HTMLElement, type: K, useCapture: boolean, listener: ( this: HTMLElement, ev: HTMLElementEventMap[K] ) => unknown ): Disposer;
export function attachEventListener( source: GlobalEventHandlers, type: string, useCapture: boolean, listener: EventListenerOrEventListenerObject ): Disposer;
export function attachEventListener( source: GlobalEventHandlers, type: string, useCapture: boolean, listener: EventListenerOrEventListenerObject ): Disposer {
    source.addEventListener( type, listener, useCapture );
    return ( ) => {
        source.removeEventListener( type, listener, useCapture );
    };
}
