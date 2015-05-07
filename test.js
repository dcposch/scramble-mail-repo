// TODO: unit tests for threading
// TODO: unit tests for search
// TODO: unit tests for retrieving a message or thread
// TODO: smoke tests for HTML sanitization (full unit tests are CAJA's job)

var test = require('tape')
var utils = require('./utils')

test('sql utils', function (t) {
  t.deepEqual(utils.nTimes('ho', 3), ['ho', 'ho', 'ho'])
  t.equal(utils.nQuestionMarks(4), '?,?,?,?')
  t.end()
})
