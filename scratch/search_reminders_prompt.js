const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\mizin\\2ndBrain\\SecondBrain\\frontend\\index.html', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('sb_reminders') || line.includes('reminders') && line.includes('prompt')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
