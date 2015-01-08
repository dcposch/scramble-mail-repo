var fs = require("fs");
var sqlite3 = require("sqlite3").verbose();

module.exports = function(dir) {
  var dbFilename = dir+"/index.sqlite";
  var db = new sqlite3.Database(dbFilename);
  var schemaSql = fs.readFileSync("schema.sql", {"encoding":"utf8"});
  db.run(schemaSql, function(err){
    if(err == null){
      console.log("Created the email index sqlite DB successfully");
    } else {
      console.error("Error creating sqlite DB "+dbFilename, err);
    }
  });

  this.saveRawEmail = function(email) {
    console.log("Stubbed save");
  }

  this.search = function(query, cb){
    cb(["fake result"]);
  }

  this.getThread = function(threadId, cb){
    cb(["fake result"]);
  }

  this.getMessage = function(messageId, cb){
    cb(["fake result"]);
  }
};
