/*
 * Libre Glucose watchface - phone side.
 *
 * Logs into the LibreLinkUp (Libre "follower") API, polls the latest
 * glucose reading + 12h history and pushes it to the watch.
 */

'use strict';

var Clay = require('pebble-clay');
var clayConfig = require('./config');
var sha256 = require('./sha256');

var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

// Status codes understood by the watch
var STATUS_OK = 0;
var STATUS_NO_CONFIG = 1;
var STATUS_LOGIN_FAILED = 2;
var STATUS_NETWORK_ERROR = 3;
var STATUS_NO_CONNECTION = 4;
var STATUS_ACCEPT_TERMS = 5;

var GRAPH_POINTS = 48;
var GRAPH_INTERVAL = 900; // 15 min buckets -> 12 hours

var LLU_VERSION = '4.12.0';
var LLU_PRODUCT = 'llu/android';

var s_timer = null;
var s_fetching = false;

// ---------------------------------------------------------------- settings

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('lg_settings')) || {};
  } catch (e) {
    return {};
  }
}

function saveSettings(s) {
  localStorage.setItem('lg_settings', JSON.stringify(s));
}

function loadAuth() {
  try {
    return JSON.parse(localStorage.getItem('lg_auth')) || {};
  } catch (e) {
    return {};
  }
}

function saveAuth(a) {
  localStorage.setItem('lg_auth', JSON.stringify(a));
}

function clearAuth() {
  localStorage.removeItem('lg_auth');
}

// Convert the raw Clay response into our settings object
function applyClaySettings(dict) {
  function val(key) {
    var v = dict[key];
    if (v && typeof v === 'object' && 'value' in v) {
      v = v.value;
    }
    return v;
  }

  var unitsMmol = String(val('UNITS_MMOL')) === '1';

  function threshold(key, fallbackMgdl) {
    var raw = parseFloat(val(key));
    if (isNaN(raw) || raw <= 0) {
      return fallbackMgdl;
    }
    // Entered in display units; store mg/dL internally.
    // Values under 40 can only be mmol/L.
    if (unitsMmol || raw < 40) {
      return Math.round(raw * 18);
    }
    return Math.round(raw);
  }

  var settings = {
    email: (val('EMAIL') || '').trim(),
    password: val('PASSWORD') || '',
    region: val('REGION') || '',
    unitsMmol: unitsMmol,
    lowMgdl: threshold('LOW_MGDL', 72),
    highMgdl: threshold('HIGH_MGDL', 180),
    alertLow: !!+val('ALERT_LOW'),
    alertHigh: !!+val('ALERT_HIGH'),
    refreshMin: parseInt(val('REFRESH'), 10) || 5
  };
  saveSettings(settings);
  return settings;
}

// ---------------------------------------------------------------- HTTP

function baseUrl(region) {
  return 'https://api' + (region ? '-' + region : '') + '.libreview.io';
}

function request(method, url, body, auth, cb) {
  var xhr = new XMLHttpRequest();
  xhr.open(method, url);
  xhr.timeout = 15000;
  xhr.setRequestHeader('accept', 'application/json');
  xhr.setRequestHeader('content-type', 'application/json');
  xhr.setRequestHeader('product', LLU_PRODUCT);
  xhr.setRequestHeader('version', LLU_VERSION);
  if (auth && auth.token) {
    xhr.setRequestHeader('authorization', 'Bearer ' + auth.token);
    if (auth.accountIdHash) {
      xhr.setRequestHeader('account-id', auth.accountIdHash);
    }
  }
  xhr.onload = function() {
    var json = null;
    try {
      json = JSON.parse(xhr.responseText);
    } catch (e) {
      // fall through with null
    }
    cb(null, xhr.status, json);
  };
  xhr.onerror = function() { cb(new Error('network'), 0, null); };
  xhr.ontimeout = function() { cb(new Error('timeout'), 0, null); };
  xhr.send(body ? JSON.stringify(body) : null);
}

// ---------------------------------------------------------------- LibreLinkUp

function login(settings, cb, redirectCount) {
  redirectCount = redirectCount || 0;
  var auth = loadAuth();
  var region = auth.region || settings.region || '';

  request('POST', baseUrl(region) + '/llu/auth/login',
    { email: settings.email, password: settings.password }, null,
    function(err, status, json) {
      if (err || !json) {
        return cb(STATUS_NETWORK_ERROR);
      }
      if (json.status === 2 || status === 401 || status === 403) {
        return cb(STATUS_LOGIN_FAILED);
      }
      if (json.status === 4 ||
          (json.data && json.data.step && json.data.step.type)) {
        // Account has outstanding terms/privacy step to accept
        return cb(STATUS_ACCEPT_TERMS);
      }
      if (json.data && json.data.redirect && json.data.region) {
        if (redirectCount >= 3) {
          return cb(STATUS_LOGIN_FAILED);
        }
        auth.region = json.data.region;
        saveAuth(auth);
        return login(settings, cb, redirectCount + 1);
      }
      if (json.status !== 0 || !json.data || !json.data.authTicket) {
        return cb(STATUS_LOGIN_FAILED);
      }
      auth.token = json.data.authTicket.token;
      auth.expires = json.data.authTicket.expires || 0;
      auth.region = region || auth.region || '';
      if (json.data.user && json.data.user.id) {
        auth.accountIdHash = sha256(String(json.data.user.id));
      }
      saveAuth(auth);
      cb(STATUS_OK, auth);
    });
}

function ensureAuth(settings, cb) {
  var auth = loadAuth();
  var now = Math.floor(Date.now() / 1000);
  if (auth.token && (!auth.expires || auth.expires > now + 300)) {
    return cb(STATUS_OK, auth);
  }
  login(settings, cb);
}

function ensurePatient(settings, auth, cb) {
  if (auth.patientId) {
    return cb(STATUS_OK, auth);
  }
  request('GET', baseUrl(auth.region) + '/llu/connections', null, auth,
    function(err, status, json) {
      if (err) {
        return cb(STATUS_NETWORK_ERROR);
      }
      if (status === 401) {
        return cb(-1); // token expired -> retry from login
      }
      if (!json || json.status !== 0 || !json.data) {
        return cb(STATUS_NETWORK_ERROR);
      }
      if (!json.data.length) {
        return cb(STATUS_NO_CONNECTION);
      }
      auth.patientId = json.data[0].patientId;
      saveAuth(auth);
      cb(STATUS_OK, auth);
    });
}

function fetchGraph(auth, cb) {
  request('GET',
    baseUrl(auth.region) + '/llu/connections/' + auth.patientId + '/graph',
    null, auth,
    function(err, status, json) {
      if (err) {
        return cb(STATUS_NETWORK_ERROR);
      }
      if (status === 401) {
        return cb(-1);
      }
      if (!json || json.status !== 0 || !json.data || !json.data.connection) {
        return cb(STATUS_NETWORK_ERROR);
      }
      cb(STATUS_OK, json.data);
    });
}

// "8/2/2026 1:15:30 PM" (FactoryTimestamp, UTC) -> epoch seconds
function parseFactoryTs(s) {
  var m = /(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)\s*(AM|PM)?/i.exec(s || '');
  if (!m) {
    return 0;
  }
  var h = +m[4];
  if (m[7]) {
    h = h % 12;
    if (/pm/i.test(m[7])) {
      h += 12;
    }
  }
  return Math.floor(Date.UTC(+m[3], +m[1] - 1, +m[2], h, +m[5], +m[6]) / 1000);
}

function pointValue(p) {
  if (!p) {
    return 0;
  }
  if (typeof p.ValueInMgPerDl === 'number') {
    return Math.round(p.ValueInMgPerDl);
  }
  return 0;
}

// ---------------------------------------------------------------- send

function sendToWatch(dict, label) {
  Pebble.sendAppMessage(dict, function() {
    console.log('Sent ' + label);
  }, function() {
    // One retry - AppMessage can fail while the watchface is (re)loading
    setTimeout(function() {
      Pebble.sendAppMessage(dict, function() {}, function() {
        console.log('Failed to send ' + label);
      });
    }, 1000);
  });
}

function sendStatus(code) {
  // Don't wipe out a recent good reading with a transient network error
  if (code === STATUS_NETWORK_ERROR) {
    var lastOk = parseInt(localStorage.getItem('lg_last_ok') || '0', 10);
    if (Date.now() - lastOk < 10 * 60 * 1000) {
      console.log('Suppressing transient network error');
      return;
    }
  }
  sendToWatch({ STATUS: code }, 'status ' + code);
}

function sendData(settings, data) {
  var gm = data.connection.glucoseMeasurement;
  if (!gm) {
    return sendStatus(STATUS_NETWORK_ERROR);
  }

  var now = Math.floor(Date.now() / 1000);
  var start = now - GRAPH_INTERVAL * (GRAPH_POINTS - 1);
  var graph = [];
  for (var i = 0; i < GRAPH_POINTS; i++) {
    graph.push(0);
  }

  var history = data.graphData || [];
  var lastHistVal = 0;
  var lastHistTs = 0;
  for (i = 0; i < history.length; i++) {
    var p = history[i];
    var v = pointValue(p);
    var ts = parseFactoryTs(p.FactoryTimestamp || p.Timestamp);
    if (!v || !ts) {
      continue;
    }
    var idx = Math.round((ts - start) / GRAPH_INTERVAL);
    if (idx >= 0 && idx < GRAPH_POINTS) {
      graph[idx] = Math.min(255, Math.round(v / 2));
    }
    if (ts > lastHistTs) {
      lastHistTs = ts;
      lastHistVal = v;
    }
  }

  var current = pointValue(gm);
  var readingTs = parseFactoryTs(gm.FactoryTimestamp || gm.Timestamp) || now;
  var curIdx = Math.round((readingTs - start) / GRAPH_INTERVAL);
  if (current && curIdx >= 0 && curIdx < GRAPH_POINTS) {
    graph[curIdx] = Math.min(255, Math.round(current / 2));
  }

  var delta = 0;
  if (current && lastHistVal && lastHistTs < readingTs) {
    delta = current - lastHistVal;
  }

  var trend = gm.TrendArrow;
  if (!(trend >= 1 && trend <= 5)) {
    trend = 3;
  }

  localStorage.setItem('lg_last_ok', String(Date.now()));

  sendToWatch({
    STATUS: STATUS_OK,
    GLUCOSE_MGDL: current,
    TREND: trend,
    DELTA_MGDL: delta,
    READING_TS: readingTs,
    UNITS_MMOL: settings.unitsMmol ? 1 : 0,
    LOW_MGDL: settings.lowMgdl,
    HIGH_MGDL: settings.highMgdl,
    ALERT_LOW: settings.alertLow ? 1 : 0,
    ALERT_HIGH: settings.alertHigh ? 1 : 0,
    GRAPH_START_TS: start,
    GRAPH_INTERVAL: GRAPH_INTERVAL,
    GRAPH_DATA: graph
  }, 'glucose ' + current);
}

// ---------------------------------------------------------------- main flow

function refresh(isRetry) {
  var settings = loadSettings();
  if (!settings.email || !settings.password) {
    return sendStatus(STATUS_NO_CONFIG);
  }
  if (s_fetching && !isRetry) {
    return;
  }
  s_fetching = true;

  function done(code) {
    s_fetching = false;
    if (code === -1 && !isRetry) {
      // Token rejected - login again once
      clearAuthToken();
      return refresh(true);
    }
    if (code !== STATUS_OK) {
      sendStatus(code === -1 ? STATUS_LOGIN_FAILED : code);
    }
  }

  function clearAuthToken() {
    var auth = loadAuth();
    delete auth.token;
    delete auth.expires;
    saveAuth(auth);
  }

  ensureAuth(settings, function(code, auth) {
    if (code !== STATUS_OK) {
      return done(code);
    }
    ensurePatient(settings, auth, function(code2, auth2) {
      if (code2 !== STATUS_OK) {
        return done(code2);
      }
      fetchGraph(auth2, function(code3, data) {
        if (code3 !== STATUS_OK) {
          return done(code3);
        }
        s_fetching = false;
        sendData(settings, data);
      });
    });
  });
}

function schedule() {
  var settings = loadSettings();
  var minutes = settings.refreshMin || 5;
  if (s_timer) {
    clearInterval(s_timer);
  }
  s_timer = setInterval(refresh, minutes * 60 * 1000);
}

// ---------------------------------------------------------------- events

Pebble.addEventListener('ready', function() {
  console.log('Libre Glucose PKJS ready');
  refresh();
  schedule();
});

Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response) {
    return;
  }
  var dict = clay.getSettings(e.response);
  applyClaySettings(dict);
  // Credentials or region may have changed - start from a clean login
  clearAuth();
  refresh();
  schedule();
});
