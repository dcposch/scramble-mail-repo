var tmp = require('tmp');
var fs = require('fs');
var ScrambleMailRepo = require('./index.js');

// Create a temporary folder, where we'll build the index
var pathArg = process.argv[2];
if(pathArg){
  demoSaveEmails(pathArg);
} else {
  tmp.dir({unsafeCleanup:true, prefix:'scramble'}, function(err, path){
    if (err) throw err;
    demoSaveEmails(path);
  });
}

function demoSaveEmails(path){
  // Make a new repo to populate the empty temp folder
  var repo = new ScrambleMailRepo(path);

  // Grab a few example emails and stick them into the repo
  // In each case, the email is the full RFC2822 message
  var files = fs.readdirSync("test");
  var numDone = 0;
  files.forEach(function(file){
    // The email consists of headers (From, To, Subject, etc) plus a body
    var rawEmail = fs.readFileSync("test/"+file, {"encoding":"utf8"});
    repo.saveRawEmail(rawEmail, function(err){
      if(err) {
        console.error("Error saving email", err);
      }
      if(++numDone == files.length){
        demoQueryEmails(repo);
      }
    });
  });
}

function demoQueryEmails(repo){
  // Full text search
  repo.search("fifth of november", printResults);
  // Full text search includes From and To
  repo.search("root@eruditorum.org", printResults);
  // You can also search explicitly. "to:" queries include the CC header.
  repo.search("to:root@eruditorom.org", printResults);
  repo.search("to:root", printResults);
  // Search for an exact string
  repo.search("\"remember, remember\"", printResults);

  // Get the inbox
  repo.search("label:\\scramble\\inbox", printResults);
  // Get all sent mail
  repo.search("label:\\scramble\\sent", printResults);

  // Fetch a given thread
  repo.getThread("herp", printResults);

  // Fetch a given message
  repo.getMessage("herp", printResults);
}

function printResults(err, results){
  if(err) {
    console.error("Error searching emails", err);
    return;
  }
  results.forEach(function(result){
    console.log(result);
  });
}

