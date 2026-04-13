import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(projectRoot, 'build', 'native');

mkdirSync(outputDir, { recursive: true });

if (process.platform === 'darwin') {
  const src = path.join(projectRoot, 'swift', 'OpenWhispHelper.swift');
  const out = path.join(outputDir, 'openwhisp-helper');
  console.log('[build] Compiling Swift helper for macOS...');
  execFileSync('swiftc', [src, '-o', out], { stdio: 'inherit' });
  console.log('[build] Swift helper compiled.');
} else if (process.platform === 'win32') {
  const src = path.join(projectRoot, 'windows', 'OpenWhispHelper.cpp');
  const out = path.join(outputDir, 'openwhisp-helper.exe');
  console.log('[build] Compiling C++ helper for Windows...');
  try {
    execFileSync('cl.exe', ['/O2', '/W3', src, '/link', 'user32.lib', 'kernel32.lib', `/out:${out}`], { stdio: 'inherit' });
  } catch {
    console.log('[build] cl.exe not found. Trying g++ (MinGW)...');
    execFileSync('g++', ['-O2', '-o', out, src, '-luser32', '-lkernel32'], { stdio: 'inherit' });
  }
  console.log('[build] Windows helper compiled.');
} else {
  console.log(`[build] Unsupported platform: ${process.platform}. Skipping native helper.`);
}
