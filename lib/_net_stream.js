var stream = require('stream')
var Pipe = process.binding('pipe_wrap').Pipe;

// constructor for lazy loading
function createPipe() {
  return new Pipe();
}

// constructor for lazy loading
function createTCP() {
  var TCP = process.binding('tcp_wrap').TCP;
  return new TCP();
}


function createHandle(fd) {
  var tty = process.binding('tty_wrap');
  var type = tty.guessHandleType(fd);
  if (type === 'PIPE') return createPipe();
  if (type === 'TCP') return createTCP();
  throw new TypeError('Unsupported fd type: ' + type);
}

function Server(opts) {
  if(!(this instanceof Server)) {
    return new Server(opts);
  }

  var readableOpts = {
    objectMode: true,
    highWaterMark: opts.highWaterMark || 512,
  };

  stream.Readable.call(this, readableOpts);
}

util.inherits(Server, stream.Readable)

var proto = Server.prototype
