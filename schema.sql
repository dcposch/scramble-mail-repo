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

create unique index if not exists IxMessageMailId on Message(scrambleMailId);
create index if not exists IxMessageThreadId on Message(scrambleThreadId);
create unique index if not exists IxMessageMessageId on Message(messageId);
create index if not exists IxMessageLabel on MessageLabel(label);
create index if not exists IxMessageLabelMailID on MessageLabel(scrambleMailId);

