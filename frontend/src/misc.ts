export function isNullish( t: unknown ): t is null | undefined {
    return ( t === null || t === undefined );
}

export function requireNonNullish<T>( t: T | null | undefined ): T {
    if ( isNullish( t ) ) {
        throw new Error( );
    }
    return t;
}
