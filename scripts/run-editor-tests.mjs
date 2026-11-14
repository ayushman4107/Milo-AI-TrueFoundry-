import {runTests} from '@vscode/test-electron';
import {copyFile,mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=resolve('.');
await mkdir(join(root,'.runtime'),{recursive:true});
const base=await realpath(join(root,'.runtime'));
const directory=await mkdtemp(join(base,'command-host-'));
const workspace=join(directory,'workspace');
try {
  await mkdir(workspace);
  const git=spawnSync('git',['init',workspace],{encoding:'utf8',windowsHide:true});
  if(git.status!==0)throw new Error('Fixture git init failed');
  await runTests({extensionDevelopmentPath:root,extensionTestsPath:join(root,'dist/command-test.cjs'),...(process.env.MILO_VSCODE_EXECUTABLE?{vscodeExecutablePath:process.env.MILO_VSCODE_EXECUTABLE}:{}),launchArgs:[workspace,'--user-data-dir',join(directory,'profile'),'--extensions-dir',join(directory,'extensions'),'--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes'],extensionTestsEnv:{MILO_COMMAND_TEST:'1'}});
} finally {
  try {
    const results=join(root,'test-results');
    await mkdir(results,{recursive:true});
    await copyFile(join(workspace,'command-result.json'),join(results,'command-host.json'));
    console.log(`Command test evidence: ${join(results,'command-host.json')}`);
  } catch(error) {
    if(error.code!=='ENOENT')console.warn(`Could not retain command evidence: ${error.message}`);
  }
  // Only remove the fresh child allocated by this invocation, never a caller-supplied path.
  const target=await realpath(directory);
  if(dirname(target)!==base || !/^command-host-[A-Za-z0-9]+$/.test(basename(target)))throw new Error('Unsafe test cleanup target');
  await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:250});
}
