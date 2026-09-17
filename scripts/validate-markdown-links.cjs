const fs = require('fs');
const path = require('path');

function getMarkdownFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file === 'node_modules' || file === 'dist' || file === '.git') continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getMarkdownFiles(fullPath));
    } else if (file.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

const rootDir = path.resolve(__dirname, '..');
const mdFiles = getMarkdownFiles(rootDir);

let totalLinks = 0;
let validLinks = 0;
let brokenLinks = [];

const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

for (const filePath of mdFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const linkText = match[1];
    let linkTarget = match[2].trim();

    // Skip external URLs, mailto, anchor only
    if (linkTarget.startsWith('http://') || linkTarget.startsWith('https://') || linkTarget.startsWith('mailto:') || linkTarget.startsWith('#')) {
      continue;
    }

    // Strip anchor fragment if any
    const [targetPath, anchor] = linkTarget.split('#');

    if (!targetPath) continue; // Pure anchor

    totalLinks++;

    // Resolve relative to current markdown file
    const resolvedPath = path.resolve(path.dirname(filePath), targetPath);

    if (fs.existsSync(resolvedPath)) {
      validLinks++;
    } else {
      brokenLinks.push({
        sourceFile: path.relative(rootDir, filePath),
        linkText,
        linkTarget,
        resolvedPath: path.relative(rootDir, resolvedPath)
      });
    }
  }
}

console.log(`\n========================================`);
console.log(`MARKDOWN LINK VALIDATION REPORT`);
console.log(`========================================`);
console.log(`Files Scanned: ${mdFiles.length}`);
console.log(`Relative Links Checked: ${totalLinks}`);
console.log(`Valid Links: ${validLinks}`);
console.log(`Broken Links: ${brokenLinks.length}`);

if (brokenLinks.length > 0) {
  console.log(`\nBroken Link Details:`);
  for (const item of brokenLinks) {
    console.log(`  Source:   ${item.sourceFile}`);
    console.log(`  Target:   ${item.linkTarget}`);
    console.log(`  Expected: ${item.resolvedPath}\n`);
  }
  process.exit(1);
} else {
  console.log(`\nALL INTERNAL LINKS ARE VALID!`);
  process.exit(0);
}
