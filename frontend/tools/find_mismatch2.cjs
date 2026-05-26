const fs = require('fs')
const path = require('path')
const file = path.resolve(__dirname, '..', 'src', 'App.jsx')
const s = fs.readFileSync(file, 'utf8')
const lines = s.split('\n')
let brace=0, paren=0
let maxBrace = {val:0,line:0}
let maxParen = {val:0,line:0}
for(let i=0;i<lines.length;i++){
  const line = lines[i]
  for(let j=0;j<line.length;j++){
    const ch = line[j]
    if(ch==='(') paren++
    else if(ch===')') paren--
    else if(ch==='{' ) brace++
    else if(ch==='}') brace--
  }
  if(brace>maxBrace.val){ maxBrace.val=brace; maxBrace.line=i+1 }
  if(paren>maxParen.val){ maxParen.val=paren; maxParen.line=i+1 }
}
console.log('final paren=',paren,'brace=',brace)
console.log('max open paren at line',maxParen.line,'value',maxParen.val)
console.log('max open brace at line',maxBrace.line,'value',maxBrace.val)
console.log('context around brace max:')
console.log(lines.slice(maxBrace.line-5, maxBrace.line+5).map((l,idx)=>`${maxBrace.line-5+idx+1}: ${l}`).join('\n'))
