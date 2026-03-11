// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
function analyzeGlb(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const magic = buffer.toString('utf8', 0, 4);
    if (magic !== 'glTF') { console.log('not a glb:', filePath); return; }
    const chunkLength = buffer.readUInt32LE(12);
    const chunkType = buffer.toString('utf8', 16, 20);
    if (chunkType !== 'JSON') { console.log('first chunk not JSON:', filePath); return; }
    const jsonBuf = buffer.slice(20, 20 + chunkLength);
    const json = JSON.parse(jsonBuf.toString('utf8'));
    console.log('--- ' + filePath + ' ---');
    console.log('Animations:', json.animations ? json.animations.map(a => a.name) : 'none');
    const morphTargets = new Set();
    if (json.meshes) {
      json.meshes.forEach(m => {
        if (m.primitives) {
          m.primitives.forEach(p => {
            if (p.extras && p.extras.targetNames) {
              p.extras.targetNames.forEach(tn => morphTargets.add(tn));
            }
          });
        }
      });
    }
    console.log('Morph targets (first 20):', Array.from(morphTargets).slice(0, 20).join(', ') + (morphTargets.size > 20 ? ` ... (${morphTargets.size} total)` : ''));
    if (morphTargets.has('mouthSmileLeft') || morphTargets.has('smile')) {
      console.log('Has smile morph targets!');
    }
    if (morphTargets.has('jawOpen')) {
      console.log('Has jawOpen morph target!');
    }
  } catch(e) {
    console.log('Error reading', filePath, e.message);
  }
}
analyzeGlb('g:\\MyProject\\digital-persona\\public\\avatar-transformed.glb');
analyzeGlb('g:\\MyProject\\digital-persona\\public\\69aaa1126e4b038c0e57c67a.glb');
