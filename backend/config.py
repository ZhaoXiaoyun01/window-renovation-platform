"""Local provider configuration. API keys use the Windows user's DPAPI key."""
import base64
import ctypes
import json
import os
import sqlite3
from pathlib import Path
from urllib.parse import urlparse

DATA = Path(os.getenv('WINDOW_DATA_DIR', Path(__file__).resolve().parents[1] / 'data'))
DATA.mkdir(parents=True, exist_ok=True)
DB = DATA / 'windows.sqlite3'


def _crypt(raw, decrypt=False):
    if os.name != 'nt':
        raise RuntimeError('本地密钥保存仅支持 Windows DPAPI')
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_char))]
    source = ctypes.create_string_buffer(raw)
    incoming = Blob(len(raw), ctypes.cast(source, ctypes.POINTER(ctypes.c_char)))
    outgoing = Blob()
    api = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if decrypt:
        api.argtypes = [ctypes.POINTER(Blob), ctypes.POINTER(ctypes.c_wchar_p), ctypes.c_void_p,
                        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    else:
        api.argtypes = [ctypes.POINTER(Blob), ctypes.c_wchar_p, ctypes.c_void_p,
                        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    api.restype = wintypes.BOOL
    ctypes.windll.kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    ctypes.windll.kernel32.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        ok = api(ctypes.byref(incoming), None, None, None, None, 0, ctypes.byref(outgoing))
    else:
        ok = api(ctypes.byref(incoming), 'window-review', None, None, None, 0, ctypes.byref(outgoing))
    if not ok:
        raise OSError('Windows DPAPI 无法读取或保存密钥')
    try:
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        ctypes.windll.kernel32.LocalFree(outgoing.data)


def _defaults():
    return {'provider': 'openai' if os.getenv('WINDOW_LLM_BASE_URL') else 'pollinations',
            'model': os.getenv('WINDOW_LLM_MODEL', 'openai'),
            'vision_model': os.getenv('WINDOW_VISION_MODEL', ''),
            'base_url': os.getenv('WINDOW_LLM_BASE_URL', ''),
            'api_key': os.getenv('WINDOW_LLM_API_KEY', '')}


def read_api_config():
    with sqlite3.connect(DB) as c:
        c.execute('CREATE TABLE IF NOT EXISTS provider_config(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)')
        row = c.execute('SELECT body FROM provider_config WHERE id=1').fetchone()
    if not row:
        return _defaults()
    body = json.loads(row[0]); body['api_key'] = _crypt(base64.b64decode(body.pop('secret')), True).decode() if body.get('secret') else ''
    return body


def read_config():
    with sqlite3.connect(DB) as c:
        c.execute('CREATE TABLE IF NOT EXISTS provider_selection(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)')
        row = c.execute('SELECT body FROM provider_selection WHERE id=1').fetchone()
    return json.loads(row[0]) if row else read_api_config()


def save_config(value):
    old = read_api_config()
    body = value.model_dump()
    if body['provider'] == 'pi':
        selection = {key: body[key] for key in ('provider', 'pi_provider', 'model', 'vision_model')}
        with sqlite3.connect(DB) as c:
            c.execute('CREATE TABLE IF NOT EXISTS provider_selection(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)')
            c.execute('INSERT OR REPLACE INTO provider_selection VALUES(1,?)', (json.dumps(selection),))
        return public_config()
    body.pop('pi_provider', None)
    if body['provider'] == 'openai':
        parsed = urlparse(body['base_url'])
        if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost')):
            raise ValueError('自定义接口须为 HTTPS 或本机地址')
    clear = body.pop('clear_key')
    entered = body.pop('api_key')
    key = '' if clear else entered or (old['api_key'] if old['provider'] == body['provider'] else '')
    body['secret'] = base64.b64encode(_crypt(key.encode())).decode() if key else ''
    with sqlite3.connect(DB) as c:
        c.execute('INSERT OR REPLACE INTO provider_config VALUES(1,?)', (json.dumps(body, ensure_ascii=False),))
        c.execute('CREATE TABLE IF NOT EXISTS provider_selection(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)')
        c.execute('DELETE FROM provider_selection')
    return public_config()


def public_config():
    body = read_config()
    if body['provider'] == 'pi':
        from .subscriptions import connected
        api = read_api_config()
        return {**body, 'base_url': '', 'key_configured': body['pi_provider'] in connected(),
                'api_config': {k: v for k, v in api.items() if k != 'api_key'} | {'key_configured': bool(api['api_key'])}}
    return {k: v for k, v in body.items() if k != 'api_key'} | {'key_configured': bool(body['api_key'])}
