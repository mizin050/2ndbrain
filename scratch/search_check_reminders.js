const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\mizin\\2ndBrain\\SecondBrain\\frontend\\index.html', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  if (line.includes('sb_reminders') || line.includes('fired = true') || line.includes('checkReminders') || line.includes('setInterval')) {
    if (line.length < 150) {
      console.log(`Line ${index + 1}: ${line.trim()}`);
    }
  }
});
