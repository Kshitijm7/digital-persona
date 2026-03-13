import fs from 'fs';
import path from 'path';

const REPO_DIR = path.join(process.cwd(), '.temp-animations');
const OUT_DIR = path.join(process.cwd(), 'public', 'animations');

const ANIMATIONS = {
  idle: path.join(REPO_DIR, 'masculine', 'glb', 'idle', 'M_Standing_Idle_001.glb'),
  wave: path.join(REPO_DIR, 'masculine', 'glb', 'expression', 'M_Standing_Expressions_013.glb')
};

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function copyAnimation(name, src) {
  const dest = path.join(OUT_DIR, `${name}.glb`);
  console.log(`Copying ${name} animation...`);

  if (!fs.existsSync(src)) {
    console.error(`❌ Source file not found: ${src}`);
    console.error('Make sure temp-animations is cloned correctly in the root folder.');
    return;
  }

  try {
    fs.copyFileSync(src, dest);
    console.log(`✅ ${name} saved to ${dest}`);
  } catch (err) {
    console.error(`❌ Failed to copy ${name}:`, err);
  }
}

function main() {
  console.log('Setting up animations from local temp-animations repo...');
  Object.entries(ANIMATIONS).forEach(([name, src]) => copyAnimation(name, src));
  console.log('🎉 All animations copied successfully!');
}

main();
