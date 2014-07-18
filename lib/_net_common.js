var TCP, Pipe, tty;

var util = require('util');

var debug = util.debuglog('net');

module.exports = {
  isPipe: isPipe,
  isPipeName: isPipeName,
  toNumber: toNumber,
  createTCP: createTCP,
  createPipe: createPipe,
  createHandle: createHandle,
  normalizeConnectArgs: normalizeConnectArgs
};

function noop() {
}

function toNumber(x) {
  return (x = Number(x)) >= 0 ? x : false;
}

function createPipe() {
  return new Pipe();
}

function createTCP() {
  TCP = TCP || process.binding('tcp_wrap').TCP;
  return new TCP();
}

function isPipe(handle) {
  Pipe = Pipe || process.binding('pipe_wrap').Pipe;
  return handle instanceof Pipe;
}

function createHandle(fd) {
  tty = tty || process.bind('tty_wrap');

  var type = tty.guessHandleType(fd);
  switch(type) {
    case 'PIPE': return createPipe();
    case 'TCP': return createTCP();
    default: throw new TypeError('Unsupported fd type: ' + type);
  }
}

// Returns an array [options] or [options, cb]
// It is the same as the argument of Socket.prototype.connect().
function normalizeConnectArgs(args) {
  var options = {};

  if (util.isObject(args[0])) {
    // connect(options, [cb])
    options = args[0];
  } else if (isPipeName(args[0])) {
    // connect(path, [cb]);
    options.path = args[0];
  } else {
    // connect(port, [host], [cb])
    options.port = args[0];
    if (util.isString(args[1])) {
      options.host = args[1];
    }
  }

  var cb = args[args.length - 1];
  return util.isFunction(cb) ? [options, cb] : [options];
}

function isPipeName(s) {
  return util.isString(s) && toNumber(s) === false;
}
