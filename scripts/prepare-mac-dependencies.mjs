import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin') throw new Error('This dependency preparation is for macOS.');
const projectRequire = createRequire(path.join(root, 'package.json'));
const transformerRequire = createRequire(projectRequire.resolve('@huggingface/transformers'));
const onnxDirectory = path.dirname(transformerRequire.resolve('onnxruntime-node/package.json'));
const sharp = JSON.parse(await readFile(path.join(root, 'node_modules/sharp/package.json'), 'utf8'));
const work = path.join(root, 'work', 'mac-dependencies');
await mkdir(work, { recursive: true });
for (const arch of ['arm64', 'x64']) {
  // ONNX 1.24 stopped shipping Intel Mac bindings. The lockfile pins 1.23.2.
  await access(path.join(onnxDirectory, 'bin/napi-v6/darwin', arch, 'onnxruntime_binding.node'));
  for (const name of [`@img/sharp-darwin-${arch}`, `@img/sharp-libvips-darwin-${arch}`]) {
    const destination = path.join(root, 'node_modules', name);
    try { await access(path.join(destination, 'package.json')); continue; } catch { /* Install the missing optional architecture. */ }
    const temporary = await mkdtemp(path.join(work, 'package-'));
    const { stdout } = await execute('npm', ['pack', `${name}@${sharp.optionalDependencies[name]}`, '--json', '--pack-destination', temporary], { cwd: root });
    const [packed] = JSON.parse(stdout);
    if (packed.filename !== path.basename(packed.filename)) throw new Error('Unexpected registry archive filename.');
    await mkdir(destination, { recursive: true });
    await execute('tar', ['-xzf', path.join(temporary, packed.filename), '--strip-components=1', '-C', destination]);
    console.log(`[dependencies] Prepared ${name}@${sharp.optionalDependencies[name]}`);
  }
}
