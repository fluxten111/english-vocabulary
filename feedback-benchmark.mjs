// Authored controlled examples. These are quality checks, never user learning history.
export const feedbackCases=[
  ['e01','I has a book.','grammar'],['e02','She have a book.','grammar'],
  ['e03',"He don't read this book.",'grammar'],['e04','Yesterday I buy a book.','grammar'],
  ['e05','I have this book since Monday.','grammar'],['e06','There is two books on the desk.','grammar'],
  ['e07','This book belong to me.','grammar'],['e08','I am interested on this book.','grammar'],
  ['e09','I enjoy to read this book.','grammar'],['e10','He suggested me to read this book.','grammar'],
  ['e11','I bought a book for read on the train.','grammar'],['e12',"I didn't bought this book.",'grammar'],
  ['e13','The book are interesting.','grammar'],['e14','I have readed this book.','grammar'],
  ['e15','She can reads this book.','grammar'],['e16','I bought an book.','grammar'],
  ['e17','These book are new.','grammar'],['e18','My friend gave a book to I.','grammar'],
  ['e19','He is read this book now.','grammar'],['e20','I must to return this book.','grammar'],
  ['c01','I have a book.','acceptable'],['c02',"I've got a book.",'acceptable'],
  ['c03',"There's a book on the desk.",'acceptable'],['c04',"I haven't read this book yet.",'acceptable'],
  ['c05','This is the book I told you about.','acceptable'],['c06','Would you mind lending me your book?','acceptable'],
  ['c07','I read this book yesterday.','acceptable'],['c08','The book that I bought yesterday is interesting.','acceptable'],
  ['c09','I bought two books.','acceptable'],['c10','Could you lend me a book, please?','acceptable'],
  ['s01','I booked a room.','different_sense'],['s02','She is reading.','missing_target'],
  ['a01','This book is sick.','context'],['a02','I found the book by the teacher.','context'],['a03','I finished the book.','context']
].map(([id,sentence,expect])=>({id,sentence,expect,word:'book',senseId:'book#noun',definition:'A set of pages joined together for reading.'}));
export function checkBenchmarkCase(example,result){
  const grammar=result.issues.some(i=>i.kind==='grammar');
  if(example.expect==='grammar')return result.assessment==='suggestions'&&grammar;
  if(example.expect==='acceptable')return result.assessment==='no_clear_issue'&&!result.issues.length;
  if(example.expect==='different_sense')return !grammar&&result.targetUsage==='different_sense';
  if(example.expect==='missing_target')return !grammar&&result.targetUsage==='missing';
  return !grammar&&!result.issues.length&&result.assessment!=='suggestions';
}
