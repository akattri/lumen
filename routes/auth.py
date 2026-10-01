from functools import wraps
from flask import Blueprint, request, jsonify, session, redirect, url_for, render_template, flash
from models.db import (
    authenticate_user,
    create_user,
    find_user_by_id,
    find_user_by_username
)

auth_bp = Blueprint('auth', __name__)


def get_current_user():
    user_id = session.get('user_id')
    if not user_id:
        # Check Bearer token or custom header if passed
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:].strip()
            # If token is a user_id or username
            user = find_user_by_id(token) or find_user_by_username(token)
            if user:
                return user
        return None
    return find_user_by_id(user_id)


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_current_user()
        if not user:
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Authentication required'}), 401
            return redirect(url_for('views.login_page', next=request.url))
        return f(*args, **kwargs)
    return decorated_function


# --- HTML Form Auth Routes ---

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        if session.get('user_id'):
            return redirect(url_for('views.dashboard'))
        return render_template('login.html')

    username = request.form.get('username', '').strip()
    password = request.form.get('password', '')

    if not username or not password:
        flash('Username and password are required', 'error')
        return render_template('login.html', username=username)

    user = authenticate_user(username, password)
    if not user:
        flash('Invalid username or password', 'error')
        return render_template('login.html', username=username)

    session['user_id'] = user['id']
    session['username'] = user['username']
    session.permanent = True

    next_url = request.args.get('next')
    return redirect(next_url or url_for('views.dashboard'))


@auth_bp.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'GET':
        if session.get('user_id'):
            return redirect(url_for('views.dashboard'))
        return render_template('register.html')

    username = request.form.get('username', '').strip()
    password = request.form.get('password', '')

    if len(username) < 2:
        flash('Username must be at least 2 characters long', 'error')
        return render_template('register.html', username=username)

    if len(password) < 4:
        flash('Password must be at least 4 characters long', 'error')
        return render_template('register.html', username=username)

    try:
        user = create_user(username, password)
        session['user_id'] = user['id']
        session['username'] = user['username']
        session.permanent = True
        return redirect(url_for('views.dashboard'))
    except ValueError as e:
        flash(str(e), 'error')
        return render_template('register.html', username=username)
    except Exception as e:
        flash('Registration failed. Please try again.', 'error')
        return render_template('register.html', username=username)


@auth_bp.route('/logout', methods=['GET', 'POST'])
def logout():
    session.clear()
    if request.path.startswith('/api/'):
        return jsonify({'success': True})
    return redirect(url_for('views.login_page'))


# --- JSON API Auth Routes ---

@auth_bp.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json(silent=True) or request.form.to_dict()
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400

    user = authenticate_user(username, password)
    if not user:
        return jsonify({'error': 'Invalid username or password'}), 401

    session['user_id'] = user['id']
    session['username'] = user['username']
    session.permanent = True

    return jsonify({
        'user': user,
        'token': user['id']
    })


@auth_bp.route('/api/auth/register', methods=['POST'])
def api_register():
    data = request.get_json(silent=True) or request.form.to_dict()
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if len(username) < 2:
        return jsonify({'error': 'Username must be at least 2 characters long'}), 400
    if len(password) < 4:
        return jsonify({'error': 'Password must be at least 4 characters long'}), 400

    try:
        user = create_user(username, password)
        session['user_id'] = user['id']
        session['username'] = user['username']
        session.permanent = True
        return jsonify({
            'user': user,
            'token': user['id']
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 409
    except Exception as e:
        return jsonify({'error': 'Registration failed'}), 500


@auth_bp.route('/api/auth/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'success': True})


@auth_bp.route('/api/auth/me', methods=['GET'])
def api_me():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    return jsonify({
        'user': {
            'id': user['id'],
            'username': user['username'],
            'created_at': user['created_at']
        }
    })
