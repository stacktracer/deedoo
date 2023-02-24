import { requireNonNullish } from './misc';
import { SseConnection } from './sse';

const host = requireNonNullish( document.getElementById( 'host' ) );

const events = new SseConnection( '../api/events', 1000 );

events.addConnectedListener( ( ) => {
    // FIXME
    //events.connected
} );

events.addMessageListener( ev => {
    // FIXME
    //const msg = JSON.parse( ev.data );
    const p = document.createElement( 'p' );
    p.textContent = ev.data;
    host.appendChild( p );
} );

