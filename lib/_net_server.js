// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var util = require('util');
var stream = require('stream');
var assert = require('assert');
var common = require('_net_common');
var uv = process.binding('uv');
var cluster;
var Socket;

var debug = util.debuglog('net');
var errnoException = util._errnoException;

// import common items:
var isPipeName = common.isPipeName;
var toNumber = common.toNumber;
var createTCP = common.createTCP;
var createPipe = common.createPipe;
var createHandle = common.createHandle;

function ServerConsumer(opts) {
  if (!(this instanceof ServerConsumer)) {
    return new ServerConsumer(opts);
  }

  var writableOptions = {
      objectMode: true,
      highWaterMark: 128
  };

  stream.Writable.call(this, writableOptions);
  this.maxConnections = opts.maxConnections || Infinity;
  this._numConnections = 0;
}

util.inherits(ServerConsumer, stream.Writable);

ServerConsumer.prototype._write = function(conn, enc, ready) {
  if(!conn._handle) {
    return ready();
  }

  if(this._numConnections >= this.maxConnections) {
    conn._handle.close();
    return;
  }

  var self = this;
  ++self._numConnections;

  self.emit('connection', conn);

  conn.once('close', function() {
    --self._numConnections;
    ready();
  });
}

function Server(/* [ options, ] listener */) {
  if (!(this instanceof Server)) return new Server(arguments[0], arguments[1]);

  var self = this;

  var listener;
  var options;

  if (util.isFunction(arguments[0])) {
    options = {};
    listener = arguments[0];
  } else {
    options = arguments[0] || {};
    if (util.isFunction(arguments[1])) {
      listener = arguments[1];
    }
  }

  stream.Readable.call(this, {
    highWaterMark: options.highWaterMark || 128,
    objectMode: true
  });

  if (listener) {
    self.on('connection', listener);
  }

  this._connections = 0;

  Object.defineProperty(this, 'connections', {
    get: util.deprecate(function() {

      if (self._usingSlaves) {
        return null;
      }
      return self._connections;
    }, 'connections property is deprecated. Use getConnections() method'),
    set: util.deprecate(function(val) {
      return (self._connections = val);
    }, 'connections property is deprecated. Use getConnections() method'),
    configurable: true, enumerable: true
  });

  this._handle = null;
  this._usingSlaves = false;
  this._slaves = [];
  this.maxConnections = options.maxConnections;
  this.allowHalfOpen = options.allowHalfOpen || false;
}
util.inherits(Server, stream.Readable);
exports.Server = Server;


function toNumber(x) { return (x = Number(x)) >= 0 ? x : false; }

function _listen(handle, backlog) {
  // Use a backlog of 512 entries. We pass 511 to the listen() call because
  // the kernel does: backlogsize = roundup_pow_of_two(backlogsize + 1);
  // which will thus give us a backlog of 512 entries.
  return handle.listen(backlog || 511);
}

var createServerHandle = exports._createServerHandle =
    function(address, port, addressType, fd) {
  var err = 0;
  // assign handle in listen, and clean up if bind or listen fails
  var handle;

  var isTCP = false;
  if (util.isNumber(fd) && fd >= 0) {
    try {
      handle = createHandle(fd);
    }
    catch (e) {
      // Not a fd we can listen on.  This will trigger an error.
      debug('listen invalid fd=' + fd + ': ' + e.message);
      return uv.UV_EINVAL;
    }
    handle.open(fd);
    handle.readable = true;
    handle.writable = true;
    assert(!address && !port);
  } else if (port === -1 && addressType === -1) {
    handle = createPipe();
    if (process.platform === 'win32') {
      var instances = parseInt(process.env.NODE_PENDING_PIPE_INSTANCES);
      if (!isNaN(instances)) {
        handle.setPendingInstances(instances);
      }
    }
  } else {
    handle = createTCP();
    isTCP = true;
  }

  if (address || port || isTCP) {
    debug('bind to ' + (address || 'anycast'));
    if (!address) {
      // Try binding to ipv6 first
      err = handle.bind6('::', port);
      if (err) {
        handle.close();
        // Fallback to ipv4
        return createServerHandle('0.0.0.0', port);
      }
    } else if (addressType === 6) {
      err = handle.bind6(address, port);
    } else {
      err = handle.bind(address, port);
    }
  }

  if (err) {
    handle.close();
    return err;
  }

  if (process.platform === 'win32') {
    // On Windows, we always listen to the socket before sending it to
    // the worker (see uv_tcp_duplicate_socket). So we better do it here
    // so that we can handle any bind-time or listen-time errors early.
    err = _listen(handle);
    if (err) {
      handle.close();
      return err;
    }
  }

  return handle;
};


Server.prototype._listen2 = function(address, port, addressType, backlog, fd) {
  debug('listen2', address, port, addressType, backlog);
  var self = this;

  var alreadyListening = false;

  // If there is not yet a handle, we need to create one and bind.
  // In the case of a server sent via IPC, we don't need to do this.
  if (!self._handle) {
    debug('_listen2: create a handle');
    var rval = createServerHandle(address, port, addressType, fd);
    if (util.isNumber(rval)) {
      var error = errnoException(rval, 'listen');
      process.nextTick(function() {
        self.emit('error', error);
      });
      return;
    }
    alreadyListening = (process.platform === 'win32');
    self._handle = rval;
  } else {
    debug('_listen2: have a handle already');
  }

  self._handle.onconnection = onconnection;
  self._handle.owner = self;

  var err = 0;
  if (!alreadyListening)
    err = _listen(self._handle, backlog);

  if (err) {
    var ex = errnoException(err, 'listen');
    self._handle.close();
    self._handle = null;
    process.nextTick(function() {
      self.emit('error', ex);
    });
    return;
  }

  // generate connection key, this should be unique to the connection
  this._connectionKey = addressType + ':' + address + ':' + port;

  process.nextTick(function() {
    // ensure handle hasn't closed
    if (self._handle) {
      self.emit('listening');

      if (self._readableState.pipesCount === 0) {
        self.pipe(new ServerConsumer({
            maxConnections: self.maxConnections
        })).on('connection', function(conn) {
          self.emit('connection', conn);
        });
      }
    }
  });
};


function listen(self, address, port, addressType, backlog, fd) {
  if (!cluster) cluster = require('cluster');

  if (cluster.isMaster) {
    self._listen2(address, port, addressType, backlog, fd);
    return;
  }

  cluster._getServer(self, address, port, addressType, fd, cb);

  function cb(err, handle) {
    // EADDRINUSE may not be reported until we call listen(). To complicate
    // matters, a failed bind() followed by listen() will implicitly bind to
    // a random port. Ergo, check that the socket is bound to the expected
    // port before calling listen().
    //
    // FIXME(bnoordhuis) Doesn't work for pipe handles, they don't have a
    // getsockname() method. Non-issue for now, the cluster module doesn't
    // really support pipes anyway.
    if (err === 0 && port > 0 && handle.getsockname) {
      var out = {};
      err = handle.getsockname(out);
      if (err === 0 && port !== out.port)
        err = uv.UV_EADDRINUSE;
    }

    if (err)
      return self.emit('error', errnoException(err, 'bind'));

    self._handle = handle;
    self._listen2(address, port, addressType, backlog, fd);
  }
}


Server.prototype.listen = function() {
  var self = this;

  var lastArg = arguments[arguments.length - 1];
  if (util.isFunction(lastArg)) {
    self.once('listening', lastArg);
  }

  var port = toNumber(arguments[0]);

  // The third optional argument is the backlog size.
  // When the ip is omitted it can be the second argument.
  var backlog = toNumber(arguments[1]) || toNumber(arguments[2]);

  var TCP = process.binding('tcp_wrap').TCP;

  if (arguments.length == 0 || util.isFunction(arguments[0])) {
    // Bind to a random port.
    listen(self, null, 0, null, backlog);

  } else if (arguments[0] && util.isObject(arguments[0])) {
    var h = arguments[0];
    if (h._handle) {
      h = h._handle;
    } else if (h.handle) {
      h = h.handle;
    }
    if (h instanceof TCP) {
      self._handle = h;
      listen(self, null, -1, -1, backlog);
    } else if (util.isNumber(h.fd) && h.fd >= 0) {
      listen(self, null, null, null, backlog, h.fd);
    } else {
      throw new Error('Invalid listen argument: ' + h);
    }
  } else if (isPipeName(arguments[0])) {
    // UNIX socket or Windows pipe.
    var pipeName = self._pipeName = arguments[0];
    listen(self, pipeName, -1, -1, backlog);

  } else if (util.isUndefined(arguments[1]) ||
             util.isFunction(arguments[1]) ||
             util.isNumber(arguments[1])) {
    // The first argument is the port, no IP given.
    listen(self, null, port, 4, backlog);

  } else {
    // The first argument is the port, the second an IP.
    require('dns').lookup(arguments[1], function(err, ip, addressType) {
      if (err) {
        self.emit('error', err);
      } else {
        listen(self, ip, port, ip ? addressType : 4, backlog);
      }
    });
  }
  return self;
};

Server.prototype.address = function() {
  if (this._handle && this._handle.getsockname) {
    var out = {};
    var err = this._handle.getsockname(out);
    // TODO(bnoordhuis) Check err and throw?
    return out;
  } else if (this._pipeName) {
    return this._pipeName;
  } else {
    return null;
  }
};

Server.prototype._read = function(n) {
  doRead(this, n);
}

function doRead(server, n) {
  if(!server._handle) {
    return
  }

  var connections = server._handle.readConnections(n);

  if(!connections.length) {
    // next onconnect should immediately _read
    return;
  }

  for(var i = 0, len = connections.length; i < len; ++i) {
    if(connections[i]) {
      server.push(materializeHandle(server, connections[i]))
    }
  }
}

function materializeHandle(server, clientHandle) {
  Socket = Socket || require('_net_socket').Socket;

  var socket = new Socket({
      handle: clientHandle,
      allowHalfOpen: server.allowHalfOpen
  });
  socket.readable = socket.writable = true;
  socket.server = server;

  return socket;
}

function onconnection(err) {
  var handle = this;
  var self = handle.owner;

  debug('onconnection');

  if (err) {
    self.emit('error', errnoException(err, 'accept'));
    return;
  }
}

Server.prototype.getConnections = function(cb) {
  function end(err, connections) {
    process.nextTick(function() {
      cb(err, connections);
    });
  }

  if (!this._usingSlaves) {
    return end(null, this._connections);
  }

  // Poll slaves
  var left = this._slaves.length,
      total = this._connections;

  function oncount(err, count) {
    if (err) {
      left = -1;
      return end(err);
    }

    total += count;
    if (--left === 0) return end(null, total);
  }

  this._slaves.forEach(function(slave) {
    slave.getConnections(oncount);
  });
};


Server.prototype.close = function(cb) {
  function onSlaveClose() {
    if (--left !== 0) return;

    self._connections = 0;
    self._emitCloseIfDrained();
  }

  if (cb) {
    if (!this._handle) {
      this.once('close', function() {
        cb(new Error('Not running'));
      });
    } else {
      this.once('close', cb);
    }
  }

  if (this._handle) {
    this._handle.close();
    this._handle = null;
  }

  if (this._usingSlaves) {
    var self = this,
        left = this._slaves.length;

    // Increment connections to be sure that, even if all sockets will be closed
    // during polling of slaves, `close` event will be emitted only once.
    this._connections++;

    // Poll slaves
    this._slaves.forEach(function(slave) {
      slave.close(onSlaveClose);
    });
  } else {
    this._emitCloseIfDrained();
  }

  return this;
};

Server.prototype._emitCloseIfDrained = function() {
  debug('SERVER _emitCloseIfDrained');
  var self = this;

  if (self._handle || self._connections) {
    debug('SERVER handle? %j   connections? %d',
          !!self._handle, self._connections);
    return;
  }

  process.nextTick(function() {
    debug('SERVER: emit close');
    self.emit('close');
  });
};


Server.prototype.listenFD = util.deprecate(function(fd, type) {
  return this.listen({ fd: fd });
}, 'listenFD is deprecated. Use listen({fd: <number>}).');

Server.prototype._setupSlave = function(socketList) {
  this._usingSlaves = true;
  this._slaves.push(socketList);
};

Server.prototype.ref = function() {
  if (this._handle)
    this._handle.ref();
};

Server.prototype.unref = function() {
  if (this._handle)
    this._handle.unref();
};


exports.createServer = function() {
  return new Server(arguments[0], arguments[1]);
};
