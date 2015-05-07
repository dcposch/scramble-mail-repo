/**
 * Returns an array of n elements, eg nTimes(5, 2) returns [5, 5]
 */
function nTimes (x, n) {
  // Note new Array(n).map(function() { return x }) doesn't work due to JS quirks :/
  var ret = new Array(n)
  for (var i = 0; i < n; i++) {
    ret[i] = x
  }
  return ret
}

/**
 * Returns question marks, eg "?,?,?".
 * Helper method, use it to add a list of escaped values to a SQL query.
 */
function nQuestionMarks (n) {
  return nTimes('?', n).join(',')
}

module.exports = {
  nTimes: nTimes,
  nQuestionMarks: nQuestionMarks
}
