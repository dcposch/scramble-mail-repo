# scramble-mail-repo

This is the scramble.io module for locally storing and indexing email.

It's built on [sqlite3](https://github.com/mapbox/node-sqlite3) and organizes email by message id, thread id, labels, and full-text search. 
Boxes--like Inbox, Outbox, and Sent--are handled as a special case of labels. Does not search inside attachments.

## Example

Create a new mail repo. Store everything in a given directory:

```javascript
var ScrambleMailRepo = require('scramble-mail-repo');

var repo = new ScrambleMailRepo('/home/bob/my-mail');
```

Write an email into the repo. Raw RFC2822 format. See `test/` for examples.

```javascript
var sampleMail =
  "From: <dcposch@scramble.io>\n" +
  "To: <emma@scramble.io>\n" +
  "Subject: Yo\n\n"+
  "Sup?";

repo.save(sampleMail);
```

Search the repo, and print out the results.

```javascript
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
repo.getThread("8668a49cad43e2497a979e09069b8045", printResults);

// Fetch a given message
repo.getMessage("49f48c2a38faac6a5abfe1bac4f6b857", printResults);
```


## How it works

`scramble-mail-repo` stores raw email as flat files in simple directory layout, plus a single sqlite DB to index them.
You specify a directory for everything to go into. Example contents:

    index.sqlite
    2014/
        01/
          <scramble mail id 1>.txt
          <scramble mail id 2>.txt
        02/
          ...
    2015/
        ...

The sqlite DB uses the [fts4 extension](https://www.sqlite.org/fts3.html) for full-text search. 
See `schema.sql` for the full schema.

