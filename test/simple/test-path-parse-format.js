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

var assert = require('assert');
var path = require('path');

var winPaths = [
  'C:\\path\\dir\\index.html',
  'C:\\another_path\\DIR\\1\\2\\33\\index',
  'another_path\\DIR with spaces\\1\\2\\33\\index',

  // unc
  '\\\\server\\share\\file_path',
  '\\\\server two\\shared folder\\file path.zip',
  '\\\\teela\\admin$\\system32'

];

var unixPaths = [
  '/home/user/dir/file.txt',
  '/home/user/a dir/another File.zip',
  '/home/user/a dir//another&File.',
  '/home/user/a$$$dir//another File.zip',
  'user/dir/another File.zip'
];

check(path.win32, winPaths);
check(path.posix, unixPaths);

function check(path, paths) {
  paths.forEach(function(element, index, array) {
    var count = index + 1;
    console.log(count + ': `' + element + '`');
    var output = path.parse(element);
    var keys = Object.keys(output);
    var values = [];
    for (var i = 0; i < Object.keys(output).length; i++) {
      values.push(output[keys[i]]);
    }

    assert.strictEqual(path.format(path.parse(element)), element);
    assert.strictEqual(path.parse(element).dir, path.dirname(element));
    assert.strictEqual(path.parse(element).base, path.basename(element));
    assert.strictEqual(path.parse(element).ext, path.extname(element));
  })
}
