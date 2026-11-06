"""pi-ai subscription bridge. Persist only DPAPI ciphertext; serialize token refresh."""
import asyncio
import base64
import json
import shutil
import sqlite3
import subprocess
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Literal
from .config import DB, _crypt

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / 'model-bridge' / 'bridge.mjs'
Provider = Literal['openai', 'openai-codex', 'anthropic', 'github-copilot']
IDS = ('openai', 'openai-codex', 'anthropic', 'github-copilot')
router = APIRouter(prefix='/api/subscriptions')
_locks = {key: threading.RLock() for key in IDS}
_sessions = {}
_guard = threading.RLock()


@contextmanager
def _database():
    con = sqlite3.connect(DB)
    try:
        with con:
            con.execute('CREATE TABLE IF NOT EXISTS subscription_credentials(provider TEXT PRIMARY KEY, secret TEXT NOT NULL)')
            yield con
    finally:
        con.close()


def connected():
    with _database() as con:
        return {row[0] for row in con.execute('SELECT provider FROM subscription_credentials')}


def _read(provider):
    with _database() as con:
        row = con.execute('SELECT secret FROM subscription_credentials WHERE provider=?', (provider,)).fetchone()
    return json.loads(_crypt(base64.b64decode(row[0]), True)) if row else None


def _save(provider, value):
    secret = base64.b64encode(_crypt(json.dumps(value).encode())).decode() if value else None
    with _database() as con:
        if secret:
            con.execute('INSERT OR REPLACE INTO subscription_credentials VALUES(?,?)', (provider, secret))
        else:
            con.execute('DELETE FROM subscription_credentials WHERE provider=?', (provider,))


def _send(process, value):
    process.stdin.write(json.dumps(value, ensure_ascii=False)+'\n')
    process.stdin.flush()


def _invoke(request, session=None):
    node = shutil.which('node')
    if not node or not (BRIDGE.parent/'node_modules/@earendil-works/pi-ai/package.json').exists():
        raise RuntimeError('BRIDGE_UNAVAILABLE')
    provider = request.get('provider')
    credentials = {key: value for key in ([provider] if provider else IDS) if (value := _read(key))}
    process = subprocess.Popen([node, str(BRIDGE)], cwd=BRIDGE.parent, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
                               creationflags=subprocess.CREATE_NO_WINDOW)
    timer = threading.Timer(610 if session else 85, process.kill)
    timer.daemon = True
    timer.start()
    try:
        if session:
            with _guard:
                session['process'] = process
                if session['status'] == 'CANCELLED':
                    raise RuntimeError('CANCELLED')
        _send(process, {**request, 'credentials': credentials})
        for line in process.stdout:
            event = json.loads(line)
            if event['type'] == 'credential':
                if event['provider'] != provider:
                    raise RuntimeError('INVALID_PROVIDER')
                _save(provider, event['value'])
                _send(process, {'id': event['id'], 'ok': True})
            elif event['type'] == 'result':
                return event['value']
            elif event['type'] == 'error':
                raise RuntimeError(event['status'])
            elif session:
                with _guard:
                    if session['status'] == 'CANCELLED':
                        raise RuntimeError('CANCELLED')
                    if event['type'] == 'event':
                        session['events'] = (session['events']+[event['event']])[-20:]
                    elif event['type'] == 'prompt':
                        session['prompt'] = {'id': event['id'], **event['prompt']}
                    elif event['type'] == 'prompt_cancelled' and (session.get('prompt') or {}).get('id') == event['id']:
                        session['prompt'] = None
        raise RuntimeError('PROVIDER_FAILED')
    finally:
        timer.cancel()
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdin.close()
        process.stdout.close()


def _catalog():
    # Catalog reads never refresh credentials or require a connected account.
    result = _invoke({'action': 'catalog'})
    accounts = connected()
    return [{**item, 'authorized': item['id'] in accounts} for item in result]


@router.get('')
async def catalog():
    try:
        return {'providers': await asyncio.to_thread(_catalog), 'sdk': '@earendil-works/pi-ai 1.3.0'}
    except Exception:
        raise HTTPException(503, '订阅接入组件不可用，请检查 Node.js 和 model-bridge 依赖。') from None


def _view(session):
    return {key: session.get(key) for key in ('id', 'provider', 'status', 'events', 'prompt', 'error')}


def _get(sid):
    session = _sessions.get(sid)
    if not session:
        raise HTTPException(404, '授权会话不存在或已过期，请重新登录。')
    return session


def _login(session):
    try:
        with _locks[session['provider']]:
            _invoke({'action': 'login', 'provider': session['provider']}, session)
        with _guard:
            if session['status'] != 'CANCELLED':
                session.update(status='AUTHORIZED', prompt=None)
    except Exception:
        with _guard:
            if session['status'] != 'CANCELLED':
                session.update(status='FAILED', prompt=None, error='授权未完成、已超时或服务商拒绝请求，请重新登录。')
    finally:
        with _guard:
            session.pop('process', None)


class Login(BaseModel):
    provider: Provider


class Reply(BaseModel):
    prompt_id: str = Field(max_length=100)
    value: str = Field(min_length=1, max_length=8192)


@router.post('/login')
def login(value: Login):
    with _guard:
        for sid, old in list(_sessions.items()):
            if old['status'] != 'PENDING' and time.monotonic()-old['created'] > 1800:
                del _sessions[sid]
        for old in _sessions.values():
            if old['status'] == 'PENDING':
                if old['provider'] == value.provider:
                    return _view(old)
                raise HTTPException(409, '请先完成或取消当前订阅登录。')
        session = dict(id=uuid.uuid4().hex, provider=value.provider, status='PENDING', events=[],
                       prompt=None, error=None, created=time.monotonic())
        _sessions[session['id']] = session
        thread = threading.Thread(target=_login, args=(session,), daemon=True)
        session['thread'] = thread
        thread.start()
        return _view(session)


@router.get('/sessions/{sid}')
def status(sid: str):
    with _guard:
        return _view(_get(sid))


@router.post('/sessions/{sid}/reply')
def reply(sid: str, value: Reply):
    with _guard:
        session = _get(sid)
        prompt = session.get('prompt')
        if session['status'] != 'PENDING' or not prompt or prompt['id'] != value.prompt_id:
            raise HTTPException(409, '该授权步骤已结束，请使用最新页面提示。')
        if prompt['type'] == 'select' and value.value not in [x['id'] for x in prompt['options']]:
            raise HTTPException(422, '请选择有效的授权选项。')
        try:
            _send(session['process'], {'id': value.prompt_id, 'value': value.value})
        except (OSError, KeyError, ValueError):
            raise HTTPException(409, '授权进程已结束，请重新登录。') from None
        session['prompt'] = None
        return _view(session)


@router.post('/sessions/{sid}/cancel')
def cancel(sid: str):
    with _guard:
        session = _get(sid)
        if session['status'] == 'PENDING':
            session.update(status='CANCELLED', prompt=None)
            process = session.get('process')
            if process and process.poll() is None:
                process.kill()
        return _view(session)


@router.post('/{provider}/disconnect')
def disconnect(provider: Provider):
    with _guard:
        for session in _sessions.values():
            if session['provider'] == provider and session['status'] == 'PENDING':
                cancel(session['id'])
    with _locks[provider]:
        _save(provider, None)
    return {'status': 'DISCONNECTED'}


async def validate_selection(provider, model, vision_model):
    if provider not in connected():
        raise ValueError('请先完成该订阅账号的授权。')
    catalog = await asyncio.to_thread(_catalog)
    models = {m['id']: m for p in catalog if p['id'] == provider for m in p['models']}
    if model not in models or (vision_model and (vision_model not in models or not models[vision_model]['vision'])):
        raise ValueError('请选择目录中的文本模型及支持图像输入的视觉模型。')


async def completion(config, messages, vision=False):
    provider = config['pi_provider']
    if provider not in connected():
        return 'NOT_CONFIGURED', ''
    model = config['vision_model'] if vision else config['model']
    if not model:
        return 'VISION_NOT_CONFIGURED', ''
    def call():
        with _locks[provider]:
            return _invoke({'action': 'complete', 'provider': provider, 'model': model, 'messages': messages})
    try:
        result = await asyncio.to_thread(call)
        return result['status'], result['text']
    except Exception:
        return 'CONNECTION_FAILED', ''


def shutdown():
    with _guard:
        for session in _sessions.values():
            if session['status'] == 'PENDING':
                cancel(session['id'])
