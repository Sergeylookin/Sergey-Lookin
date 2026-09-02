"""serve.py — локальный сервер для разработки.

То же, что `python -m http.server`, но с запретом кэширования. Штатный
http.server отдаёт только Last-Modified и не ставит Cache-Control, поэтому
браузер по эвристике держит уже открытую страницу в кэше и правки «не видно»
без жёсткой перезагрузки. На этом мы теряли время не один раз.

    python tools/serve.py [порт]      # по умолчанию 8140

Только для разработки: на GitHub Pages заголовки свои.
"""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8140
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):          # тише в консоли
        if '404' in (fmt % args):
            super().log_message(fmt, *args)


socketserver.ThreadingTCPServer.allow_reuse_address = True

if __name__ == '__main__':
    with socketserver.ThreadingTCPServer(('', PORT), NoCacheHandler) as httpd:
        print('serving %s on http://localhost:%d  (no-store)' % (ROOT, PORT))
        httpd.serve_forever()
