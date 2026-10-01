import json
from flask import Blueprint, request, jsonify
from routes.auth import get_current_user, login_required
from models.db import (
    get_videos_by_user,
    get_video_by_id,
    get_video_by_youtube_id,
    add_video,
    update_video_progress,
    delete_video,
    get_queue_by_user,
    add_to_queue,
    remove_from_queue,
    reorder_queue,
    clear_queue
)
from services.youtube import extract_youtube_video_id, fetch_youtube_metadata

api_bp = Blueprint('api', __name__, url_prefix='/api')


# --- YOUTUBE METADATA & CHAPTERS ROUTE ---

@api_bp.route('/youtube/info', methods=['GET'])
def youtube_info():
    video_id = request.args.get('id', '').strip()
    url = request.args.get('url', '').strip()

    if not video_id and url:
        video_id = extract_youtube_video_id(url) or ''

    if not video_id:
        return jsonify({'error': 'Invalid or missing YouTube video ID or URL'}), 400

    try:
        metadata = fetch_youtube_metadata(video_id)
        return jsonify(metadata)
    except Exception as e:
        return jsonify({'error': 'Failed to retrieve video information'}), 500


# --- LIBRARY ROUTES (STRICT USER ISOLATION) ---

@api_bp.route('/library', methods=['GET'])
@login_required
def get_library():
    user = get_current_user()
    videos = get_videos_by_user(user['id'])
    return jsonify({'videos': videos})


@api_bp.route('/library', methods=['POST'])
@login_required
def create_library_video():
    user = get_current_user()
    data = request.get_json(silent=True) or request.form.to_dict()

    url = data.get('url', '').strip()
    video_id = data.get('videoId', '').strip()
    title = data.get('title', '').strip()
    thumbnail = data.get('thumbnail', '').strip()
    duration = int(data.get('duration', 0))

    if not video_id and url:
        video_id = extract_youtube_video_id(url) or ''

    if not video_id:
        return jsonify({'error': 'Invalid YouTube URL or Video ID'}), 400

    # Check if already in user's library
    existing = get_video_by_youtube_id(user['id'], video_id)
    if existing:
        return jsonify({'video': existing, 'message': 'Video already in library'}), 200

    # Fetch official metadata if missing title or thumbnail
    if not title or not thumbnail:
        try:
            meta = fetch_youtube_metadata(video_id)
            if not title and meta.get('title'):
                title = meta['title']
            if not thumbnail and meta.get('thumbnail'):
                thumbnail = meta['thumbnail']
        except Exception:
            pass

    standard_url = f"https://www.youtube.com/watch?v={video_id}"
    video = add_video(
        user_id=user['id'],
        youtube_video_id=video_id,
        youtube_url=standard_url,
        title=title or "Untitled Video",
        thumbnail=thumbnail or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        duration=duration
    )

    return jsonify({'video': video}), 201


@api_bp.route('/library/<video_id>', methods=['GET'])
@login_required
def get_single_video(video_id):
    user = get_current_user()
    video = get_video_by_id(user['id'], video_id)
    if not video:
        return jsonify({'error': 'Video not found in your library'}), 404
    return jsonify({'video': video})


def _parse_progress_payload(req):
    # Support JSON, form-data, and text/plain (used by sendBeacon)
    data = req.get_json(silent=True)
    if not data:
        if req.form:
            data = req.form.to_dict()
        elif req.data:
            try:
                data = json.loads(req.data.decode('utf-8'))
            except Exception:
                data = {}
    return data or {}


@api_bp.route('/library/<video_id>/progress', methods=['PATCH', 'POST'])
@login_required
def update_progress(video_id):
    user = get_current_user()
    data = _parse_progress_payload(request)

    current_time = data.get('currentTime')
    if current_time is None:
        current_time = data.get('current_time')

    duration = data.get('duration')
    progress_percentage = data.get('progressPercentage')
    if progress_percentage is None:
        progress_percentage = data.get('progress_percentage')

    status = data.get('status')
    playback_rate = data.get('playbackRate')
    if playback_rate is None:
        playback_rate = data.get('playback_rate')

    title = data.get('title')

    updated = update_video_progress(
        user_id=user['id'],
        video_id=video_id,
        current_time=float(current_time) if current_time is not None else None,
        duration=int(duration) if duration is not None and int(duration) > 0 else None,
        progress_percentage=int(progress_percentage) if progress_percentage is not None else None,
        status=status,
        playback_rate=float(playback_rate) if playback_rate is not None else None,
        title=title
    )

    if not updated:
        return jsonify({'error': 'Video not found in your library'}), 404

    return jsonify({'video': updated, 'success': True})


# Also provide /api/videos/<video_id>/progress for prompt compatibility
@api_bp.route('/videos/<video_id>/progress', methods=['GET', 'POST', 'PATCH'])
@login_required
def api_videos_progress(video_id):
    user = get_current_user()
    if request.method == 'GET':
        video = get_video_by_id(user['id'], video_id)
        if not video:
            return jsonify({'error': 'Video not found'}), 404
        return jsonify({
            'video_id': video['id'],
            'current_time': video['current_time'],
            'duration': video['duration'],
            'progress_percentage': video['progress_percentage'],
            'status': video['status'],
            'playback_rate': video['playback_rate'],
            'last_watched_at': video['last_watched_at']
        })

    return update_progress(video_id)


@api_bp.route('/library/<video_id>', methods=['DELETE'])
@login_required
def remove_video(video_id):
    user = get_current_user()
    success = delete_video(user['id'], video_id)
    if not success:
        return jsonify({'error': 'Video not found in your library'}), 404
    return jsonify({'success': True})


# --- QUEUE ROUTES (STRICT USER ISOLATION) ---

@api_bp.route('/queue', methods=['GET'])
@login_required
def get_queue():
    user = get_current_user()
    queue = get_queue_by_user(user['id'])
    return jsonify({'queue': queue})


@api_bp.route('/queue', methods=['POST'])
@login_required
def create_queue_item():
    user = get_current_user()
    data = request.get_json(silent=True) or request.form.to_dict()
    video_id = data.get('videoId') or data.get('video_id')

    if not video_id:
        return jsonify({'error': 'videoId is required'}), 400

    record = add_to_queue(user['id'], video_id)
    if not record:
        return jsonify({'error': 'Video not found in your library'}), 404

    queue = get_queue_by_user(user['id'])
    return jsonify({'queue': queue, 'item': record}), 201


@api_bp.route('/queue/<queue_id>', methods=['DELETE'])
@login_required
def remove_queue_item(queue_id):
    user = get_current_user()
    success = remove_from_queue(user['id'], queue_id)
    if not success:
        return jsonify({'error': 'Queue item not found'}), 404

    queue = get_queue_by_user(user['id'])
    return jsonify({'success': True, 'queue': queue})


@api_bp.route('/queue/reorder', methods=['PUT', 'POST'])
@login_required
def reorder_queue_items():
    user = get_current_user()
    data = request.get_json(silent=True) or request.form.to_dict()
    ordered_ids = data.get('orderedIds') or data.get('ordered_ids')

    if not isinstance(ordered_ids, list):
        return jsonify({'error': 'orderedIds list is required'}), 400

    reorder_queue(user['id'], ordered_ids)
    queue = get_queue_by_user(user['id'])
    return jsonify({'success': True, 'queue': queue})


@api_bp.route('/queue', methods=['DELETE'])
@login_required
def clear_all_queue():
    user = get_current_user()
    clear_queue(user['id'])
    return jsonify({'success': True, 'queue': []})
