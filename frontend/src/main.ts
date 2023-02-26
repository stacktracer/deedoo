import { requireNonNullish, setCssClassPresent, SseEvent } from './misc';
import { SseConnection } from './sse';

const openButton = requireNonNullish( document.getElementById( 'open' ) );
const clickButton = requireNonNullish( document.getElementById( 'click' ) );
const closeButton = requireNonNullish( document.getElementById( 'close' ) );

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
    const msg = JSON.parse( ev.data ) as SseEvent;
    setCssClassPresent( openButton, 'disabled', !msg.connectedToDevice || msg.cooldownState || msg.doorState !== 'FULLY_CLOSED' );
    setCssClassPresent( closeButton, 'disabled', !msg.connectedToDevice || msg.cooldownState || msg.doorState !== 'FULLY_OPEN' );
    setCssClassPresent( clickButton, 'disabled', !msg.connectedToDevice );
} );

openButton.addEventListener( 'click', ( ) => fetch( '../api/open', { method: 'POST', mode: 'same-origin', credentials: 'same-origin' } ) );
closeButton.addEventListener( 'click', ( ) => fetch( '../api/close', { method: 'POST', mode: 'same-origin', credentials: 'same-origin' } ) );
clickButton.addEventListener( 'click', ( ) => fetch( '../api/click', { method: 'POST', mode: 'same-origin', credentials: 'same-origin' } ) );
