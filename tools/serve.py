"""serve.py — локальный сервер для разработки.

Отличия от `python -m http.server`, каждое лечит реальную потерю времени:

1. Запрет кэширования. Штатный сервер отдаёт только Last-Modified и не ставит
   Cache-Control, поэтому браузер по эвристике держит уже открытую страницу в
   кэше и правки «не видно» без жёсткой перезагрузки.

2. Сайт доступен и по корню, и по префиксу /Sergey-Lookin/ — как на GitHub
   Pages. Без этого 404.html локально рисовалась без стилей: в ней пути
   абсолютные (/Sergey-Lookin/assets/...), потому что относительные сломались
   бы для несуществующих адресов вида /projects/99.html.

3. Неизвестный адрес отдаёт 404.html со статусом 404 — тоже как GitHub Pages,
   чтобы страницу ошибки можно было смотреть локально.

    python tools/serve.py [порт]      # по умолчанию 8140

Только для разработки: на боевом заголовки и маршрутизация свои.
"""
import http.server
import os
import posixpath
import socketserver
import sys
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8140
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = '/Sergey-Lookin'          # префикс, под которым сайт живёт на GitHub Pages


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def translate_path(self, path):
        """Срезаем префиксный путь GitHub Pages, чтобы абсолютные адреса
        внутри 404.html находились и локально."""
        parsed = urllib.parse.urlsplit(path)
        clean = urllib.parse.unquote(parsed.path)
        if clean == BASE or clean.startswith(BASE + '/'):
            clean = clean[len(BASE):] or '/'
            path = urllib.parse.urlunsplit(('', '', clean, parsed.query, ''))
        return super().translate_path(path)

    def send_head(self):
        """Неизвестный адрес — своя страница ошибки со статусом 404."""
        path = self.translate_path(self.path)
        wants_page = not posixpath.basename(path) or path.endswith(('.html', '/'))
        if not os.path.exists(path) and wants_page:
            page = os.path.join(ROOT, '404.html')
            if os.path.exists(page):
                body = open(page, 'rb').read()
                self.send_response(404)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                import io as _io
                return _io.BytesIO(body)
        return super().send_head()

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
    with socketserver.ThreadingTCPServer(('', PORT), DevHandler) as httpd:
        print('serving %s on http://localhost:%d  (no-store, /Sergey-Lookin/ alias, 404 page)'
              % (ROOT, PORT))
        httpd.serve_forever()
