var fs = require("fs");
var stream = require("stream");
var crypto = require("crypto");
var sqlite3 = require("sqlite3").verbose();
var MailParser = require("mailparser").MailParser;

module.exports = function(dir) {
  var dbFilename = dir+"/index.sqlite";
  var db = new sqlite3.Database(dbFilename);
  initDatabase();

  function initDatabase() {
    // Create any new tables, or create all tables if DB was newly created
    var schemaSql = fs.readFileSync("schema.sql", {"encoding":"utf8"});
    // Don't run any other queries until the DB is initialized
    db.serialize(function(){
      db.exec(schemaSql, function(err){
        if(err == null){
          console.log("Created the email index sqlite DB successfully");
        } else {
          console.error("Error creating sqlite DB "+dbFilename, err);
        }
      });
    });
  }

  /**
   * Returns a non-cryptographically-strong random string.
   * Length n base64 chars, so 6n bits.
   */
  function pseudoRandomBase64(numChars){
    var buf = crypto.pseudoRandomBytes(numChars);
    return buf.toString("base64").substring(0, numChars);
  }

  function saveMailObj(mailObj, cb) {
      var errs = [], numDone = 0, numQueries = 1;
      var subCallback = function(err) {
        if(err) {
          errs.push(err);
        }
        if(++numDone == numQueries) {
          cb(errs[0] || null);
        }
      };

      // Insert Message
      //console.log(mailObj);
      var messageId = mailObj.headers["message-id"] || null;
      var scrambleMailId = messageId || pseudoRandomBase64(40);
      var scrambleThreadId = "dummy-thread-id"; //TODO: threading
      var timestamp = new Date().toISOString();
      var fromAddress = mailObj.headers["from"];
      var toAddress = mailObj.headers["to"];
      var ccAddress = mailObj.headers["cc"];
      var bccAddress = mailObj.headers["bcc"];
      var subject = mailObj.subject;
      var snippet = mailObj.text;
      db.run("insert or ignore into Message (scrambleMailId, scrambleThreadId, timestamp, messageId, "+
          "fromAddress, toAddress, ccAddress, bccAddress, subject, snippet) "+
          "values (?,?,?,?,?,?,?,?,?,?)",
          scrambleMailId, scrambleThreadId, timestamp, messageId,
          fromAddress, toAddress, ccAddress, bccAddress, subject, snippet, subCallback);


      // Index for full-text search
      var searchBody = subject + "\n\n" + mailObj.text;
      db.run("insert into MessageSearch (scrambleMailId, subject, fromAddress, toAddress, searchBody) "+
          "values (?,?,?,?,?)",
          scrambleMailId, subject, fromAddress, toAddress, searchBody);

      //TODO: PGP decryption
      //TODO: Update Contact
      //TODO: Update MessageSearch
      //TODO: Update MessageLabel
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
  this.saveRawEmail = function(email, cb) {
    var mailparser = new MailParser();
    mailparser.on("headers", function(err){
      //console.info("MailParser headers");
    });
    mailparser.on("error", function(err){
      //console.warn("MailParser error");
      cb(err, null);
    });
    mailparser.on("end", function(mailObj){
      //console.info("MailParser succeeded");
      saveMailObj(mailObj, cb);
    });

    if(email instanceof stream.Readable) {
      email.pipe(mailparser);
    } else {
      mailparser.write(email);
      mailparser.end();
    }
  }

  this.search = function(query, cb){
    if(query === ""){
      cb(null, null);
    } else {
      db.all("select scrambleMailId from MessageSearch where searchBody match ?", query, function(err, results){
        if(err) {
          return cb(err, null);
        }
        var mailIds = results.map(function(x) { return x.scrambleMailId; });
        db.all("select * from Message where scrambleMailId in ('" + mailIds.join("','") + "')", cb);
      }); 
    }
  }

  this.getThread = function(threadId, cb){
    db.all("select * from Message where scrambleThreadId=?", threadId, cb);
  }

  /**
   * Fetches the unique message with the given ID.
   * Calls cb(err, message)
   * Exactly one of err or message will be null.
   */
  this.getMessage = function(mailId, cb){
    db.get("select * from Message where scrambleMailId=?", mailId, function(err, row){
      if(err){
        cb(err, null);
      }
      if(!row){
        cb("Couldn't find mail ID "+mailId, null);
      }
      cb(null, row);
    });
  }
};
