let clickSwitchId = 0;
let clickDurationSec = 2;
let numRecentCmdIds = 16;
let maxCmdAgeMillis = 5000;

function getDoorState() {
    let sensor0 = Shelly.getComponentStatus('input', 0);
    let sensor1 = Shelly.getComponentStatus('input', 1);
    let isOpenAny = sensor0 && sensor0.state;
    let isOpenFully = sensor1 && sensor1.state;
    if (isOpenAny === true && isOpenFully === true) {
        return 'FULLY_OPENED';
    } else if (isOpenAny === false && isOpenFully === false) {
        return 'FULLY_CLOSED';
    } else if (isOpenAny === true && isOpenFully === false) {
        return 'PARTWAY';
    } else {
        return 'ERROR';
    }
}

function parseCommand(payload) {
    let cmd = JSON.parse(payload);
    if (!cmd) {
        throw new Error();
    }
    if (typeof cmd.createdPmillis !== 'number' || !isFinite(cmd.createdPmillis)) {
        throw new Error();
    }
    if (typeof cmd.id !== 'string' || cmd.id.length !== 36) {
        throw new Error();
    }
    if (cmd.action !== 'open' && cmd.action !== 'close' && cmd.action !== 'click') {
        throw new Error();
    }
    return cmd;
}

function initMqtt(config, errorCode, errorMsg) {
    if (errorCode !== 0 || !config) {
        print('MQTT.GetConfig failed:', errorMsg);
        return;
    }
    let prefix = config.topic_prefix || Shelly.getDeviceInfo().id;
    print('Will use MQTT prefix ' + prefix);

    // Available operations
    let cooldownEndUptimeMs = Shelly.getUptimeMs();
    function publishState() {
        if (MQTT.isConnected()) {
            let msg = {
                doorState: getDoorState(),
                cooldownRemainingMillis: cooldownEndUptimeMs - Shelly.getUptimeMs(),
            };
            MQTT.publish(prefix + '/door-state', JSON.stringify(msg), 1, true);
        }
    }
    function doClick() {
        let nowUptimeMs = Shelly.getUptimeMs();
        if (nowUptimeMs >= cooldownEndUptimeMs) {
            Shelly.call(
                'Switch.Set',
                { id: clickSwitchId, on: true },
                function (result, errorCode, errorMsg) {
                    if (errorCode !== 0) {
                        print('Switch.Set failed:', errorMsg);
                    }
                },
            );
            cooldownEndUptimeMs = nowUptimeMs + 1000 * clickDurationSec + 200;
            publishState();
        }
    }

    // Outbound state publishing
    publishState();
    Shelly.addStatusHandler(function (status) {
        if ((status.component === 'input:0' || status.component === 'input:1') && status.delta.state !== undefined) {
            publishState();
        }
    });
    MQTT.setConnectHandler(function () {
        publishState();
    });
    Timer.set(60000, true, function () {
        publishState();
    });

    // Inbound command handling
    let recentCmdIds = [];
    let nextRecentCmdIdIndex = 0;
    MQTT.subscribe(prefix + '/door-command', function (topic, payload) {
        // Parse command
        let cmd;
        try {
            cmd = parseCommand(payload);
        } catch (e) {
            print('Ignoring invalid door command');
            return;
        }

        // Ignore time-late commands
        let sys = Shelly.getComponentStatus('sys');
        if (!sys || typeof sys.unixtime !== 'number') {
            print('Ignoring door command because device clock is not synced');
            return;
        }
        let cmdAgeMillis = sys.unixtime*1000 - cmd.createdPmillis;
        if (cmdAgeMillis > maxCmdAgeMillis) {
            print('Ignoring time-late door command');
            return;
        }
        if (cmdAgeMillis < -maxCmdAgeMillis) {
            print('Ignoring door command from the future');
            return;
        }

        // Ignore commands we've seen recently
        if (recentCmdIds.indexOf(cmd.id) !== -1) {
            print('Ignoring duplicate door command');
            return;
        }

        // Remember recent command ids
        recentCmdIds[nextRecentCmdIdIndex] = cmd.id;
        nextRecentCmdIdIndex = (nextRecentCmdIdIndex + 1) % numRecentCmdIds;

        // Handle command
        switch (cmd.action) {
            case 'open': {
                if (getDoorState() === 'FULLY_CLOSED') {
                    doClick();
                }
                break;
            }
            case 'close': {
                if (getDoorState() === 'FULLY_OPENED') {
                    doClick();
                }
                break;
            }
            case 'click': {
                doClick();
                break;
            }
        }
    });
}

Shelly.call(
    'Switch.SetConfig',
    {
        id: clickSwitchId,
        config: {
            in_mode: 'detached',
            initial_state: 'off',
            auto_on: false,
            auto_off: true,
            auto_off_delay: clickDurationSec,
        }
    },
    function (result, errorCode, errorMsg) {
        if (errorCode !== 0) {
            print('Switch.SetConfig failed:', errorMsg);
        } else {
            Shelly.call('MQTT.GetConfig', {}, initMqtt);
        }
    },
);
