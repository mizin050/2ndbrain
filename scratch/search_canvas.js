const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\mizin\\2ndBrain\\SecondBrain\\frontend\\index.html', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('graph-main-canvas') || line.includes('canvas')) {
    if (line.includes('getElementById') || line.includes('getContext')) {
      console.log(`Line ${index + 1}: ${line.trim()}`);
    }
  }
});
