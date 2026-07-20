const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\mizin\\2ndBrain\\SecondBrain\\frontend\\index.html', 'utf8');
const lines = content.split('\n');
let inside = false;
lines.forEach((line, index) => {
  if (line.includes('function drawOneNode')) {
    inside = true;
  }
  if (inside && index < 2550 && index > 2450) {
    console.log(`Line ${index + 1}: ${line}`);
  }
});
