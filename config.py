import os

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

# Data directory (use /tmp in serverless environments like Vercel)
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
