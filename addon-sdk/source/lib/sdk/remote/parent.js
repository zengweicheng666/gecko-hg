/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { isChildLoader } = require('./core');
if (isChildLoader)
  throw new Error("Cannot load sdk/remote/parent in a child loader.");

const { Cu, Ci, Cc } = require('chrome');
const runtime = require('../system/runtime');

const MAIN_PROCESS = Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT;

if (runtime.processType != MAIN_PROCESS) {
  throw new Error('Cannot use sdk/remote/parent in a child process.');
}

const { Class } = require('../core/heritage');
const { Namespace } = require('../core/namespace');
const { Disposable } = require('../core/disposable');
const { omit } = require('../util/object');
const { when } = require('../system/unload');
const { EventTarget } = require('../event/target');
const { emit } = require('../event/core');
const system = require('../system/events');
const { EventParent } = require('./utils');
const options = require('@loader/options');
const loaderModule = require('toolkit/loader');
const { getTabForBrowser } = require('../tabs/utils');

// Chose the right function for resolving relative a module id
let moduleResolve;
if (options.isNative) {
  moduleResolve = (id, requirer) => loaderModule.nodeResolve(id, requirer, { rootURI: options.rootURI });
}
else {
  moduleResolve = loaderModule.resolve;
}
// Build the sorted path mapping structure that resolveURI requires
let pathMapping = Object.keys(options.paths)
                        .sort((a, b) => b.length - a.length)
                        .map(p => [p, options.paths[p]]);

// Load the scripts in the child processes
let { getNewLoaderID } = require('../../framescript/FrameScriptManager.jsm');
let PATH = options.paths[''];

const childOptions = omit(options, ['modules', 'globals']);
childOptions.modules = {};
// @l10n/data is just JSON data and can be safely sent across to the child loader
try {
  childOptions.modules["@l10n/data"] = require("@l10n/data");
}
catch (e) {
  // There may be no l10n data
}
const loaderID = getNewLoaderID();
childOptions.loaderID = loaderID;
childOptions.childLoader = true;

const ppmm = Cc['@mozilla.org/parentprocessmessagemanager;1'].
             getService(Ci.nsIMessageBroadcaster);
const gmm = Cc['@mozilla.org/globalmessagemanager;1'].
            getService(Ci.nsIMessageBroadcaster);

const ns = Namespace();

let processMap = new Map();

function processMessageReceived({ target, data }) {
  if (data.loaderID != loaderID)
    return;
  let [event, ...args] = data.args;
  emit(this.port, event, this, ...args);
}

// Process represents a gecko process that can load webpages. Each process
// contains a number of Frames. This class is used to send and receive messages
// from a single process.
const Process = Class({
  implements: [ Disposable ],
  extends: EventTarget,
  setup: function(id, messageManager, isRemote) {
    ns(this).id = id;
    ns(this).isRemote = isRemote;
    ns(this).messageManager = messageManager;
    ns(this).messageReceived = processMessageReceived.bind(this);
    this.destroy = this.destroy.bind(this);
    ns(this).messageManager.addMessageListener('sdk/remote/process/message', ns(this).messageReceived);
    ns(this).messageManager.addMessageListener('child-process-shutdown', this.destroy);

    this.port = new EventTarget();
    this.port.emit = (...args) => {
      ns(this).messageManager.sendAsyncMessage('sdk/remote/process/message', {
        loaderID,
        args
      });
    };

    // Load any remote modules
    for (let module of remoteModules.values())
      this.port.emit('sdk/remote/require', module);

    processMap.set(ns(this).id, this);
    processes.attachItem(this);
  },

  dispose: function() {
    emit(this, 'detach', this);
    processMap.delete(ns(this).id);
    ns(this).messageManager.removeMessageListener('sdk/remote/process/message', ns(this).messageReceived);
    ns(this).messageManager.removeMessageListener('child-process-shutdown', this.destroy);
    ns(this).messageManager = null;
  },

  // Returns true if this process is a child process
  get isRemote() {
    return ns(this).isRemote;
  }
});

// Processes gives an API for enumerating an sending and receiving messages from
// all processes as well as detecting when a new process starts.
const Processes = Class({
  implements: [ EventParent ],
  extends: EventTarget,
  initialize: function() {
    EventParent.prototype.initialize.call(this);

    this.port = new EventTarget();
    this.port.emit = (...args) => {
      ppmm.broadcastAsyncMessage('sdk/remote/process/message', {
        loaderID,
        args
      });
    };
  },

  getById: function(id) {
    return processMap.get(id);
  }
});
let processes = exports.processes = new Processes();

let frameMap = new Map();

function frameMessageReceived({ target, data }) {
  if (data.loaderID != loaderID)
    return;
  let [event, ...args] = data.args;
  emit(this.port, event, this, ...args);
}

function setFrameProcess(frame, process) {
  ns(frame).process = process;
  frames.attachItem(frame);
}

// Frames display webpages in a process. In the main process every Frame is
// linked with a <browser> or <iframe> element. 
const Frame = Class({
  implements: [ Disposable ],
  extends: EventTarget,
  setup: function(id, node) {
    ns(this).id = id;
    ns(this).node = node;

    let frameLoader = node.QueryInterface(Ci.nsIFrameLoaderOwner).frameLoader;
    ns(this).messageManager = frameLoader.messageManager;

    ns(this).messageReceived = frameMessageReceived.bind(this);
    ns(this).messageManager.addMessageListener('sdk/remote/frame/message', ns(this).messageReceived);

    this.port = new EventTarget();
    this.port.emit = (...args) => {
      ns(this).messageManager.sendAsyncMessage('sdk/remote/frame/message', {
        loaderID,
        args
      });
    };

    frameMap.set(ns(this).messageManager, this);
  },

  dispose: function() {
    emit(this, 'detach', this);
    ns(this).messageManager.removeMessageListener('sdk/remote/frame/message', ns(this).messageReceived);
    ns(this).messageManager = null;

    frameMap.delete(ns(this).messageManager);
  },

  // Returns the browser or iframe element this frame displays in
  get frameElement() {
    return ns(this).node;
  },

  // Returns the process that this frame loads in
  get process() {
    return ns(this).process;
  },

  // Returns true if this frame is a tab in a main browser window
  get isTab() {
    let tab = getTabForBrowser(ns(this).node);
    return !!tab;
  }
});

function managerDisconnected({ subject: manager }) {
  let frame = frameMap.get(manager);
  if (frame)
    frame.destroy();
}
system.on('message-manager-disconnect', managerDisconnected);

// Provides an API for enumerating and sending and receiving messages from all
// Frames
const FrameList = Class({
  implements: [ EventParent ],
  extends: EventTarget,
  initialize: function() {
    EventParent.prototype.initialize.call(this);

    this.port = new EventTarget();
    this.port.emit = (...args) => {
      gmm.broadcastAsyncMessage('sdk/remote/frame/message', {
        loaderID,
        args
      });
    };
  },

  // Returns the frame for a browser element
  getFrameForBrowser: function(browser) {
    for (let frame of this) {
      if (frame.frameElement == browser)
        return frame;
    }
    return null;
  }
});
let frames = exports.frames = new FrameList();

// Create the module loader in any existing processes
ppmm.broadcastAsyncMessage('sdk/remote/process/load', {
  modulePath: PATH,
  loaderID,
  options: childOptions,
  reason: "broadcast"
});

// A loader has started in a remote process
function processLoaderStarted({ target, data }) {
  if (data.loaderID != loaderID)
    return;

  if (processMap.has(data.processID)) {
    console.error("Saw the same process load the same loader twice. This is a bug in the SDK.");
    return;
  }

  let process = new Process(data.processID, target, data.isRemote);

  if (pendingFrames.has(data.processID)) {
    for (let frame of pendingFrames.get(data.processID))
      setFrameProcess(frame, process);
    pendingFrames.delete(data.processID);
  }
}

// A new process has started
function processStarted({ target, data: { modulePath } }) {
  if (modulePath != PATH)
    return;

  // Have it load a loader if it hasn't already
  target.sendAsyncMessage('sdk/remote/process/load', {
    modulePath,
    loaderID,
    options: childOptions,
    reason: "response"
  });
}

let pendingFrames = new Map();

// A new frame has been created in the remote process
function frameAttached({ target, data }) {
  if (data.loaderID != loaderID)
    return;

  let frame = new Frame(data.frameID, target);

  let process = processMap.get(data.processID);
  if (process) {
    setFrameProcess(frame, process);
    return;
  }

  // In some cases frame messages can arrive earlier than process messages
  // causing us to see a new frame appear before its process. In this case
  // cache the frame data until we see the process. See bug 1131375.
  if (!pendingFrames.has(data.processID))
    pendingFrames.set(data.processID, [frame]);
  else
    pendingFrames.get(data.processID).push(frame);
}

// Wait for new processes and frames
ppmm.addMessageListener('sdk/remote/process/attach', processLoaderStarted);
ppmm.addMessageListener('sdk/remote/process/start', processStarted);
gmm.addMessageListener('sdk/remote/frame/attach', frameAttached);

when(reason => {
  ppmm.removeMessageListener('sdk/remote/process/attach', processLoaderStarted);
  ppmm.removeMessageListener('sdk/remote/process/start', processStarted);
  gmm.removeMessageListener('sdk/remote/frame/attach', frameAttached);

  ppmm.broadcastAsyncMessage('sdk/remote/process/unload', { loaderID, reason });
});

let remoteModules = new Set();

// Ensures a module is loaded in every child process. It is safe to send 
// messages to this module immediately after calling this.
// Pass a module to resolve the id relatively.
function remoteRequire(id, module = null) {
  // Resolve relative to calling module if passed
  if (module)
    id = moduleResolve(id, module.id);
  let uri = loaderModule.resolveURI(id, pathMapping);

  // Don't reload the same module
  if (remoteModules.has(uri))
    return;

  remoteModules.add(uri);
  processes.port.emit('sdk/remote/require', uri);
}
exports.remoteRequire = remoteRequire;
