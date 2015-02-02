var fs = require('fs');
var stream = require('stream');
var crypto = require('crypto');
var path = require('path');
var sqlite3 = require('sqlite3').verbose();
var MailParser = require('mailparser').MailParser;

module.exports = function (dir) {
  var dbFilename = path.join(dir, 'index.sqlite');
  console.log('Opening ' + dbFilename);
  var db = new sqlite3.Database(dbFilename);
  initDatabase();

  function initDatabase () {
    // Create any new tables, or create all tables if DB was newly created
    var schemaFile = path.join(__dirname, 'schema.sql');
    var schemaSql = fs.readFileSync(schemaFile, {encoding: 'utf8'});
    // Don't run any other queries until the DB is initialized
    db.serialize(function () {
      db.exec(schemaSql, function (err) {
        if (err === null) {
          console.log('Created the email index sqlite DB successfully');
        } else {
          console.error('Error creating sqlite DB ' + dbFilename, err);
        }
      });
    });
  }

  /**
   * Returns a non-cryptographically-strong random string.
   * Length n base64 chars, so 6n bits.
   */
  function pseudoRandomBase64 (numChars) {
    var buf = crypto.pseudoRandomBytes(numChars);
    return buf.toString('base64').substring(0, numChars);
  }

  function saveMailObj (mailObj, cb) {
    var errs = [];
    var numDone = 0;
    var numQueries = 3;
    var subCallback = function (err) {
      if (err) {
        errs.push(err);
      }
      if (++numDone === numQueries) {
        cb(errs[0] || null);
      }
    };

    // Insert Message
    var messageId = mailObj.headers['message-id'] || null;
    var scrambleMailId = messageId || pseudoRandomBase64(40);
    var scrambleThreadId = 'dummy-thread-id'; // TODO: threading
    var timestamp = new Date().toISOString();
    var fromAddress = mailObj.headers['from'];
    var toAddress = mailObj.headers['to'];
    var ccAddress = mailObj.headers['cc'];
    var bccAddress = mailObj.headers['bcc'];
    var subject = mailObj.subject;
    var snippet = mailObj.text;
    db.run('insert or ignore into Message (scrambleMailId, scrambleThreadId, timestamp, messageId, ' +
      'fromAddress, toAddress, ccAddress, bccAddress, subject, snippet) ' +
      'values (?,?,?,?,?,?,?,?,?,?)',
      scrambleMailId, scrambleThreadId, timestamp, messageId,
      fromAddress, toAddress, ccAddress, bccAddress, subject, snippet, subCallback);

    // Index for full-text search
    var searchBody = subject + '\n\n' + mailObj.text;
    db.run('insert into MessageSearch (scrambleMailId, subject, fromAddress, toAddress, searchBody) ' +
      'values (?,?,?,?,?)',
      scrambleMailId, subject, fromAddress, toAddress, searchBody, subCallback);

    // Update Contact
    var contacts = [mailObj.from, mailObj.to, mailObj.cc, mailObj.bcc].reduce(function (a, b) {
        return b ? a.concat(b) : a;
      }, []);
    saveContacts(contacts, subCallback);

    // TODO: PGP decryption
    // TODO: Update MessageLabel
  }

  /**
   * Takes a list of named email addresses, each {address:..., name:...}
   * Makes sure each address exists in the Contact table.
   * Counts how often each name is used with a given address.
   */
  function saveContacts (contacts, cb) {
    console.log('Saving contacts', contacts);
    var errs = [];
    var numDone = 0;
    var numQueries = 3 * contacts.length;
    var subCallback = function (err) {
      if (err) {
        errs.push(err);
      }
      if (++numDone === numQueries) {
        cb(errs[0] || null);
      }
    };

    var stmtC = db.prepare('insert or ignore into Contact (emailAddress) values (?)');
    var stmtCN = db.prepare('insert or ignore into ContactName (emailAddress, name, numMessages) values (?,?,0)');
    var stmtCNInc = db.prepare('update ContactName set numMessages=numMessages+1 where emailAddress=? and name=?');
    contacts.forEach(function (contact) {
      var addr = contact.address.toLowerCase();
      stmtC.run(addr, subCallback);
      stmtCN.run(addr, contact.name, subCallback);
      stmtCNInc.run(addr, contact.name, subCallback);
    });
    stmtC.finalize();
    stmtCN.finalize();
    stmtCNInc.finalize();
  }

  /**
   * Saves a raw RFC2822 email.
   *
   * The first argument can be either a string or a stream.
   * The stream should be ASCII encoded. (Remember that ASCII is a strict
   * subset of UTF-8, so UTF-8 works too. All code points sholuld be <= 127.)
   *
   * The second argument is a callback(err, mailObj). It is not called until
   * the email has been successfully written to disk.
   **/
  this.saveRawEmail = function (email, cb) {
    var mailparser = new MailParser();
    mailparser.on('headers', function (err) {
      console.error(err);
    });
    mailparser.on('error', function (err) {
      cb(err, null);
    });
    mailparser.on('end', function (mailObj) {
      saveMailObj(mailObj, cb);
    });

    if (email instanceof stream.Readable) {
      email.pipe(mailparser);
    } else {
      mailparser.write(email);
      mailparser.end();
    }
  };

  /**
   * Email full-text search. See README for query syntax.
   *
   * The limit and offset args are optional.
   * The callback takes (err, array of email objs).
   */
  this.search = function (query, limit, offset, cb) {
    if (arguments.length === 2) {
      cb = limit;
      limit = 10;
      offset = 0;
    }
    console.log('scramble-mail-repo searching \'%s\' offset %d limit %d', query, offset, limit);
    if (query === '') {
      cb(null, null);
    } else {
      db.all('select scrambleMailId, fromAddress, toAddress, subject, snippet(MessageSearch) as snippet ' +
          'from MessageSearch where searchBody match ? limit ? offset ?',
          query, limit, offset, function (err, results) {
        if (err) {
          return cb(err, null);
        }
        var mailIds = results.map(function (x) { return x.scrambleMailId; });
        db.all('select * from Message where scrambleMailId in (\'' + mailIds.join('\',\'') + '\')', cb);
      });
    }
  };

  this.getThread = function (threadId, cb) {
    db.all('select * from Message where scrambleThreadId=?', threadId, cb);
  };

  /**
   * Fetches the unique message with the given ID.
   * Calls cb(err, message)
   * Exactly one of err or message will be null.
   */
  this.getMessage = function (mailId, cb) {
    db.get('select * from Message where scrambleMailId=?', mailId, function (err, row) {
      if (err) {
        cb(err, null);
      }
      if (!row) {
        cb('Couldn\'t find mail ID ' + mailId, null);
      }
      cb(null, row);
    });
  };
};
