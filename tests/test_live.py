"""/api/live without a network: python -m unittest discover -s tests -v."""
import asyncio
import json
import unittest

from bacon import server


def post(path, body):
    """One request through the ASGI app itself, so routing and validation are exercised too. -> (status, json)."""
    sent = []
    data = json.dumps(body).encode()

    async def receive():
        return {'type': 'http.request', 'body': data, 'more_body': False}

    async def send(message):
        sent.append(message)

    scope = {'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1', 'method': 'POST', 'scheme': 'http',
             'path': path, 'raw_path': path.encode(), 'query_string': b'', 'root_path': '',
             'headers': [(b'host', b'127.0.0.1'), (b'content-type', b'application/json')],
             'client': ('127.0.0.1', 1), 'server': ('127.0.0.1', 8047)}
    asyncio.run(server.app(scope, receive, send))
    start = next(m for m in sent if m['type'] == 'http.response.start')
    payload = b''.join(m.get('body', b'') for m in sent if m['type'] == 'http.response.body')
    return start['status'], json.loads(payload)


def targets(n):
    return [{'device': 1, 'typeId': 2, 'instance': i, 'key': f'1:2,{i}'} for i in range(n)]


class Live(unittest.TestCase):
    def setUp(self):
        self.assertIsNone(server.client.app)  # nothing here opens a BACnet socket

    def test_not_connected(self):
        status, body = post('/api/live', {'targets': targets(1)})
        self.assertEqual(status, 400)
        self.assertIn('Connect', body['detail'])

    def test_too_many_targets(self):
        status, body = post('/api/live', {'targets': targets(401)})
        self.assertEqual(status, 400)
        self.assertIn('400', body['detail'])

    def test_limit_is_checked_before_the_connection(self):
        # 400 objects is allowed: the refusal is then only for being offline
        status, body = post('/api/live', {'targets': targets(400)})
        self.assertEqual(status, 400)
        self.assertIn('Connect', body['detail'])


if __name__ == '__main__': unittest.main()
