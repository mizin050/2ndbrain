const fs = require('fs');
const path = require('path');

function searchFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('scheduleBackgroundNotification')) {
    console.log(`Found in: ${filePath}`);
  }
}

function traverse(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== '.gradle') {
        traverse(fullPath);
      }
    } else if (file.endsWith('.html') || file.endsWith('.js')) {
      searchFile(fullPath);
    }
  }
}

traverse('C:\\Users\\mizin\\2ndBrain\\SecondBrain');
