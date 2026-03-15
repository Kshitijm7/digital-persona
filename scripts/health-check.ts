#!/usr/bin/env ts-node
/**
 * System Health Check Script
 * Verifies all components are properly configured before deployment
 */

import * as fs from 'fs';
import * as path from 'path';

interface HealthCheckResult {
  category: string;
  checks: Array<{
    name: string;
    status: 'PASS' | 'FAIL' | 'WARN';
    message: string;
  }>;
}

const results: HealthCheckResult[] = [];

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function addCheck(category: string, name: string, status: 'PASS' | 'FAIL' | 'WARN', message: string) {
  let categoryResult = results.find(r => r.category === category);
  if (!categoryResult) {
    categoryResult = { category, checks: [] };
    results.push(categoryResult);
  }
  categoryResult.checks.push({ name, status, message });
}

// 1. Environment Configuration Checks
function checkEnvironment() {
  console.log(`\n${colors.cyan}[1/7] Checking Environment Configuration...${colors.reset}`);
  
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    addCheck('Environment', '.env.local file', 'FAIL', 'File not found');
    return;
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');
  
  // Check API Key
  const apiKeyMatch = envContent.match(/GEMINI_API_KEY=(.+)/);
  if (!apiKeyMatch || apiKeyMatch[1].trim() === '' || apiKeyMatch[1].includes('your_')) {
    addCheck('Environment', 'Gemini API Key', 'FAIL', 'Invalid or missing API key');
  } else if (apiKeyMatch[1].match(/^AIza[A-Za-z0-9_-]{35}$/)) {
    addCheck('Environment', 'Gemini API Key', 'PASS', 'Valid API key format');
  } else {
    addCheck('Environment', 'Gemini API Key', 'WARN', 'API key format may be invalid');
  }

  // Check GCP Project ID
  const projectMatch = envContent.match(/NEXT_PUBLIC_GCP_PROJECT_ID=(.+)/);
  if (projectMatch && projectMatch[1] && !projectMatch[1].includes('your_')) {
    addCheck('Environment', 'GCP Project ID', 'PASS', `Configured: ${projectMatch[1]}`);
  } else {
    addCheck('Environment', 'GCP Project ID', 'WARN', 'Not configured (optional for dev)');
  }
}

// 2. Asset Availability Checks
function checkAssets() {
  console.log(`${colors.cyan}[2/7] Checking Asset Availability...${colors.reset}`);
  
  const avatarPath = path.join(process.cwd(), 'public', 'avatars', '69aaa1126e4b038c0e57c672.glb');
  if (fs.existsSync(avatarPath)) {
    const stats = fs.statSync(avatarPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    // Check if file is a valid GLB (starts with "glTF" magic number)
    const buffer = fs.readFileSync(avatarPath);
    const magic = buffer.readUInt32LE(0);
    
    if (magic === 0x46546C67) {
      addCheck('Assets', 'Avatar Model', 'PASS', `Valid GLB file (${sizeMB} MB)`);
    } else {
      addCheck('Assets', 'Avatar Model', 'FAIL', 'Invalid GLB file format');
    }
  } else {
    addCheck('Assets', 'Avatar Model', 'FAIL', '69aaa1126e4b038c0e57c672.glb not found in /public/avatars');
  }

  // Check for backup avatar
  const backupPath = path.join(process.cwd(), 'public', 'avatars', '69b1976bf005c9608fd1e704.glb');
  if (fs.existsSync(backupPath)) {
    addCheck('Assets', 'Backup Avatar', 'PASS', 'Backup model available');
  } else {
    addCheck('Assets', 'Backup Avatar', 'WARN', 'No backup model found');
  }
}

// 3. Dependencies Check
function checkDependencies() {
  console.log(`${colors.cyan}[3/7] Checking Dependencies...${colors.reset}`);
  
  const packagePath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
  
  const requiredDeps = {
    'next': '>=16.0.0',
    'react': '>=19.0.0',
    '@react-three/fiber': '>=9.0.0',
    '@react-three/drei': '>=10.0.0',
    'three': '>=0.180.0',
    'framer-motion': '>=12.0.0',
  };

  for (const [dep] of Object.entries(requiredDeps)) {
    if (packageJson.dependencies[dep]) {
      addCheck('Dependencies', dep, 'PASS', `Installed: ${packageJson.dependencies[dep]}`);
    } else {
      addCheck('Dependencies', dep, 'FAIL', `Missing required dependency`);
    }
  }

  // Check node_modules
  if (fs.existsSync(path.join(process.cwd(), 'node_modules'))) {
    addCheck('Dependencies', 'node_modules', 'PASS', 'Dependencies installed');
  } else {
    addCheck('Dependencies', 'node_modules', 'FAIL', 'Run npm install');
  }
}

// 4. Code Structure Checks
function checkCodeStructure() {
  console.log(`${colors.cyan}[4/7] Checking Code Structure...${colors.reset}`);
  
  const requiredFiles = [
    'src/hooks/useGeminiLive.ts',
    'src/hooks/useAudioProcessor.ts',
    'src/hooks/useWebcam.ts',
    'src/components/canvas/Avatar.tsx',
    'src/components/canvas/Scene.tsx',
    'src/lib/constants.ts',
    'src/app/page.tsx',
  ];

  for (const file of requiredFiles) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      addCheck('Code Structure', file, 'PASS', 'File exists');
    } else {
      addCheck('Code Structure', file, 'FAIL', 'File missing');
    }
  }
}

// 5. Constants Configuration Check
function checkConstants() {
  console.log(`${colors.cyan}[5/7] Checking Constants Configuration...${colors.reset}`);
  
  const constantsPath = path.join(process.cwd(), 'src/lib/constants.ts');
  if (!fs.existsSync(constantsPath)) {
    addCheck('Constants', 'constants.ts', 'FAIL', 'File not found');
    return;
  }

  const content = fs.readFileSync(constantsPath, 'utf-8');
  
  // Check for required exports
  const requiredExports = [
    'SYSTEM_PROMPT',
    'GEMINI_TOOLS',
    'GEMINI_MODEL',
    'AUDIO_CONFIG',
  ];

  for (const exportName of requiredExports) {
    if (content.includes(`export const ${exportName}`)) {
      addCheck('Constants', exportName, 'PASS', 'Defined');
    } else {
      addCheck('Constants', exportName, 'FAIL', 'Not defined');
    }
  }

  // Check model version
  if (content.includes('gemini-2.5-flash-native-audio-preview-12-2025')) {
    addCheck('Constants', 'Gemini Model', 'PASS', 'Using gemini-2.5-flash-native-audio-preview-12-2025');
  } else {
    addCheck('Constants', 'Gemini Model', 'WARN', 'Model version may be outdated');
  }

  // Check tool declarations
  if (content.includes('trigger_animation')) {
    addCheck('Constants', 'Tool Declarations', 'PASS', 'trigger_animation tool defined');
  } else {
    addCheck('Constants', 'Tool Declarations', 'FAIL', 'trigger_animation tool missing');
  }
}

// 6. Build Configuration Check
function checkBuildConfig() {
  console.log(`${colors.cyan}[6/7] Checking Build Configuration...${colors.reset}`);
  
  const nextConfigPath = path.join(process.cwd(), 'next.config.ts');
  if (fs.existsSync(nextConfigPath)) {
    addCheck('Build Config', 'next.config.ts', 'PASS', 'Configuration file exists');
  } else {
    addCheck('Build Config', 'next.config.ts', 'WARN', 'Using default configuration');
  }

  const tsConfigPath = path.join(process.cwd(), 'tsconfig.json');
  if (fs.existsSync(tsConfigPath)) {
    const tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, 'utf-8'));
    if (tsConfig.compilerOptions?.paths?.['@/*']) {
      addCheck('Build Config', 'Path Aliases', 'PASS', '@/* alias configured');
    } else {
      addCheck('Build Config', 'Path Aliases', 'WARN', '@/* alias not configured');
    }
  }
}

// 7. Architecture Compliance Check
function checkArchitecture() {
  console.log(`${colors.cyan}[7/7] Checking Architecture Compliance...${colors.reset}`);
  
  // Check for bidirectional stream implementation
  const geminiHookPath = path.join(process.cwd(), 'src/hooks/useGeminiLive.ts');
  if (fs.existsSync(geminiHookPath)) {
    const content = fs.readFileSync(geminiHookPath, 'utf-8');
    
    if (content.includes('sendVideoFrame') && content.includes('sendAudioChunk')) {
      addCheck('Architecture', 'Bidirectional Stream', 'PASS', 'Video + Audio streaming implemented');
    } else {
      addCheck('Architecture', 'Bidirectional Stream', 'FAIL', 'Missing video or audio streaming');
    }

    if (content.includes('onAudioData') && content.includes('onToolCall')) {
      addCheck('Architecture', 'Response Handlers', 'PASS', 'Audio and tool call handlers present');
    } else {
      addCheck('Architecture', 'Response Handlers', 'FAIL', 'Missing response handlers');
    }
  }

  // Check for lip-sync implementation
  const avatarPath = path.join(process.cwd(), 'src/components/canvas/Avatar.tsx');
  if (fs.existsSync(avatarPath)) {
    const content = fs.readFileSync(avatarPath, 'utf-8');
    
    if (content.includes('morphTargetInfluences') && content.includes('audioLevel')) {
      addCheck('Architecture', 'Lip-Sync', 'PASS', 'Morph target lip-sync implemented');
    } else {
      addCheck('Architecture', 'Lip-Sync', 'WARN', 'Lip-sync may not be fully implemented');
    }
  }

  // Check for webcam integration
  const webcamHookPath = path.join(process.cwd(), 'src/hooks/useWebcam.ts');
  if (fs.existsSync(webcamHookPath)) {
    const content = fs.readFileSync(webcamHookPath, 'utf-8');
    
    if (content.includes('getUserMedia') && content.includes('toDataURL')) {
      addCheck('Architecture', 'Webcam Integration', 'PASS', 'Frame capture implemented');
    } else {
      addCheck('Architecture', 'Webcam Integration', 'FAIL', 'Webcam capture incomplete');
    }
  }
}

// Print Results
function printResults() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${colors.cyan}SYSTEM HEALTH CHECK RESULTS${colors.reset}`);
  console.log(`${'='.repeat(70)}\n`);

  let totalPass = 0;
  let totalWarn = 0;
  let totalFail = 0;

  for (const result of results) {
    console.log(`${colors.cyan}${result.category}:${colors.reset}`);
    
    for (const check of result.checks) {
      const statusColor = 
        check.status === 'PASS' ? colors.green :
        check.status === 'WARN' ? colors.yellow :
        colors.red;
      
      console.log(`  [${statusColor}${check.status}${colors.reset}] ${check.name}: ${check.message}`);
      
      if (check.status === 'PASS') totalPass++;
      else if (check.status === 'WARN') totalWarn++;
      else totalFail++;
    }
    console.log('');
  }

  console.log(`${'='.repeat(70)}`);
  console.log(`${colors.green}PASSED: ${totalPass}${colors.reset} | ${colors.yellow}WARNINGS: ${totalWarn}${colors.reset} | ${colors.red}FAILED: ${totalFail}${colors.reset}`);
  console.log(`${'='.repeat(70)}\n`);

  if (totalFail > 0) {
    console.log(`${colors.red}❌ System is NOT ready for deployment${colors.reset}`);
    console.log(`${colors.yellow}Please fix the failed checks before proceeding.${colors.reset}\n`);
    process.exit(1);
  } else if (totalWarn > 0) {
    console.log(`${colors.yellow}⚠️  System is ready with warnings${colors.reset}`);
    console.log(`${colors.yellow}Consider addressing warnings for production deployment.${colors.reset}\n`);
  } else {
    console.log(`${colors.green}✅ System is ready for deployment!${colors.reset}\n`);
  }
}

// Run all checks
async function runHealthCheck() {
  console.log(`${colors.cyan}╔═══════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║          DIGITAL PERSONA - SYSTEM HEALTH CHECK                    ║${colors.reset}`);
  console.log(`${colors.cyan}╚═══════════════════════════════════════════════════════════════════╝${colors.reset}`);

  checkEnvironment();
  checkAssets();
  checkDependencies();
  checkCodeStructure();
  checkConstants();
  checkBuildConfig();
  checkArchitecture();
  
  printResults();
}

runHealthCheck().catch(console.error);
