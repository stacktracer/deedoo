import { requireNonNullish } from './misc';
import { SseConnection } from './sse';

const host = requireNonNullish( document.getElementById( 'host' ) );

// FIXME: Balance prompt reconnect against phone battery wasting
// FIXME: Can we try frequently when location is near home?
// FIXME: Can we try frequently when on home wifi?
// FIXME: Can we try frequently when server IP addr is the local addr?
// FIXME: Can we try frequently when server IP addr is a local-cell-tower addr?
const events = new SseConnection( '../api/events', 1000 );

// TODO: Report available updates
// TODO: Report restart required

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

