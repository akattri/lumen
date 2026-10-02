import os
import sys

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
PYLIB_DIR = os.path.join(BASE_DIR, 'pylib')
if os.path.exists(PYLIB_DIR) and PYLIB_DIR not in sys.path:
    sys.path.append(PYLIB_DIR)

# In serverless environments like Vercel or AWS Lambda, the root filesystem is read-only.
# SQLite and writable data must reside in /tmp.
is_serverless = bool(os.environ.get('VERCEL') or os.environ.get('AWS_LAMBDA_FUNCTION_NAME'))
if is_serverless:
    DATA_DIR = os.environ.get('DATA_DIR', '/tmp/data')
else:
    DATA_DIR = os.environ.get('DATA_DIR', os.path.join(BASE_DIR, 'data'))

os.makedirs(DATA_DIR, exist_ok=True)

DB_PATH = os.environ.get('DB_PATH', os.path.join(DATA_DIR, 'calalog.db'))
SECRET_KEY = os.environ.get('SECRET_KEY', 'calalog-secret-session-key-waterloo-2026')
PORT = int(os.environ.get('PORT', 3000))
HOST = os.environ.get('HOST', '0.0.0.0')
DEBUG = os.environ.get('DEBUG', 'False').lower() in ('true', '1')
