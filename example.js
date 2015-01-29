var fs = require('fs');
var os = require('os');
var readline = require('readline');
var tmp = require('tmp-sync');
var ScrambleMailRepo = require('./index.js');

// Create a temporary folder, where we'll build the index
var fromDir, toDir;
if (process.argv.length === 2) {
  fromDir = 'test/';
  toDir = tmp.in(os.tmpdir());
} else if (process.argv.length === 4) {
  fromDir = process.argv[2];
  toDir = process.argv[3];
} else {
  process.exit(1);
}
demoSaveEmails(fromDir, toDir);

// Save a folder full of raw emails into an an
// empty folder, where we'll build an email index
function demoSaveEmails (fromDir, toDir) {
  console.log('Reading mail from %s, indexing in %s', fromDir, toDir);

  // Make a new repo to populate the empty temp folder
  var repo = new ScrambleMailRepo(toDir);

  // Grab a few example emails and stick them into the repo
  // In each case, the email is the full RFC2822 message
  var files = fs.readdirSync(fromDir);
  console.time('Indexing %d messages', files.length);
  console.time('Indexing messages');

  // Index emails in parallel
  var numDone = 0;
  var nextIx = 0;
  var saveEmail = function () {
    if (nextIx >= files.length) {
      return;
    }
    var file = files[nextIx++];
    var rawEmailStream = fs.createReadStream(fromDir + '/' + file);
    repo.saveRawEmail(rawEmailStream, onEmailSaved);
  };
  // Only process 40 at a time
  for (var i = 0; i < 40; i++) {
    saveEmail();
  }

  function onEmailSaved (err) {
    if (err) {
      console.error('Error saving email', err);
    }
    process.stdout.write('.');
    if (++numDone === files.length) {
      process.stdout.write('\n\n');
      console.timeEnd('Indexing messages');
      // Finally, we're done building the email index
      // Next, show how to query it
      demoQueryEmails(repo);
    } else {
      saveEmail();
    }
  }
}

function demoQueryEmails (repo) {
  // Full text search
  repo.search('fifth of november', printResults);
  // Full text search includes From and To
  repo.search('root@eruditorum.org', printResults);
  // You can also search explicitly. 'to:' queries include the CC header.
  repo.search('to:root@eruditorom.org', printResults);
  repo.search('to:root', printResults);
  // Search for an exact string
  repo.search('\"remember, remember\"', printResults);

  // Get the inbox
  repo.search('label:\\scramble\\inbox', printResults);
  // Get all sent mail
  repo.search('label:\\scramble\\sent', printResults);

  // Fetch a given thread
  repo.getThread('herpThread', printResults);

  // Fetch a given message
  repo.getMessage('herp', printResults);

  demoUserSearch(repo);
}

var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function demoUserSearch (repo) {
  rl.question('> ', function (query) {
    repo.search(query, function (err, results) {
      printResults(err, results);
      demoUserSearch(repo);
    });
  });
}

function printResults (err, results) {
  if (err) {
    console.error('Error searching emails', err);
    return;
  }
  if (results && results.hasOwnProperty('length')) {
    console.log('Got ' + results.length + ' result(s)');
    results.forEach(function (result) {
      console.log(result);
    });
  } else if (results) {
    console.log('Got the result');
    console.log(results);
  } else {
    console.log('No result');
  }
}
