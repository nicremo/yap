import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(projectRoot, 'build', 'native');

mkdirSync(outputDir, { recursive: true });

/* The helper ships as a universal binary, so one build works on Apple
   Silicon and Intel no matter which machine produced it. */
function buildMac() {
  const source = path.join(projectRoot, 'swift', 'YapHelper.swift');
  const output = path.join(outputDir, 'yap-helper');
  const slices = [];

  for (const arch of ['arm64', 'x86_64']) {
    const slice = path.join(outputDir, `yap-helper-${arch}`);
    try {
      console.log(`[build] Compiling Swift helper (${arch})...`);
      execFileSync('swiftc', ['-O', '-target', `${arch}-apple-macos12.0`, source, '-o', slice], { stdio: 'inherit' });
      slices.push(slice);
    } catch {
      console.warn(`[build] ${arch} slice failed, continuing without it.`);
    }
  }

  if (slices.length === 0) {
    throw new Error('The Swift helper could not be compiled for any architecture.');
  }

  execFileSync('lipo', ['-create', ...slices, '-output', output], { stdio: 'inherit' });
  for (const slice of slices) rmSync(slice, { force: true });
  execFileSync('lipo', ['-info', output], { stdio: 'inherit' });
}

function buildWindows() {
  const source = path.join(projectRoot, 'windows', 'YapHelper.cpp');
  const output = path.join(outputDir, 'yap-helper.exe');
  console.log('[build] Compiling C++ helper for Windows...');
  try {
    execFileSync('cl.exe', ['/O2', '/W3', source, '/link', 'user32.lib', 'kernel32.lib', `/out:${output}`], { stdio: 'inherit' });
  } catch {
    console.log('[build] cl.exe not found. Trying g++ (MinGW)...');
    execFileSync('g++', ['-O2', '-o', output, source, '-luser32', '-lkernel32'], { stdio: 'inherit' });
  }
}

if (process.platform === 'darwin') {
  buildMac();
} else if (process.platform === 'win32') {
  buildWindows();
} else {
  console.log(`[build] No native helper for ${process.platform}.`);
}
