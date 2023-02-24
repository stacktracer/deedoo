import { Disposable, Disposer, DisposerGroup } from "./disposer";

/**
 * Wrapper around EventSource that reconnects on failure. EventSource itself
 * has this behavior built-in on some browsers, but not on others.
 */
export class SseConnection {
    protected isConnected: boolean;
    protected readonly connectedListeners: Array<( ) => unknown>;
    protected readonly messageListeners: Array<( ev: MessageEvent ) => unknown>;
    protected readonly disposable: Disposable;

    constructor( url: string, millisBetweenReconnectAttempts: number ) {
        this.isConnected = false;
        this.connectedListeners = new Array( );
        this.messageListeners = new Array( );

        const setConnected = ( isConnected: boolean ) => {
            if ( isConnected !== this.isConnected ) {
                this.isConnected = isConnected;
                this.connectedListeners.forEach( f => f( ) );
            }
        };

        const disposers = new DisposerGroup( );
        SseConnection.connect(
            url,
            millisBetweenReconnectAttempts,
            disposers,
            ev => setConnected( true ),
            ev => this.messageListeners.forEach( f => f( ev ) ),
            ev => setConnected( false ),
        );

        this.disposable = disposers;
    }

    get connected( ): boolean {
        return this.isConnected;
    }

    addConnectedListener( listener: ( ) => unknown ): void {
        this.connectedListeners.push( listener );
    }

    addMessageListener( listener: ( ev: MessageEvent ) => unknown ): void {
        this.messageListeners.push( listener );
    }

    dispose( ): void {
        this.disposable.dispose( );
    }

    static connect(
        url: string,
        millisBetweenReconnectAttempts: number,
        disposers: DisposerGroup,
        fireOpen: ( this: EventSource, ev: Event ) => unknown,
        fireMessage: ( this: EventSource, ev: MessageEvent ) => unknown,
        fireError: ( this: EventSource, ev: Event ) => unknown,
    ): void {
        const eventSource = new EventSource( url );
        disposers.add( ( ) => {
            eventSource.close( );
        } );

        disposers.add( addEventSourceListener( eventSource, 'open', fireOpen ) );
        disposers.add( addEventSourceListener( eventSource, 'message', fireMessage ) );
        disposers.add( addEventSourceListener( eventSource, 'error', fireError ) );

        disposers.add( addEventSourceListener( eventSource, 'error', ( ) => {
            disposers.dispose( );
            disposers.add( setTimeout2( millisBetweenReconnectAttempts, ( ) => {
                SseConnection.connect( url, millisBetweenReconnectAttempts, disposers, fireOpen, fireMessage, fireError );
            } ) );
        } ) );
    }
}

function addEventSourceListener<K extends keyof EventSourceEventMap>( eventSource: EventSource, type: K, listener: ( this: EventSource, ev: EventSourceEventMap[K] ) => any, options?: boolean | AddEventListenerOptions ): Disposer {
    eventSource.addEventListener( type, listener, options );
    return ( ) => {
        eventSource.removeEventListener( type, listener, options );
    };
}

function setTimeout2( delay_MILLIS: number, fn: Function ): Disposer {
    const handle = setTimeout( fn, delay_MILLIS );
    return ( ) => {
        clearTimeout( handle );
    };
}
