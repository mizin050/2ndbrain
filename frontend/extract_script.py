import re
import subprocess

html_path = r"c:\Users\mizin\2ndBrain\SecondBrain\frontend\second-brain.html"
js_out_path = r"c:\Users\mizin\2ndBrain\SecondBrain\frontend\test_script.js"

with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the main script tag starting from line 1092 or matching <script> after details
script_matches = list(re.finditer(r'<script>', content))
# The last <script> tag should be the main one
if script_matches:
    last_script_start = script_matches[-1].end()
    # Find the corresponding closing </script> tag
    closing_match = content.find('</script>', last_script_start)
    if closing_match != -1:
        script_code = content[last_script_start:closing_match]
        with open(js_out_path, 'w', encoding='utf-8') as js_f:
            js_f.write(script_code)
        print(f"Successfully wrote main script section ({len(script_code)} bytes) to test_script.js")
    else:
        print("Could not find closing </script> tag")
else:
    print("Could not find any <script> tag")
