--
-- Searchable email database
--

create table if not exists Message (
  scrambleMailId text not null,
  scrambleThreadId text not null,
  timestamp text not null, 
  messageId text,
  fromAddress text not null,
  toAddress text not null,
  ccAddress text,
  bccAddress text,
  subject text not null,
  snippet text not null
);
create unique index if not exists IxMessageMailId on Message(scrambleMailId);
create index if not exists IxMessageThreadId on Message(scrambleThreadId);
create unique index if not exists IxMessageMessageId on Message(messageId);

--
-- Many-to-one map from email Message-ID values to thread IDs
--
create table if not exists MessageThread (
  messageId text primary key,
  scrambleThreadId text not null
);
create index if not exists IxMessageThreadThreadId on MessageThread(scrambleThreadId);

create virtual table if not exists MessageSearch using fts4 (
  scrambleMailId,
  subject,
  fromAddress,
  toAddress,
  searchBody
);

create table if not exists MessageLabel (
  id integer primary key,
  label text not null,
  scrambleMailId text not null
);
create index if not exists IxMessageLabel on MessageLabel(label);
create index if not exists IxMessageLabelMailID on MessageLabel(scrambleMailId);

create table if not exists Contact (
  emailAddress text primary key,
  keybaseName text,
  pgpKey text
);

--
-- Many-to-many map from email addresses to names seen with that address
-- For example, we might see "From: Bob Bobbs <bobbs@example.com>"
--
create table if not exists ContactName (
  emailAddress text,
  name text,
  numMessages integer,
  primary key(emailAddress, name)
);
create index if not exists IxContactName on ContactName(name);

