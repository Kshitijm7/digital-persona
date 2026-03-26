import { execFileSync } from 'child_process';
import { dirname, join, parse } from 'path';
import { readdirSync, statSync, unlinkSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const fbx2gltf = require('fbx2gltf');

const ANIMATIONS_DIR = dirname(fileURLToPath(import.meta.url));

console.log('Starting Mixamo FBX to GLB conversion...');

function findFbxFiles(dir, fileList = []) {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    if (statSync(filePath).isDirectory()) {
      findFbxFiles(filePath, fileList);
    } else if (file.toLowerCase().endsWith('.fbx')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const fbxFiles = findFbxFiles(ANIMATIONS_DIR);

async function run() {
  if (fbxFiles.length === 0) {
    console.log('No .fbx files found in public/animations/.');
  } else {
    console.log(`Found ${fbxFiles.length} FBX files to convert. Process starting...`);

    for (const fbxFile of fbxFiles) {
      const parsedPath = parse(fbxFile);
      const outGlb = join(parsedPath.dir, `${parsedPath.name}.glb`);
      
      console.log(`Converting: ${parsedPath.base} -> ${parsedPath.name}.glb`);
      try {
        await fbx2gltf(fbxFile, outGlb, ['--binary']);
        console.log(`  Success! Deleting original FBX...`);
        unlinkSync(fbxFile);
      } catch (err) {
        console.error(`  Error converting ${fbxFile}:`, err.message);
      }
    }

    console.log('Conversion complete. Updating registry...');
  }

  // Execute generate_registry.js
  try {
    execFileSync('node', [join(ANIMATIONS_DIR, 'generate_registry.js')], { stdio: 'inherit' });
  } catch (err) {
    console.error('Error running generate_registry.js:', err.message);
  }

  console.log('All done!');
}

run();
