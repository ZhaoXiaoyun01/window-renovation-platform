import asyncio
import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

test_data = tempfile.TemporaryDirectory()
os.environ.setdefault('WINDOW_DATA_DIR', test_data.name)
from fastapi.testclient import TestClient
from backend.main import app
from backend import config, subscriptions
from backend.providers import completion


class SubscriptionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name)/'windows.sqlite3'
        self.patches = [patch.object(config, 'DB', self.db), patch.object(subscriptions, 'DB', self.db)]
        for item in self.patches:
            item.start()
        self.client = TestClient(app)

    def tearDown(self):
        subscriptions.shutdown()
        for session in list(subscriptions._sessions.values()):
            thread = session.get('thread')
            if thread:
                thread.join(timeout=2)
        subscriptions._sessions.clear()
        self.client.close()
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_sdk_catalog_and_missing_auth(self):
        result = self.client.get('/api/subscriptions')
        self.assertEqual(result.status_code, 200)
        providers = result.json()['providers']
        self.assertEqual({p['id'] for p in providers}, set(subscriptions.IDS))
        self.assertTrue(all(p['models'] and not p['authorized'] for p in providers))
        result = asyncio.run(subscriptions.completion({'pi_provider': 'openai', 'model': 'gpt-test'}, []))
        self.assertEqual(result, ('NOT_CONFIGURED', ''))

    def test_credentials_dpapi_and_public_metadata(self):
        secret = {'type': 'oauth', 'access': 'secret-access-for-test', 'refresh': 'secret-refresh-for-test', 'expires': 1}
        subscriptions._save('openai', secret)
        self.assertEqual(subscriptions._read('openai'), secret)
        raw = self.db.read_bytes()
        self.assertNotIn(secret['access'].encode(), raw)
        self.assertNotIn(secret['refresh'].encode(), raw)
        self.assertEqual(subscriptions.connected(), {'openai'})
        result = self.client.get('/api/subscriptions')
        self.assertNotIn(secret['access'], result.text)
        self.assertNotIn(secret['refresh'], result.text)
        self.assertTrue(result.json()['providers'][0]['authorized'])

    def test_selection_preserves_api_and_restores_it(self):
        original = {'provider': 'gemini', 'model': 'gemini-2.5-flash', 'api_key': 'existing-api-secret'}
        self.assertEqual(self.client.post('/api/settings', json=original).status_code, 200)
        subscriptions._save('openai', {'type': 'oauth', 'access': 'fake', 'refresh': 'fake', 'expires': 1})
        catalog = self.client.get('/api/subscriptions').json()['providers']
        model = catalog[0]['models'][0]['id']
        selection = {'provider': 'pi', 'pi_provider': 'openai', 'model': model}
        result = self.client.post('/api/settings', json=selection)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['provider'], 'pi')
        self.assertTrue(result.json()['api_config']['key_configured'])
        self.assertEqual(config.read_api_config()['api_key'], original['api_key'])
        self.assertNotIn(original['api_key'], result.text)
        self.assertEqual(self.client.post('/api/settings', json={'provider': 'gemini', 'model': original['model']}).status_code, 200)
        self.assertEqual(config.read_config()['api_key'], original['api_key'])
        self.assertEqual(subscriptions.connected(), {'openai'})

    def test_invalid_or_unauthorized_selection_rejected(self):
        value = {'provider': 'pi', 'pi_provider': 'openai', 'model': 'invented'}
        self.assertEqual(self.client.post('/api/settings', json=value).status_code, 422)
        subscriptions._save('openai', {'type': 'oauth', 'access': 'fake', 'refresh': 'fake', 'expires': 1})
        self.assertEqual(self.client.post('/api/settings', json=value).status_code, 422)
        self.assertEqual(config.read_config()['provider'], 'pollinations')

    def test_visual_model_must_support_images(self):
        subscriptions._save('openai', {'type': 'oauth', 'access': 'fake', 'refresh': 'fake', 'expires': 1})
        models = [{'id': 'text', 'vision': False}]
        with patch.object(subscriptions, '_catalog', return_value=[{'id': 'openai', 'models': models}]):
            response = self.client.post('/api/settings', json={'provider': 'pi', 'pi_provider': 'openai', 'model': 'text', 'vision_model': 'text'})
        self.assertEqual(response.status_code, 422)

    def test_disconnect_removes_only_selected_account(self):
        for provider in ('openai', 'anthropic'):
            subscriptions._save(provider, {'type': 'oauth', 'access': 'fake', 'refresh': 'fake', 'expires': 1})
        self.assertEqual(self.client.post('/api/subscriptions/openai/disconnect').status_code, 200)
        self.assertEqual(subscriptions.connected(), {'anthropic'})

    def test_clear_api_key_never_persists_plaintext(self):
        response = self.client.post('/api/settings', json={'provider': 'gemini', 'model': 'test', 'api_key': 'discard-me', 'clear_key': True})
        self.assertFalse(response.json()['key_configured'])
        self.assertNotIn(b'discard-me', self.db.read_bytes())

    def test_local_origin_guard_and_session_validation(self):
        self.assertEqual(self.client.post('/api/subscriptions/login', json={'provider': 'openai'}, headers={'origin': 'https://evil.example'}).status_code, 403)
        self.assertEqual(self.client.post('/api/subscriptions/login', json={'provider': 'invented'}).status_code, 422)
        self.assertEqual(self.client.get('/api/subscriptions/sessions/missing').status_code, 404)
        subscriptions._sessions['test'] = dict(id='test', provider='openai', status='PENDING', events=[], prompt={'id': 'current', 'type': 'select', 'options': [{'id': 'ok'}]}, created=time.monotonic())
        self.assertEqual(self.client.post('/api/subscriptions/sessions/test/reply', json={'prompt_id': 'old', 'value': 'code'}).status_code, 409)
        self.assertEqual(self.client.post('/api/subscriptions/sessions/test/reply', json={'prompt_id': 'current', 'value': 'bad-option'}).status_code, 422)
        result = self.client.post('/api/subscriptions/sessions/test/reply', json={'prompt_id': 'current', 'value': 'private-authorization-code'*400})
        self.assertEqual(result.status_code, 422)
        self.assertNotIn('private-authorization-code', result.text)

    def test_real_sdk_login_start_prompt_and_cancel(self):
        # Start real SDK OAuth without logging into or calling a user's account.
        started = self.client.post('/api/subscriptions/login', json={'provider': 'anthropic'})
        self.assertEqual(started.status_code, 200)
        sid = started.json()['id']
        self.assertEqual(self.client.post('/api/subscriptions/login', json={'provider': 'anthropic'}).json()['id'], sid)
        deadline = time.monotonic()+15
        while time.monotonic()<deadline:
            result = self.client.get('/api/subscriptions/sessions/'+sid).json()
            if result['prompt'] or result['events'] or result['status'] != 'PENDING':
                break
            time.sleep(.1)
        self.assertEqual(result['status'], 'PENDING')
        self.assertEqual(result['prompt']['type'], 'select')
        process = subscriptions._sessions[sid]['process']
        result = self.client.post('/api/subscriptions/sessions/'+sid+'/cancel')
        self.assertEqual(result.json()['status'], 'CANCELLED')
        self.assertIsNone(result.json()['prompt'])
        self.assertEqual(process.wait(timeout=5), process.returncode)
        self.assertFalse(subscriptions.connected())

    def test_completion_routes_through_bridge(self):
        from unittest.mock import AsyncMock
        active = {'provider': 'pi', 'pi_provider': 'anthropic', 'model': 'test', 'vision_model': ''}
        with patch('backend.providers.read_config', return_value=active), patch.object(subscriptions, 'completion', new=AsyncMock(return_value=('OK', 'reply'))) as call:
            self.assertEqual(asyncio.run(completion([{'role': 'user', 'content': 'test'}])), ('OK', 'reply'))
            self.assertEqual(call.call_args.args[0], active)

    def _sdk_completion(self, fail=False):
        subscriptions._save('anthropic', {'type': 'oauth', 'access': 'test-expired', 'refresh': 'test-original-refresh', 'expires': 1})
        original_popen = subscriptions.subprocess.Popen
        fixture = subscriptions.ROOT/'model-bridge/test/fetch-fixture.mjs'
        def popen(args, **kwargs):
            kwargs['env'] = {**os.environ, 'WINDOW_PI_TEST_FAIL': '1' if fail else '0'}
            return original_popen([args[0], '--import', fixture.as_uri(), *args[1:]], **kwargs)
        with patch.object(subscriptions.subprocess, 'Popen', side_effect=popen):
            return asyncio.run(subscriptions.completion(
                {'pi_provider': 'anthropic', 'model': 'claude-sonnet-4-5', 'vision_model': ''},
                [{'role': 'system', 'content': 'Use supplied evidence.'}, {'role': 'user', 'content': 'fixture question'}]))

    def test_real_sdk_refresh_persists_before_completion(self):
        self.assertEqual(self._sdk_completion(), ('OK', 'SDK fixture response'))
        self.assertEqual(subscriptions._read('anthropic')['refresh'], 'test-refresh-rotated')
        self.assertNotIn(b'sk-ant-oat01-test-rotated', self.db.read_bytes())

    def test_real_sdk_failed_refresh_preserves_credential(self):
        status, text = self._sdk_completion(fail=True)
        self.assertNotEqual(status, 'OK')
        self.assertEqual(text, '')
        self.assertEqual(subscriptions._read('anthropic')['refresh'], 'test-original-refresh')

    def test_only_requested_video_is_current_source(self):
        from backend.sources import get_sources
        videos = [s for s in get_sources() if s['kind'].startswith('从业者视频')]
        self.assertEqual([v['id'] for v in videos], ['BV1FiPTz2EBr'])
        self.assertEqual(len(videos[0]['chapters']), 10)
