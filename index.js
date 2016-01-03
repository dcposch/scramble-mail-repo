var fs = require('fs')
var stream = require('stream')
var crypto = require('crypto')
var path = require('path')
var sqlite3 = require('sqlite3').verbose()
var MailParser = require('mailparser').MailParser
var concat = require('concat-stream')
var utils = require('./utils')

/**
 * Usage:
 *
 * var ScrambleMailRepo = require('scramble-mail-repo')
 * var repo = new ScrambleMailRepo('~/.app/mail-folder')
 * repo.search('climbing trip', function(err, results) { ... })
 */
module.exports = function (mailDir) {

  // When a mail-repo instance is created, the first thing we do is connect to SQLite
  var dbFilename = path.join(mailDir, 'index.sqlite')
  var db = new sqlite3.Database(dbFilename)
  initDatabase()

  function initDatabase () {
    // Create any new tables, or create all tables if DB was newly created
    var schemaFile = path.join(__dirname, 'schema.sql')
    var schemaSql = fs.readFileSync(schemaFile, {encoding: 'utf8'})
    // Don't run any other queries until the DB is initialized
    db.serialize(function () {
      db.exec(schemaSql, function (err) {
        if (err === null) {
          console.log('scramble-mail-repo: opened email DB ' + dbFilename)
        } else {
          console.error('scramble-mail-repo: error creating sqlite DB ' + dbFilename, err)
        }
      })
    })
  }

  /**
   * Generates a unique identifier.
   * (Gets 40 hex chars = 160 bits)
   */
  function generateUID () {
    return pseudoRandomHex(40)
  }

  /**
   * Returns a non-cryptographically-strong random hex string.
   */
  function pseudoRandomHex (numChars) {
    var buf = crypto.pseudoRandomBytes(numChars)
    return buf.toString('hex').substring(0, numChars)
  }

  /**
   * Uses the message's headers to figure out which thread it belongs to.
   * It tries In-Reply-To, then References.
   * Returns a thread ID present in the MessageThread table, possibly newly created.
   *
   * TODO: support threading by subject only, like Gmail?
   */
  function findOrCreateThread (scrambleMailId, mailObj, cb) {
    var msgId = mailObj.headers['message-id']
    var messageIds = [scrambleMailId].concat([msgId], mailObj.inReplyTo, mailObj.references)

    // Find or create in the MessageThread table
    db.all('select scrambleThreadId from MessageThread where messageId in (' +
        utils.nQuestionMarks(messageIds.length) + ')', messageIds, function (err, rows) {
      if (err) {
        return cb(err, null)
      }
      if (rows.length > 0) {
        // Found one or more existing thread IDs that match.  Use the latest one.
        return cb(null, rows[rows.length - 1].threadId)
      }
      // Create a new thread ID
      var threadId = generateUID()
      var queryArgs = []
      messageIds.forEach(function (messageId) {
        queryArgs.push(threadId, messageId)
      })
      db.run('insert or ignore into MessageThread (scrambleThreadId, messageId) values ' +
          utils.nTimes('(?, ?)', messageIds.length).join(','), queryArgs, function (err) {
        cb(err, threadId)
      })
    })
  }

  function saveMailObj (scrambleMailId, mailObj, cb) {
    findOrCreateThread(scrambleMailId, mailObj, function (err, scrambleThreadId) {
      if (err) {
        console.warn("Couldn't find or create an email thread for message " + scrambleMailId, err)
        return
      }
      saveMailObjInThread(scrambleMailId, scrambleThreadId, mailObj, cb)
    })
  }

  function saveMailObjInThread (scrambleMailId, scrambleThreadId, mailObj, cb) {
    var errs = []
    var numDone = 0
    var numQueries = 3
    var subCallback = function (err) {
      if (err) {
        errs.push(err)
      }
      if (++numDone === numQueries) {
        cb(errs[0] || null)
      }
    }

    var timestamp = new Date().toISOString()
    var messageId = mailObj.headers['message-id']
    var fromAddress = mailObj.headers['from']
    var toAddress = mailObj.headers['to']
    var ccAddress = mailObj.headers['cc']
    var bccAddress = mailObj.headers['bcc']
    var subject = mailObj.subject
    var snippet = mailObj.text
    db.run('insert or ignore into Message (scrambleMailId, scrambleThreadId, timestamp, messageId, ' +
    'fromAddress, toAddress, ccAddress, bccAddress, subject, snippet) ' +
    'values (?,?,?,?,?,?,?,?,?,?)',
      scrambleMailId, scrambleThreadId, timestamp, messageId,
      fromAddress, toAddress, ccAddress, bccAddress, subject, snippet, subCallback)

    // Index for full-text search
    var searchBody = subject + '\n\n' + mailObj.text
    db.run('insert into MessageSearch (scrambleMailId, subject, fromAddress, toAddress, searchBody) ' +
    'values (?,?,?,?,?)',
      scrambleMailId, subject, fromAddress, toAddress, searchBody, subCallback)

    // Update Contact
    var contacts = [mailObj.from, mailObj.to, mailObj.cc, mailObj.bcc].reduce(function (a, b) {
      return b ? a.concat(b) : a
    }, []).filter(function (contact) {
      return contact.address && contact.name
    })
    saveContacts(contacts, subCallback)
  }

  /**
   * Takes a list of named email addresses, each {address:..., name:...}
   * Makes sure each address exists in the Contact table.
   * Counts how often each name is used with a given address.
   */
  function saveContacts (contacts, cb) {
    var errs = []
    var numDone = 0
    var numQueries = 3 * contacts.length
    var subCallback = function (err) {
      if (err) {
        errs.push(err)
      }
      if (++numDone === numQueries) {
        cb(errs[0] || null)
      }
    }

    var stmtC = db.prepare('insert or ignore into Contact (emailAddress) values (?)')
    var stmtCN = db.prepare('insert or ignore into ContactName (emailAddress, name, numMessages) values (?,?,0)')
    var stmtCNInc = db.prepare('update ContactName set numMessages=numMessages+1 where emailAddress=? and name=?')
    contacts.forEach(function (contact) {
      var addr = contact.address.toLowerCase()
      stmtC.run(addr, subCallback)
      stmtCN.run(addr, contact.name, subCallback)
      stmtCNInc.run(addr, contact.name, subCallback)
    })
    stmtC.finalize()
    stmtCN.finalize()
    stmtCNInc.finalize()
  }

  /**
   * Saves a raw RFC2822 email.
   *
   * The first argument can be either a string or a stream.
   * The stream should be ASCII encoded.
   *
   * The second argument is a callback(err, mailObj). It is not called until
   * the email has been successfully written to disk.
   **/
  this.saveRawEmail = function (email, cb) {
    // Read stream to string, if necessary
    if (email instanceof stream.Readable) {
      var concatStream = concat(function (emailStr) {
        saveRawEmailString(emailStr, cb)
      })
      email.pipe(concatStream)
    } else if (typeof email === 'string') {
      saveRawEmailString(email, cb)
    } else {
      throw new Error('Expected readable stream or string, got ' + email)
    }
  }

  /**
   * See saveRawEmail
   */
  function saveRawEmailString (emailStr, cb) {
    // Parse and write to index
    var mailparser = new MailParser()
    mailparser.on('headers', function (headers) {
      // TODO: handle headers and body separately?
    })
    mailparser.on('error', function (err) {
      console.warn('scramble-mail-repo: error parsing email', err)
      cb(err, null)
    })
    mailparser.on('end', function (mailObj) {
      var scrambleMailId = generateUID()

      saveMailToFile(scrambleMailId, emailStr)
      saveMailObj(scrambleMailId, mailObj, cb)
    })
    mailparser.write(emailStr)
    mailparser.end()
  }

  /**
   * Saves a text file with the whole RFC2722 message.
   * The name is <scramble mail id>.txt
   */
  function saveMailToFile (scrambleMailId, emailStr) {
    var fileName = getMailFileName(scrambleMailId)
    fs.writeFileSync(fileName, emailStr)
  }

  function getMailFileName (scrambleMailId) {
    return path.join(mailDir, scrambleMailId + '.txt')
  }

  /**
   * Email full-text search. See README for query syntax.
   *
   * The limit and offset args are optional.
   * The callback takes (err, array of email objs).
   * If err is non-null, the array will be empty.
   */
  this.search = function (query, limit, offset, cb) {
    if (arguments.length === 2) {
      cb = limit
      limit = 10
      offset = 0
    }
    console.log("scramble-mail-repo: searching messages. query '%s' offset %d limit %d",
        query, offset, limit)
    if (query === '') {
      db.all('select * from Message order by timestamp desc limit ? offset ?',
        limit, offset, messageRowsCallback.bind(null, cb))
    } else {
      db.all('select scrambleMailId, fromAddress, toAddress, subject, ' +
        'snippet(MessageSearch) as snippet ' +
        'from MessageSearch ' +
        'where searchBody match ? ' +
        'limit ? offset ?',
      query, limit, offset, function (err, msgSearchRows) {
        if (err) {
          console.warn('scramble-mail-repo: search query error', err)
          return cb(err, [])
        }
        var mailIds = msgSearchRows.map(function (x) { return x.scrambleMailId })
        db.all('select * from Message ' +
          "where scrambleMailId in ('" + mailIds.join("','") + "')",
          messageRowsCallback.bind(null, cb))
      })
    }
  }

  /**
   * Email full-text search. See README for query syntax.
   *
   * The limit and offset args are optional.
   * The callback takes (err, array of thread objs).
   * If err is non-null, the array will be empty.
   */
  this.searchThreads = function (query, limit, offset, cb) {
    if (arguments.length === 2) {
      cb = limit
      limit = 10
      offset = 0
    }
    console.log("scramble-mail-repo: searching threads. query '%s' offset %d limit %d",
        query, offset, limit)
    if (query === '') {
      db.all('select ' +
          '  scrambleThreadId, ' +
          '  group_concat(scrambleMailId) as scrambleMailIds, ' +
          '  group_concat(replace(fromAddress,","," ")) as fromAddresses, ' +
          '  min(subject) as subject, ' +
          '  max(timestamp) as latestTimestamp, ' +
          '  min(snippet) as snippet ' +
          'from Message ' +
          'group by scrambleThreadId ' +
          'order by timestamp desc limit ? offset ?',
        limit, offset, threadRowsCallback.bind(null, cb))
    } else {
      db.all('select ' +
          '  m.scrambleThreadId, ' +
          '  group_concat(ms.scrambleMailId) as scrambleMailIds, ' +
          '  group_concat(replace(fromAddress,","," ")) as fromAddresses, ' +
          '  min(subject) as subject, ' +
          '  max(m.timestamp) as latestTimestamp, ' +
          '  max(snip) as snippet ' +
          'from Message m ' +
          'inner join (' +
          '  select scrambleMailId, snippet(MessageSearch) as snip ' +
          '  from MessageSearch where searchBody match ? ' +
          '  limit ? ' +
          ') ms ' +
          'on m.scrambleMailId=ms.scrambleMailId ' +
          'group by m.scrambleThreadId ' +
          'limit ? offset ?',
        query, (limit + offset) * 10, limit, offset,
        threadRowsCallback.bind(null, cb))
    }
  }

  this.getThread = function (threadId, cb) {
    db.all('select * from Message where scrambleThreadId=?', threadId, function (err, rows) {
      var numFinished = 0, errs = [], sanitizedMessages = []
      if (err) {
        errs.push(err)
      }
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i]
        this.getMessage(row.scrambleMailId, function (err, sanitizedMessage) {
          if (err !== null) {
            errs.push(err)
          } else {
            sanitizedMessages.push(sanitizedMessage)
          }
          if (++numFinished === rows.length) {
            var thread = {
              scrambleThreadId: threadId,
              sanitizedMessages: sanitizedMessages
            }
            cb(errs[0] || null, thread)
          }
        })
      }
    }.bind(this))
  }

  /**
   * Fetches the unique message with the given ID.
   * Calls cb(err, message)
   * Exactly one of err or message will be null.
   */
  this.getMessage = function (mailId, cb) {
    var filename = getMailFileName(mailId)
    var emailStr = fs.readFileSync(filename, {'encoding': 'ascii'})

    var mailparser = new MailParser()
    mailparser.on('error', function (err) {
      console.warn('scramble-mail-repo: error parsing email', err)
      cb(err, null)
    })
    mailparser.on('end', function (mailObj) {
      // TODO: run thru CAJA to sanitize
      var sanitizedHtmlBody = mailObj.html || mailObj.text.replace(/\n/g, '<br/>')
      cb(null, {
        scrambleMailId: mailId,
        rawEmail: emailStr,
        from: mailObj.from,
        to: mailObj.to,
        cc: mailObj.cc,
        bcc: mailObj.bcc,
        subject: mailObj.subject,
        textBody: mailObj.text,
        sanitizedHtmlBody: sanitizedHtmlBody
      })
    })
    mailparser.write(emailStr)
    mailparser.end()
  }
}

/**
 * Receives message rows from the DB,
 * sends back messages to client.
 */
function messageRowsCallback (cb, err, rows) {
  if (err) {
    console.warn('scramble-mail-repo: query error', err)
    return cb(err, [])
  }
  console.log('scramble-mail-repo: found %d messages', rows.length)
  return cb(null, rows)
}

/**
 * Receives thread rows from the DB (ie, from a GROUP BY scrambleThreadId query),
 * sends back thread objects to the client.
 */
function threadRowsCallback (cb, err, rows) {
  if (err) {
    console.warn('scramble-mail-repo: query error', err)
    return cb(err, [])
  }
  console.log('scramble-mail-repo: found %d threads', rows.length)
  var threads = rows.map(function (row) {
    // Scramble mail IDs are guaranteed not to contain commas, so simply
    // splitting the result of the Sqlite GROUP_CONCAT clause works
    // Furthermore, scrambleMailIds is guaranteed not to be empty.
    var scrambleMailIds = row.scrambleMailIds.split(',')
    // Same here
    var fromAddresses = row.fromAddresses.split(',')
    // TODO: even though Sqlite3's FTS module should return clean HTML
    // from the SNIPPET function, we should still run this through CAJA
    // whitelisting only the <b> tag.
    var sanitizedSnippetHTML = row.snippet
    return {
      scrambleThreadId: row.scrambleThreadId,
      scrambleMailIds: scrambleMailIds,
      subject: row.subject,
      fromAddresses: fromAddresses,
      latestTimestamp: row.latestTimestamp,
      sanitizedSnippetHTML: sanitizedSnippetHTML
    }
  })
  return cb(null, threads)
}
