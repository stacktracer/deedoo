// Support
function dispose(disposer) {
    if (typeof disposer === 'function') {
        disposer();
    } else {
        disposer.dispose();
    }
}
class DisposerGroup {
    constructor() {
        this.members = new Set();
    }
    add(disposer) {
        this.members.add(disposer);
    }
    dispose() {
        // Delete in reverse insertion order
        for (const member of [...this.members].reverse()) {
            this.members.delete(member);
            dispose(member);
        }
    }
}
function isNullish(t) {
    return (t === null || t === undefined);
}
function requireNonNullish(t) {
    if (isNullish(t)) {
        throw new Error();
    }
    return t;
}
function setCssClassPresent(element, className, wantPresent) {
    const alreadyPresent = element.classList.contains(className);
    if (wantPresent && !alreadyPresent) {
        element.classList.add(className);
        return true;
    }
    else if (!wantPresent && alreadyPresent) {
        element.classList.remove(className);
        return true;
    }
    return false;
}
function attachEventListener(source, type, useCapture, listener) {
    source.addEventListener(type, listener, useCapture);
    return () => {
        source.removeEventListener(type, listener, useCapture);
    };
}
function startAsyncRepeating(delayMillis, getIntervalMillis, asyncFn) {
    // clearTimeout is not sufficient if fn does something async
    let running = true;

    // Initiate
    let handle = setTimeout(async function g() {
        if (running) {
            await asyncFn();
            if (running) {
                // Run again later
                const intervalMillis = getIntervalMillis();
                handle = setTimeout(g, intervalMillis);
            }
        }
    }, delayMillis);

    // Disposer
    return () => {
        running = false;
        clearTimeout(handle);
    };
}

// Application
export function attachUi(apiPrefix) {
    if (typeof apiPrefix !== 'string') {
        throw new Error(`Invalid apiPrefix ${apiPrefix}`);
    }

    const topDisposers = new DisposerGroup();

    const openedMessage = requireNonNullish(document.getElementById('opened-state'));
    const closeButton = requireNonNullish(document.getElementById('close-action'));
    const rawButton = requireNonNullish(document.getElementById('raw-action'));
    const openButton = requireNonNullish(document.getElementById('open-action'));
    const closedMessage = requireNonNullish(document.getElementById('closed-state'));

    const DOOR_STATE_UNSET = Object.freeze({
        status: '',
        timePmillis: Number.NEGATIVE_INFINITY,
        ageMillis: Number.POSITIVE_INFINITY,
        cooldownRemainingMillis: Number.POSITIVE_INFINITY,
    });

    let latestDoorState = DOOR_STATE_UNSET;
    let latestLocalClickPmillis = Number.NEGATIVE_INFINITY;
    function getCurrentPollingIntervalMillis() {
        // Opening typically takes about 12s, closing typically takes about 14s
        const fastPolling = (Date.now() <= latestLocalClickPmillis + 20000);
        return (fastPolling ? 50 : 1000);
    }
    function doUpdateUi() {
        const isDeviceConnected = (latestDoorState.ageMillis <= 75000);
        const isInCooldown = (latestDoorState.cooldownRemainingMillis > -200 || Date.now() <= latestLocalClickPmillis + 500);
        const status = latestDoorState.status;
        setCssClassPresent(openedMessage, 'hidden', !(isDeviceConnected && status === 'FULLY_OPENED'));
        setCssClassPresent(closeButton, 'disabled', !(isDeviceConnected && !isInCooldown && status === 'FULLY_OPENED'));
        setCssClassPresent(rawButton, 'disabled', !(isDeviceConnected && !isInCooldown));
        setCssClassPresent(openButton, 'disabled', !(isDeviceConnected && !isInCooldown && status === 'FULLY_CLOSED'));
        setCssClassPresent(closedMessage, 'hidden', !(isDeviceConnected && status === 'FULLY_CLOSED'));
    }
    function onLocalClick() {
        latestLocalClickPmillis = Date.now();
        doUpdateUi();
    }
    function onPoll(doorState) {
        if (doorState.timePmillis >= latestDoorState.timePmillis) {
            latestDoorState = doorState;
        }
        doUpdateUi();
    }
    function resetUi() {
        latestDoorState = DOOR_STATE_UNSET;
        latestLocalClickPmillis = Number.NEGATIVE_INFINITY;
        doUpdateUi();
    }
    doUpdateUi();

    function startPoller() {
        const disposers = new DisposerGroup();
        disposers.add(startAsyncRepeating(
            0,
            getCurrentPollingIntervalMillis,
            async () => {
                try {
                    const res = await fetch(`${apiPrefix}/door-state`, { method: 'GET', mode: 'same-origin', credentials: 'same-origin' });
                    const doorState = await res.json();
                    onPoll(doorState);
                } catch (e) {
                    doUpdateUi();
                }
            },
        ));
        disposers.add(resetUi);
        return disposers;
    }

    const pollerDisposers = new DisposerGroup();
    pollerDisposers.add(startPoller());
    topDisposers.add(pollerDisposers);
    topDisposers.add(
        attachEventListener(document, 'visibilitychange', false, () => {
            if (document.visibilityState === 'hidden') {
                pollerDisposers.dispose();
            }
            if (document.visibilityState === 'visible') {
                pollerDisposers.add(startPoller());
            }
        })
    );

    function postOnButton(button, postUrl) {
        const disposers = new DisposerGroup();
        let postOnRelease = false;
        disposers.add(attachEventListener(button, 'pointerdown', false, ev => {
            if (ev.button === 0) {
                postOnRelease = true;
                setCssClassPresent(button, 'pressed', true);
            }
        }));
        disposers.add(attachEventListener(button, 'pointercancel', false, ev => {
            postOnRelease = false;
            setCssClassPresent(button, 'pressed', false);
        }));
        disposers.add(attachEventListener(button, 'pointermove', false, ev => {
            const buttonBounds = button.getBoundingClientRect();
            const xInButton = ev.clientX - buttonBounds.left;
            const yInButton = ev.clientY - buttonBounds.top;
            const isInsideButton = (0 <= xInButton && xInButton < buttonBounds.width && 0 <= yInButton && yInButton < buttonBounds.height);
            if (!isInsideButton) {
                postOnRelease = false;
                setCssClassPresent(button, 'pressed', false);
            }
        }));
        disposers.add(attachEventListener(button, 'pointerup', false, ev => {
            if (ev.button === 0) {
                if (postOnRelease) {
                    setCssClassPresent(button, 'posting', true);
                    (async function () {
                        const resp = await fetch(postUrl, { method: 'POST', mode: 'same-origin', credentials: 'same-origin' });
                        setCssClassPresent(button, 'posting', false);
                        if (resp.ok) {
                            onLocalClick();
                        } else {
                            console.warn(`POST to ${postUrl} failed with status ${resp.status}`);
                            doUpdateUi();
                        }
                    })();
                }
                setCssClassPresent(button, 'pressed', false);
            }
        }));
        return disposers;
    }
    topDisposers.add(postOnButton(closeButton, `${apiPrefix}/close-door`));
    topDisposers.add(postOnButton(rawButton, `${apiPrefix}/raw-click`));
    topDisposers.add(postOnButton(openButton, `${apiPrefix}/open-door`));

    return topDisposers;
}
