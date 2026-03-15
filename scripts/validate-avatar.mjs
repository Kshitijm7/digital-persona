import fs from 'fs';
import path from 'path';

// Uses NEXT_PUBLIC_AVATAR_GLB from .env.local or fallback
let avatarFile = '69aaa1126e4b038c0e57c672.glb';
try {
  const envPath = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    const match = env.match(/NEXT_PUBLIC_AVATAR_GLB=(.*)/);
    if (match) avatarFile = match[1].trim();
  }
} catch {
  // Ignore
}

const filePath = path.join(process.cwd(), 'public', 'avatars', avatarFile);

function validateGlb(file) {
  console.log(`Validating Avatar: ${file}`);
  if (!fs.existsSync(file)) {
    console.error(`❌ Error: Avatar file not found at ${file}`);
    process.exit(1);
  }

  try {
    const buffer = fs.readFileSync(file);
    const magic = buffer.toString('utf8', 0, 4);
    if (magic !== 'glTF') {
      console.error('❌ Error: The file is not a valid GLB (magic number mismatch).');
      process.exit(1);
    }
    
    const chunkLength = buffer.readUInt32LE(12);
    const chunkType = buffer.toString('utf8', 16, 20);
    if (chunkType !== 'JSON') {
      console.error('❌ Error: GLB missing JSON chunk.');
      process.exit(1);
    }

    const jsonBuf = buffer.slice(20, 20 + chunkLength);
    const json = JSON.parse(jsonBuf.toString('utf8'));
    
    const morphTargets = new Set();
    if (json.meshes) {
      json.meshes.forEach(m => {
        if (m.extras && m.extras.targetNames) {
          m.extras.targetNames.forEach(tn => morphTargets.add(tn));
        }
        if (m.primitives) {
          m.primitives.forEach(p => {
            if (p.extras && p.extras.targetNames) {
              p.extras.targetNames.forEach(tn => morphTargets.add(tn));
            }
          });
        }
      });
    }

    const requiredMorphs = ['mouthSmileLeft', 'mouthSmileRight', 'jawOpen'];
    const missing = requiredMorphs.filter(m => !morphTargets.has(m));

    if (missing.length > 0) {
      console.error(`❌ Error: Avatar is missing required ARKit morph targets: ${missing.join(', ')}`);
      console.error(`Please redownload your avatar from Ready Player Me with "?morphTargets=ARKit" appended to the URL.`);
      process.exit(1);
    }

    console.log(`✅ Avatar is valid and contains ARKit blendshapes! (${Array.from(morphTargets).length} total blendshapes found)`);
  } catch(e) {
    console.error('❌ Error parsing GLB:', e.message);
    process.exit(1);
  }
}

validateGlb(filePath);
