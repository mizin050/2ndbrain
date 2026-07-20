const fs = require('fs');

function showLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (line.includes('scheduleBackgroundNotification')) {
      console.log(`${filePath} [Line ${index + 1}]: ${line.trim()}`);
    }
  });
}

showLines('C:\\Users\\mizin\\2ndBrain\\SecondBrain\\frontend\\index.html');
showLines('C:\\Users\\mizin\\2ndBrain\\SecondBrain\\frontend\\second-brain.html');
showLines('C:\\Users\\mizin\\2ndBrain\\SecondBrain\\frontend\\test_script.js');
