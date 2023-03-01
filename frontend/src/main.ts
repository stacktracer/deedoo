import { Disposer, DisposerGroup } from './disposer';
import { attachEventListener, attachEventSourceListener, requireNonNullish, setCssClassPresent, SseEvent } from './misc';

const openedMessage = requireNonNullish( document.getElementById( 'opened-state' ) );
const closeButton = requireNonNullish( document.getElementById( 'close-action' ) );
const rawButton = requireNonNullish( document.getElementById( 'raw-action' ) );
const openButton = requireNonNullish( document.getElementById( 'open-action' ) );
const closedMessage = requireNonNullish( document.getElementById( 'closed-state' ) );

function setSseDisconnected( ): void {
    setCssClassPresent( openedMessage, 'hidden', true );
    setCssClassPresent( closeButton, 'disabled', true );
    setCssClassPresent( rawButton, 'disabled', true );
    setCssClassPresent( openButton, 'disabled', true );
    setCssClassPresent( closedMessage, 'hidden', true );
}
setSseDisconnected( );

function addSseListeners( ): Disposer {
    const disposers = new DisposerGroup( );
    const eventSource = new EventSource( '../api/events' );
    disposers.add( ( ) => {
        setSseDisconnected( );
        eventSource.close( );
    } );
    disposers.add( attachEventSourceListener( eventSource, 'message', ev => {
        const msg = JSON.parse( ev.data ) as SseEvent;
        setCssClassPresent( openedMessage, 'hidden', !( msg.connectedToDevice && msg.doorState === 'FULLY_OPENED' ) );
        setCssClassPresent( closeButton, 'disabled', !( msg.connectedToDevice && !msg.cooldownState && msg.doorState === 'FULLY_OPENED' ) );
        setCssClassPresent( rawButton, 'disabled', !( msg.connectedToDevice ) );
        setCssClassPresent( openButton, 'disabled', !( msg.connectedToDevice && !msg.cooldownState && msg.doorState === 'FULLY_CLOSED' ) );
        setCssClassPresent( closedMessage, 'hidden', !( msg.connectedToDevice && msg.doorState === 'FULLY_CLOSED' ) );
    } ) );
    disposers.add( attachEventSourceListener( eventSource, 'error', ( ) => {
        setSseDisconnected( );
    } ) );
    return disposers;
}

const sseDisposers = new DisposerGroup( );
sseDisposers.add( addSseListeners( ) );
document.addEventListener( 'visibilitychange', ( ) => {
    if ( document.visibilityState === 'hidden' ) {
        sseDisposers.dispose( );
    }
    if ( document.visibilityState === 'visible' ) {
        sseDisposers.add( addSseListeners( ) );
    }
} );

// TODO: Report available updates
// TODO: Report restart required

function postOnButton( button: HTMLElement, postUrl: string ): Disposer {
    const disposers = new DisposerGroup( );

    let postOnRelease = false;
    disposers.add( attachEventListener( button, 'pointerdown', false, ev => {
        if ( ev.button === 0 ) {
            postOnRelease = true;
            setCssClassPresent( button, 'pressed', true );
        }
    } ) );
    disposers.add( attachEventListener( button, 'pointercancel', false, ev => {
        postOnRelease = false;
        setCssClassPresent( button, 'pressed', false );
    } ) );
    disposers.add( attachEventListener( button, 'pointermove', false, ev => {
        const buttonBounds = button.getBoundingClientRect( );
        const xInButton = ev.clientX - buttonBounds.left;
        const yInButton = ev.clientY - buttonBounds.top;
        const isInsideButton = ( 0 <= xInButton && xInButton < buttonBounds.width && 0 <= yInButton && yInButton < buttonBounds.height );
        if ( !isInsideButton ) {
            postOnRelease = false;
            setCssClassPresent( button, 'pressed', false );
        }
    } ) );
    disposers.add( attachEventListener( button, 'pointerup', false, ev => {
        if ( ev.button === 0 ) {
            if ( postOnRelease ) {
                setCssClassPresent( button, 'posting', true );
                ( async function( ) {
                    const resp = await fetch( postUrl, { method: 'POST', mode: 'same-origin', credentials: 'same-origin' } );
                    setCssClassPresent( button, 'posting', false );
                    if ( !resp.ok ) {
                        // FIXME
                    }
                } )( );
            }
            setCssClassPresent( button, 'pressed', false );
        }
    } ) );

    return disposers;
}
postOnButton( closeButton, '../api/close' );
postOnButton( rawButton, '../api/raw-click' );
postOnButton( openButton, '../api/open' );
