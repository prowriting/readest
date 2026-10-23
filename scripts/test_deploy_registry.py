"""Run the deployment script against a fake Azure CLI, including disabled admin auth."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "deploy.sh"


class RegistryDeploymentTests(unittest.TestCase):
    def test_existing_and_new_apps_use_managed_identity_with_admin_disabled(self):
        for existing, health, native_source, prebuilt in [(True, '200', True, False), (False, '200', True, False), (True, '503', True, False), (True, '200', False, False), (True, '200', False, True)]:
            with self.subTest(existing=existing, health=health, native_source=native_source), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "packages/foliate-js/vendor/pdfjs").mkdir(parents=True)
                (root / "packages/foliate-js/vendor/pdfjs/annotation_layer_builder.css").touch()
                (root / "packages/simplecc-wasm/dist/web").mkdir(parents=True)
                if native_source:
                    plugin = root / "apps/readest-app/src-tauri/plugins/tauri-plugin-turso/guest-js"
                    plugin.mkdir(parents=True)
                    (plugin / "index.ts").touch()
                log = root / "commands.jsonl"
                az = root / "az"
                az.write_text('''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['QA_AZ_LOG'], 'a') as log: log.write(json.dumps(args)+'\\n')
if args[:3] == ['acr','credential','show']: sys.exit(1)
if args[:2] == ['containerapp','show'] and '--query' not in args and os.environ['QA_APP_EXISTS']=='false': sys.exit(1)
if args[:3] == ['containerapp','env','show']: print('qa.azurecontainerapps.io')
elif args[:2] == ['identity','create']: print(json.dumps({'id':'/qa/identity','principalId':'qa-principal'}))
elif args[:2] == ['acr','show']: print('/qa/registry')
elif args[:3] == ['role','assignment','list']: print('0')
elif args[:2] == ['containerapp','show'] and 'properties.latestRevisionName' in args: print('qa-reader--candidate')
elif args[:3] == ['containerapp','revision','show']: print('qa-reader--candidate.qa.azurecontainerapps.io')
elif args[:2] == ['containerapp','show'] and 'properties.configuration.activeRevisionsMode' in args: print('Multiple')
elif args[:4] == ['containerapp','ingress','traffic','show']:
 print(json.dumps([{'revisionName':'qa-reader--candidate','weight':100}]))
elif args[:3] == ['containerapp','revision','list']:
 print(json.dumps([{'name':'qa-reader--candidate','properties':{'active':True,'trafficWeight':100}},
                   {'name':'qa-reader--old','properties':{'active':True,'trafficWeight':0}}]))
''')
                az.chmod(0o755)
                for name, output in [('sleep', ''), ('curl', '200')]:
                    executable = root / name
                    executable.write_text('#!/bin/sh\nprintf "%s" "$QA_HTTP_STATUS"\n' if name == 'curl' else '#!/bin/sh\nexit 0\n')
                    executable.chmod(0o755)
                environment = dict(os.environ, PATH=str(root)+os.pathsep+os.environ['PATH'],
                    QA_AZ_LOG=str(log), QA_APP_EXISTS=str(existing).lower(), ACR_NAME='qaacr',
                    CONTAINER_ENV_ID='/qa/environment', IMAGE_TAG='qa', APP_NAME='qa-reader', QA_HTTP_STATUS=health)
                if prebuilt:
                    environment['CONTAINER_APP_NAME'] = 'qa-reader-existing'
                    environment['PREBUILT_IMAGE'] = 'qaacr.azurecr.io/qa-reader-existing@sha256:' + '0' * 64
                result = subprocess.run(['bash', str(SCRIPT)], cwd=root, env=environment,
                    input='\n', capture_output=True, text=True)
                if not native_source and not prebuilt:
                    self.assertNotEqual(0, result.returncode, 'Missing native TypeScript source must fail before the build')
                    calls = [json.loads(line) for line in log.read_text().splitlines()]
                    self.assertFalse(any(c[:2] == ['acr', 'build'] for c in calls))
                    continue
                if health != '200':
                    self.assertNotEqual(0, result.returncode, 'An unavailable app must fail deployment')
                    calls = [json.loads(line) for line in log.read_text().splitlines()]
                    self.assertFalse(any(c[:4] == ['containerapp','ingress','traffic','set'] for c in calls))
                    continue
                self.assertEqual(0, result.returncode, result.stderr)
                calls = [json.loads(line) for line in log.read_text().splitlines()]
                if prebuilt:
                    self.assertFalse(any(c[:2] == ['acr','build'] for c in calls))
                    update = next(c for c in calls if c[:2] == ['containerapp','update'])
                    self.assertIn(environment['PREBUILT_IMAGE'], update)
                self.assertFalse(any(c[:3] == ['acr','credential','show'] for c in calls))
                self.assertTrue(any(c[:4] == ['containerapp','ingress','traffic','set'] for c in calls))
                retired = [c for c in calls if c[:3] == ['containerapp','revision','deactivate']]
                self.assertEqual(1, len(retired))
                self.assertIn('qa-reader--old', retired[0])
                if existing:
                    registry = next((c for c in calls if c[:3] == ['containerapp','registry','set']), [])
                    self.assertIn('--identity', registry)
                    self.assertIn('/qa/identity', registry)
                else:
                    create = next(c for c in calls if c[:2] == ['containerapp','create'])
                    self.assertIn('--registry-identity', create)
                    self.assertIn('/qa/identity', create)


if __name__ == '__main__':
    unittest.main()
