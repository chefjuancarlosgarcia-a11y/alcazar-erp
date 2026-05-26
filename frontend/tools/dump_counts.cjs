const fs = require('fs')
const path = require('path')
const file = path.resolve(__dirname, '..', 'src', 'App.jsx')
const s = fs.readFileSync(file, 'utf8')
const lines = s.split('\n')
let brace=0, paren=0
for(let i=0;i<lines.length;i++){
  const line = lines[i]
  for(let j=0;j<line.length;j++){
    const ch = line[j]
    if(ch==='(') paren++
    else if(ch===')') paren--
    else if(ch==='{' ) brace++
    else if(ch==='}') brace--
  }
  if(i+1>=2670 && i+1<=2790) console.log(`${i+1}\tparen:${paren}\tbrace:${brace}\t${line}`)
}
console.log('final paren',paren,'final brace',brace)
