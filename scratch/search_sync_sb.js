const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\mizin\\2ndBrain\\SecondBrain\\frontend\\second-brain.html', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('syncWidgetReminders')) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
