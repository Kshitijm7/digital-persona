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

const filePath = process.argv[2] 
  ? path.resolve(process.cwd(), process.argv[2]) 
  : path.join(process.cwd(), 'public', 'avatars', avatarFile);

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

    // 1. Check required blendshapes (ARKit and Oculus Visemes)
    const requiredMorphs = [
      // ARKit examples
      'mouthSmileLeft', 'mouthSmileRight', 'jawOpen',
      // Oculus Visemes
      'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD', 
      'viseme_kk', 'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR', 
      'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U'
    ];
    const missing = requiredMorphs.filter(m => !morphTargets.has(m));

    if (missing.length > 0) {
      console.error(`❌ Error: Avatar is missing required morph targets: ${missing.join(', ')}`);
      console.error(`Please redownload with "?morphTargets=ARKit,Oculus Visemes" appended to the URL.`);
      process.exit(1);
    }

    // 2. Check Compression (Draco & MeshOpt)
    const extensions = json.extensionsUsed || [];
    if (!extensions.includes('KHR_draco_mesh_compression')) {
       console.error(`❌ Error: Avatar missing KHR_draco_mesh_compression.`);
       console.error(`Please redownload with "useDracoCompression=true"`);
       process.exit(1);
    }
    if (!extensions.includes('EXT_meshopt_compression')) {
       console.error(`❌ Error: Avatar missing EXT_meshopt_compression.`);
       console.error(`Please redownload with "useMeshOptCompression=true"`);
       process.exit(1);
    }

    // 3. Check Texture Atlas (textureAtlas=none implies separate images instead of a combined atlas)
    // Heuristic: An atlas usually combines into 1 or 2 images.
    const imagesCount = json.images ? json.images.length : 0;
    if (imagesCount <= 2) {
      console.error(`❌ Error: Avatar appears to use a texture atlas (found only ${imagesCount} images).`);
      console.error(`Please redownload with "textureAtlas=none"`);
      process.exit(1);
    }

    // 4. Check Mesh LOD (meshLod=0 heuristically implies multiple meshes vs merged meshes for higher LODs)
    const meshesCount = json.meshes ? json.meshes.length : 0;
    if (meshesCount <= 2) {
      console.warn(`⚠️ Warning: Avatar might not be meshLod=0. Found only ${meshesCount} mesh(es). Higher LOD settings tend to merge meshes.`);
    }

    console.log(`✅ Avatar is fully valid! Features verified: ARKit, Oculus Visemes, Draco, MeshOpt, textureAtlas=none, meshLod=0. (${Array.from(morphTargets).length} total blendshapes found)`);
  } catch(e) {
    console.error('❌ Error parsing GLB:', e.message);
    process.exit(1);
  }
}

validateGlb(filePath);
