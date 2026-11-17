#!/usr/bin/env python3
"""
Immich Pinterest - Local Dev Server & CORS Proxy
Runs a local static server with zero dependencies and seamlessly proxies
/api requests to http://192.168.79.2:2283 to bypass browser CORS restrictions.
"""

import sys
import os
import gzip
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = int(os.environ.get('PORT', 8080))
TARGET_IMMICH = os.environ.get('IMMICH_URL', 'http://localhost:2283').rstrip('/')

class ImmichProxyHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers for local development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD')
        self.send_header('Access-Control-Allow-Headers', 'x-api-key, Content-Type, Authorization')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_HEAD(self):
        if self.path.startswith('/api/'):
            self.proxy_request('HEAD')
        else:
            super().do_HEAD()

    def do_GET(self):
        if self.path.startswith('/api/'):
            self.proxy_request('GET')
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/'):
            self.proxy_request('POST')
        else:
            self.send_error(404, "Not Found")

    def proxy_request(self, method):
        target_url = f"{TARGET_IMMICH}{self.path}"
        
        # Read request body if POST
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        # Prepare headers for Immich target
        headers = {}
        for key, value in self.headers.items():
            k_lower = key.lower()
            if k_lower not in ['host', 'origin', 'referer', 'content-length']:
                headers[key] = value

        # Ensure plain response without compression encoding issues
        headers['Accept-Encoding'] = 'identity'

        req = urllib.request.Request(target_url, data=body, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                raw_data = response.read()
                # If upstream still returned gzip, decompress it
                if response.headers.get('Content-Encoding') == 'gzip' or (len(raw_data) > 2 and raw_data[:2] == b'\x1f\x8b'):
                    try:
                        raw_data = gzip.decompress(raw_data)
                    except Exception as gz_err:
                        print(f"Gzip decompress error: {gz_err}")

                self.send_response(response.status)
                for header, value in response.headers.items():
                    h_lower = header.lower()
                    if h_lower not in ['transfer-encoding', 'content-encoding', 'content-length']:
                        self.send_header(header, value)
                self.send_header('Content-Length', str(len(raw_data)))
                self.end_headers()
                self.wfile.write(raw_data)
        except urllib.error.HTTPError as e:
            raw_err = e.read()
            if e.headers.get('Content-Encoding') == 'gzip' or (len(raw_err) > 2 and raw_err[:2] == b'\x1f\x8b'):
                try:
                    raw_err = gzip.decompress(raw_err)
                except Exception:
                    pass
            self.send_response(e.code)
            for header, value in e.headers.items():
                h_lower = header.lower()
                if h_lower not in ['transfer-encoding', 'content-encoding', 'content-length']:
                    self.send_header(header, value)
            self.send_header('Content-Length', str(len(raw_err)))
            self.end_headers()
            self.wfile.write(raw_err)
        except Exception as e:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(f'{{"error": "Proxy error: {str(e)}"}}'.encode('utf-8'))

def run():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server_address = ('', PORT)
    httpd = ThreadingHTTPServer(server_address, ImmichProxyHandler)
    httpd.daemon_threads = True
    print("=" * 60)
    print(f" Immich Pinterest Gallery Server Running (Multi-threaded)!")
    print(f" -> Open in browser: http://localhost:{PORT}")
    print(f" -> Proxying /api to: {TARGET_IMMICH}")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()

if __name__ == '__main__':
    run()
