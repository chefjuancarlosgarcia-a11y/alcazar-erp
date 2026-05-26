const fs = require('fs')
const path = require('path')
const file = path.resolve(__dirname, '..', 'src', 'App.jsx')
const s = fs.readFileSync(file, 'utf8')
function countChar(ch){return (s.split(ch).length-1)}
console.log('file:', file)
console.log('length:', s.length)
console.log('lines:', s.split('\n').length)
console.log('counts:')
console.log("  backticks:", countChar('`'))
console.log("  single quotes:", countChar("'"))
console.log('  double quotes:', countChar('"'))
console.log('  open paren (:', countChar('('))
console.log('  close paren ):', countChar(')'))
console.log('  open brace {:', countChar('{'))
console.log('  close brace }:', countChar('}'))
console.log('  lt tags <:', countChar('<'))
console.log('  gt tags >:', countChar('>'))
// find lines around a given number
const lines = s.split('\n')
for(const idx of [2680,2700,2720,2730,2740,2760]){
  console.log('--- line', idx, '|', lines[idx-1] ? lines[idx-1].slice(0,200) : '')
}

// search for regex-like patterns since parser complained about unterminated regex
const regexLike = s.match(/\/(?:[^\\\n]|\\.)*\//g)
console.log('regex-like matches count:', regexLike ? regexLike.length : 0)
if(regexLike && regexLike.length>0) console.log(regexLike.slice(0,5))
