import os
import sys

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
PYLIB_DIR = os.path.join(BASE_DIR, 'pylib')
if os.path.exists(PYLIB_DIR) and PYLIB_DIR not in sys.path:
    sys.path.append(PYLIB_DIR)

from datetime import datetime, timedelta
from flask import Flask, render_template, jsonify
from config import SECRET_KEY, PORT, HOST, DEBUG
from models.db import init_db
from routes.auth import auth_bp
from routes.api import api_bp
from routes.views import views_bp
from services.youtube import format_seconds_to_time


def create_app():
    app = Flask(
        __name__,
        static_folder=os.path.join(BASE_DIR, 'static'),
        template_folder=os.path.join(BASE_DIR, 'templates')
    )
    app.config['SECRET_KEY'] = SECRET_KEY
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
    app.config['JSON_SORT_KEYS'] = False

    # Initialize Database tables
    init_db()

    # Register blueprints
    app.register_blueprint(views_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(api_bp)

    # Custom Jinja template filters
    @app.template_filter('format_time')
    def format_time_filter(seconds):
        if seconds is None:
            return "0:00"
        return format_seconds_to_time(float(seconds))

    @app.template_filter('format_relative_time')
    def format_relative_time_filter(iso_str):
        if not iso_str:
            return "never"
        try:
            # Handle ISO string with or without Z
            cleaned = iso_str.rstrip('Z').split('.')[0]
            dt = datetime.fromisoformat(cleaned)
            diff = datetime.utcnow() - dt
            seconds = int(diff.total_seconds())

            if seconds < 60:
                return "just now"
            elif seconds < 3600:
                mins = seconds // 60
                return f"{mins}m ago"
            elif seconds < 86400:
                hours = seconds // 3600
                return f"{hours}h ago"
            elif seconds < 604800:
                days = seconds // 86400
                return f"{days}d ago"
            else:
                return dt.strftime('%b %d, %Y')
        except Exception:
            return "recently"

    @app.errorhandler(404)
    def page_not_found(e):
        return render_template('base.html', not_found=True), 404

    @app.errorhandler(500)
    def internal_server_error(e):
        return jsonify({'error': 'Internal server error'}), 500

    return app


app = create_app()

if __name__ == '__main__':
    print(f"Calalog running on http://{HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=DEBUG)
