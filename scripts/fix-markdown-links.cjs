const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function walk(dir) {
  let files = [];
  for (const f of fs.readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist' || f === '.git') continue;
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      files = files.concat(walk(full));
    } else if (f.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

const mdFiles = walk(rootDir);
let fixedCount = 0;

for (const file of mdFiles) {
  let content = fs.readFileSync(file, 'utf8');
  const original = content;

  // Replace file:///C:/Users/Chirag%20Arora/.../digital-impersonation-response-desk/X
  content = content.replace(/file:\/\/\/C:\/Users\/Chirag%20Arora\/\.gemini\/antigravity\/scratch\/digital-impersonation-response-desk\/([^\s\)\"]+)/g, (match, target) => {
    const fullTarget = path.join(rootDir, target);
    let rel = path.relative(path.dirname(file), fullTarget).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = './' + rel;
    return rel;
  });

  // Replace file:///docs/X
  content = content.replace(/file:\/\/\/docs\/([^\s\)\"]+)/g, (match, target) => {
    const fullTarget = path.join(rootDir, 'docs', target);
    let rel = path.relative(path.dirname(file), fullTarget).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = './' + rel;
    return rel;
  });

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    fixedCount++;
    console.log('Fixed links in:', path.relative(rootDir, file));
  }
}

console.log('Total files fixed:', fixedCount);
