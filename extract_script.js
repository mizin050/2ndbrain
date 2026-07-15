const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'frontend', 'second-brain.html');
const jsOutPath = path.join(__dirname, 'frontend', 'test_script.js');

try {
  const content = fs.readFileSync(htmlPath, 'utf8');
  
  // Find all <script> start tags
  const regex = /<script>/g;
  let matches = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    matches.push(match.index);
  }
  
  if (matches.length > 0) {
    const lastScriptStart = matches[matches.length - 1] + '<script>'.length;
    const closingIndex = content.indexOf('</script>', lastScriptStart);
    
    if (closingIndex !== -1) {
      const scriptCode = content.substring(lastScriptStart, closingIndex);
      fs.writeFileSync(jsOutPath, scriptCode, 'utf8');
      console.log(`Successfully wrote main script section (${scriptCode.length} bytes) to test_script.js`);
      
      // Now let's spawn "node -c" to check syntax
      const { execSync } = require('child_process');
      try {
        execSync(`node -c "${jsOutPath}"`);
        console.log("✅ Syntax validation passed! No javascript syntax errors found.");
      } catch (syntaxError) {
        console.error("❌ Syntax validation failed! Error:");
        console.error(syntaxError.stderr ? syntaxError.stderr.toString() : syntaxError.message);
      }
    } else {
      console.error("Could not find closing </script> tag");
    }
  } else {
    console.error("Could not find any <script> tag");
  }
} catch (e) {
  console.error("Error running extractor:", e);
}
