const fs = require('fs')
const path = require('path')
const file = path.resolve(__dirname, '..', 'src', 'App.jsx')
const s = fs.readFileSync(file, 'utf8')
const lines = s.split('\n')
for(let i=0;i<lines.length;i++){
  const line = lines[i]
  let inS=false,inD=false,inB=false,escaped=false
  for(let j=0;j<line.length;j++){
    const ch = line[j]
    if(escaped){ escaped=false; continue }
    if(ch === "\\") { escaped=true; continue }
    if(ch === "'" && !inD && !inB) { inS = !inS; continue }
    if(ch === '"' && !inS && !inB) { inD = !inD; continue }
    if(ch === '`' && !inS && !inD) { inB = !inB; continue }
    if(ch === '/' && !inS && !inD && !inB){
      // ignore // comments
      if(line[j+1] === '/') break
      // ignore /* comment start
      if(line[j+1] === '*') break
      console.log('Line', i+1, 'col', j+1, 'possible slash outside quotes:', line.slice(Math.max(0,j-20), j+30))
      break
    }
  }
}
