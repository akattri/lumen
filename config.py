import os
import sys

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
PYLIB_DIR = os.path.join(BASE_DIR, 'pylib')
if os.path.exists(PYLIB_DIR) and PYLIB_DIR not in sys.path:
    sys.path.insert(0, PYLIB_DIR)

DATA_DIR = os.path.join(BASE_DIR, 'data')
os.makedirs(DATA_DIR, exist_ok=True)

DB_PATH = os.path.join(DATA_DIR, 'calalog.db')
SECRET_KEY = os.environ.get('SECRET_KEY', 'calalog-secret-session-key-waterloo-2026')
PORT = int(os.environ.get('PORT', 3000))
HOST = os.environ.get('HOST', '0.0.0.0')
DEBUG = os.environ.get('DEBUG', 'False').lower() in ('true', '1')
