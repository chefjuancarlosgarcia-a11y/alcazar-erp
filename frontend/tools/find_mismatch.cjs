const fs = require('fs')
const path = require('path')
const file = path.resolve(__dirname, '..', 'src', 'App.jsx')
const s = fs.readFileSync(file, 'utf8')
const lines = s.split('\n')
let paren=0, brace=0, lt=0
for(let i=0;i<lines.length;i++){
  const line = lines[i]
  for(let j=0;j<line.length;j++){
    const ch = line[j]
    if(ch==='(') paren++
    else if(ch===')') paren--
    else if(ch==='{' ) brace++
    else if(ch==='}') brace--
    else if(ch==='<' ) lt++
    else if(ch==='>') lt--
    if(paren<0) { console.log('paren negative at', i+1); console.log(lines.slice(Math.max(0,i-2),i+3).join('\n')); process.exit(0)}
    if(brace<0) { console.log('brace negative at', i+1); console.log(lines.slice(Math.max(0,i-2),i+3).join('\n')); process.exit(0)}
  }
}
console.log('completed. paren=',paren,'brace=',brace,'lt=',lt)
