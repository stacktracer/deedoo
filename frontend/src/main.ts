import { requireNonNullish, setCssClassPresent, SseEvent } from './misc';

const openButton = requireNonNullish( document.getElementById( 'open-action' ) );
const rawButton = requireNonNullish( document.getElementById( 'raw-action' ) );
const closeButton = requireNonNullish( document.getElementById( 'close-action' ) );
const openedMessage = requireNonNullish( document.getElementById( 'opened-state' ) );
const closedMessage = requireNonNullish( document.getElementById( 'closed-state' ) );

setCssClassPresent( openButton, 'disabled', true );
setCssClassPresent( closeButton, 'disabled', true );
setCssClassPresent( rawButton, 'disabled', true );
setCssClassPresent( openedMessage, 'hidden', true );
setCssClassPresent( closedMessage, 'hidden', true );

// TODO: Can we promptly auto-reconnect without draining a phone battery?
const eventSource = new EventSource( '../api/events' );
eventSource.addEventListener( 'message', ev => {
    const msg = JSON.parse( ev.data ) as SseEvent;
    setCssClassPresent( openButton, 'disabled', !msg.connectedToDevice || msg.cooldownState || msg.doorState !== 'FULLY_CLOSED' );
    setCssClassPresent( closeButton, 'disabled', !msg.connectedToDevice || msg.cooldownState || msg.doorState !== 'FULLY_OPENED' );
    setCssClassPresent( rawButton, 'disabled', !msg.connectedToDevice );
    setCssClassPresent( openedMessage, 'hidden', !( msg.connectedToDevice && msg.doorState === 'FULLY_OPENED' ) );
    setCssClassPresent( closedMessage, 'hidden', !( msg.connectedToDevice && msg.doorState === 'FULLY_CLOSED' ) );
} );
eventSource.addEventListener( 'error', ( ) => {
    setCssClassPresent( openButton, 'disabled', true );
    setCssClassPresent( closeButton, 'disabled', true );
    setCssClassPresent( rawButton, 'disabled', true );
    setCssClassPresent( openedMessage, 'hidden', true );
    setCssClassPresent( closedMessage, 'hidden', true );
} );

// TODO: Report available updates
// TODO: Report restart required

function onPostButton( url: string ): EventListener {
    return async ( ) => {
        fetch( url, { method: 'POST', mode: 'same-origin', credentials: 'same-origin' } );
    };
}
openButton.addEventListener( 'click', onPostButton( '../api/open' ) );
closeButton.addEventListener( 'click', onPostButton( '../api/close' ) );
rawButton.addEventListener( 'click', onPostButton( '../api/raw-click' ) );
