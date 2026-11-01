let clickSwitchId = 0;
let clickDurationSec = 2;

function getDoorState() {
  let sensor0 = Shelly.getComponentStatus("input", 0);
  let sensor1 = Shelly.getComponentStatus("input", 1);
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

function initMqtt(config, errorCode, errorMsg) {
  if (errorCode !== 0 || !config) {
    print("MQTT.GetConfig failed:", errorMsg);
    return;
  }
  let prefix = config.topic_prefix || Shelly.getDeviceInfo().id;
  print("Will use MQTT prefix " + prefix);

  // Available operations
  let cooldownEndUptimeMs = Shelly.getUptimeMs();
  function publishState() {
    if (MQTT.isConnected()) {
      let msg = {
        doorState: getDoorState(),
        cooldownRemainingMillis: cooldownEndUptimeMs - Shelly.getUptimeMs(),
      };
      MQTT.publish(prefix + "/door-state", JSON.stringify(msg), 1, true);
    }
  }
  function doClick() {
    let nowUptimeMs = Shelly.getUptimeMs();
    if (nowUptimeMs >= cooldownEndUptimeMs) {
      Shelly.call("Switch.Set", { id: clickSwitchId, on: true });
      cooldownEndUptimeMs = nowUptimeMs + 1000*clickDurationSec + 200;
      publishState();
    }
  }

  // Outbound state publishing
  publishState();
  Shelly.addStatusHandler(function(status) {
    if ((status.component === "input:0" || status.component === "input:1") && status.delta.state !== undefined) {
      publishState();
    }
  });
  MQTT.setConnectHandler(function() {
    publishState();
  });
  Timer.set(60000, true, function() {
    publishState();
  });

  // Inbound command handling
  MQTT.subscribe(prefix + "/open-door", function() {
    if (getDoorState() === 'FULLY_CLOSED') {
      doClick();
    }
  });
  MQTT.subscribe(prefix + "/close-door", function() {
    if (getDoorState() === 'FULLY_OPENED') {
      doClick();
    }
  });
  MQTT.subscribe(prefix + "/click", function() {
    doClick();
  });
}

Shelly.call(
  "Switch.SetConfig",
  {
    id: clickSwitchId,
    config: {
      in_mode: "detached",
      initial_state: "off",
      auto_on: false,
      auto_off: true,
      auto_off_delay: clickDurationSec,
    }
  },
  function(result, errorCode, errorMsg) {
    if (errorCode !== 0) {
      print("Switch.SetConfig failed:", errorMsg);
    } else {
      Shelly.call("MQTT.GetConfig", {}, initMqtt);
    }
  },
);
