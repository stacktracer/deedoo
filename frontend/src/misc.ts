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
