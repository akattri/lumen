from flask import Blueprint, render_template, redirect, url_for, session, request
from routes.auth import get_current_user, login_required
from models.db import get_videos_by_user, get_queue_by_user, get_video_by_id

views_bp = Blueprint('views', __name__)


@views_bp.route('/')
def dashboard():
    user = get_current_user()
    if not user:
        return redirect(url_for('views.login_page'))

    videos = get_videos_by_user(user['id'])
    queue = get_queue_by_user(user['id'])

    # Determine initial video to play
    video_id = request.args.get('v')
    current_video = None
    if video_id:
        current_video = get_video_by_id(user['id'], video_id)

    if not current_video and videos:
        current_video = videos[0]

    return render_template(
        'dashboard.html',
        user=user,
        videos=videos,
        queue=queue,
        current_video=current_video,
        active_tab='learning'
    )


@views_bp.route('/library')
@login_required
def library_view():
    user = get_current_user()
    videos = get_videos_by_user(user['id'])
    queue = get_queue_by_user(user['id'])

    return render_template(
        'library.html',
        user=user,
        videos=videos,
        queue=queue,
        active_tab='library'
    )


@views_bp.route('/queue')
@login_required
def queue_view():
    user = get_current_user()
    videos = get_videos_by_user(user['id'])
    queue = get_queue_by_user(user['id'])

    return render_template(
        'queue.html',
        user=user,
        videos=videos,
        queue=queue,
        active_tab='queue'
    )


@views_bp.route('/login')
def login_page():
    if session.get('user_id'):
        return redirect(url_for('views.dashboard'))
    return render_template('login.html')


@views_bp.route('/register')
def register_page():
    if session.get('user_id'):
        return redirect(url_for('views.dashboard'))
    return render_template('register.html')
