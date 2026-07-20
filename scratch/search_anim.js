const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\mizin\\2ndBrain\\SecondBrain\\frontend\\index.html', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (index >= 1980 && index <= 3000) {
    if (line.includes('requestAnimationFrame') || line.includes('animate') || line.includes('function draw') || line.includes('function update')) {
      console.log(`Line ${index + 1}: ${line.trim()}`);
    }
  }
});
