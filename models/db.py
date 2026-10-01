import sqlite3
import os
import json
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional
from werkzeug.security import generate_password_hash, check_password_hash
from config import DB_PATH, DATA_DIR, BASE_DIR


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = get_db_connection()
    cursor = conn.cursor()

    # Create tables
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS videos (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            youtube_video_id TEXT NOT NULL,
            youtube_url TEXT NOT NULL,
            title TEXT NOT NULL,
            thumbnail TEXT NOT NULL,
            duration INTEGER NOT NULL DEFAULT 0,
            current_time REAL NOT NULL DEFAULT 0,
            progress_percentage INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'unwatched',
            playback_rate REAL NOT NULL DEFAULT 1.0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_watched_at TEXT,
            completed_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            UNIQUE(user_id, youtube_video_id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS queue (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            video_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE,
            UNIQUE(user_id, video_id)
        )
    ''')

    # Indices
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_videos_user ON videos(user_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_queue_user ON queue(user_id, position)')

    conn.commit()

    # Migrate from data/waterloo.json if it exists and has users
    waterloo_json = os.path.join(BASE_DIR, 'data', 'waterloo.json')
    if os.path.exists(waterloo_json):
        try:
            with open(waterloo_json, 'r', encoding='utf-8') as f:
                data = json.load(f)
                users = data.get('users', [])
                for u in users:
                    cursor.execute('SELECT id FROM users WHERE id = ?', (u['id'],))
                    if not cursor.fetchone():
                        cursor.execute(
                            'INSERT OR IGNORE INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
                            (u['id'], u['username'], u['password_hash'], u.get('created_at', datetime.utcnow().isoformat()))
                        )
                videos = data.get('videos', [])
                for v in videos:
                    cursor.execute('SELECT id FROM videos WHERE id = ?', (v['id'],))
                    if not cursor.fetchone():
                        cursor.execute('''
                            INSERT OR IGNORE INTO videos (
                                id, user_id, youtube_video_id, youtube_url, title, thumbnail,
                                duration, current_time, progress_percentage, status, playback_rate,
                                created_at, updated_at, last_watched_at, completed_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (
                            v['id'], v['user_id'], v['youtube_video_id'], v['youtube_url'],
                            v.get('title', 'Untitled Video'), v.get('thumbnail', ''),
                            v.get('duration', 0), v.get('current_time', 0),
                            v.get('progress_percentage', 0), v.get('status', 'unwatched'),
                            v.get('playback_rate', 1.0), v.get('created_at', datetime.utcnow().isoformat()),
                            v.get('updated_at', datetime.utcnow().isoformat()),
                            v.get('last_watched_at'), v.get('completed_at')
                        ))
                queue = data.get('queue', [])
                for q in queue:
                    cursor.execute('SELECT id FROM queue WHERE id = ?', (q['id'],))
                    if not cursor.fetchone():
                        cursor.execute(
                            'INSERT OR IGNORE INTO queue (id, user_id, video_id, position, created_at) VALUES (?, ?, ?, ?, ?)',
                            (q['id'], q['user_id'], q['video_id'], q.get('position', 0), q.get('created_at', datetime.utcnow().isoformat()))
                        )
                conn.commit()
        except Exception as e:
            print("Waterloo.json migration error:", e)

    conn.close()


# --- USER FUNCTIONS ---

def find_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    clean_name = username.strip().lower()
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE LOWER(username) = ?', (clean_name,)).fetchone()
    conn.close()
    if user:
        return dict(user)
    return None


def find_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    if user:
        return dict(user)
    return None


def create_user(username: str, password: str) -> Dict[str, Any]:
    existing = find_user_by_username(username)
    if existing:
        raise ValueError("Username is already taken")

    user_id = str(uuid.uuid4())
    pw_hash = generate_password_hash(password)
    now = datetime.utcnow().isoformat()

    conn = get_db_connection()
    conn.execute(
        'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
        (user_id, username.strip(), pw_hash, now)
    )
    conn.commit()
    conn.close()

    return {
        'id': user_id,
        'username': username.strip(),
        'created_at': now
    }


def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
    user = find_user_by_username(username)
    if not user:
        return None
    if check_password_hash(user['password_hash'], password):
        return {
            'id': user['id'],
            'username': user['username'],
            'created_at': user['created_at']
        }
    return None


# --- VIDEO & PROGRESS FUNCTIONS ---

def get_videos_by_user(user_id: str) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    rows = conn.execute('''
        SELECT * FROM videos WHERE user_id = ?
        ORDER BY CASE WHEN last_watched_at IS NULL THEN 1 ELSE 0 END, last_watched_at DESC, created_at DESC
    ''', (user_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_video_by_id(user_id: str, video_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    row = conn.execute('SELECT * FROM videos WHERE user_id = ? AND id = ?', (user_id, video_id)).fetchone()
    conn.close()
    if row:
        return dict(row)
    return None


def get_video_by_youtube_id(user_id: str, youtube_video_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    row = conn.execute('SELECT * FROM videos WHERE user_id = ? AND youtube_video_id = ?', (user_id, youtube_video_id)).fetchone()
    conn.close()
    if row:
        return dict(row)
    return None


def add_video(
    user_id: str,
    youtube_video_id: str,
    youtube_url: str,
    title: str = "Untitled Video",
    thumbnail: str = "",
    duration: int = 0
) -> Dict[str, Any]:
    existing = get_video_by_youtube_id(user_id, youtube_video_id)
    if existing:
        return existing

    video_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    default_thumb = thumbnail or f"https://i.ytimg.com/vi/{youtube_video_id}/hqdefault.jpg"

    conn = get_db_connection()
    conn.execute('''
        INSERT INTO videos (
            id, user_id, youtube_video_id, youtube_url, title, thumbnail,
            duration, current_time, progress_percentage, status, playback_rate,
            created_at, updated_at, last_watched_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'unwatched', 1.0, ?, ?, NULL, NULL)
    ''', (video_id, user_id, youtube_video_id, youtube_url, title, default_thumb, duration, now, now))
    conn.commit()
    conn.close()

    return get_video_by_id(user_id, video_id)


def update_video_progress(
    user_id: str,
    video_id: str,
    current_time: Optional[float] = None,
    duration: Optional[int] = None,
    progress_percentage: Optional[int] = None,
    status: Optional[str] = None,
    playback_rate: Optional[float] = None,
    title: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    video = get_video_by_id(user_id, video_id)
    if not video:
        return None

    now = datetime.utcnow().isoformat()
    new_time = max(0.0, float(current_time)) if current_time is not None else float(video['current_time'])
    new_dur = int(duration) if duration is not None and duration > 0 else int(video['duration'])
    new_rate = float(playback_rate) if playback_rate is not None else float(video['playback_rate'])
    new_title = title if title and title != "Untitled Video" else video['title']

    # Recalculate progress percentage
    if new_dur > 0:
        calculated_pct = min(100, int(round((new_time / new_dur) * 100)))
    else:
        calculated_pct = int(progress_percentage) if progress_percentage is not None else video['progress_percentage']

    # Determine status & completed_at
    completed_at = video['completed_at']
    if status == 'completed' or calculated_pct >= 95:
        new_status = 'completed'
        if not completed_at:
            completed_at = now
    elif new_time > 5:
        new_status = 'in-progress'
        completed_at = None
    elif new_time == 0 and status == 'unwatched':
        new_status = 'unwatched'
        completed_at = None
    else:
        new_status = status or video['status']

    conn = get_db_connection()
    conn.execute('''
        UPDATE videos SET
            current_time = ?,
            duration = ?,
            progress_percentage = ?,
            status = ?,
            playback_rate = ?,
            title = ?,
            updated_at = ?,
            last_watched_at = ?,
            completed_at = ?
        WHERE id = ? AND user_id = ?
    ''', (new_time, new_dur, calculated_pct, new_status, new_rate, new_title, now, now, completed_at, video_id, user_id))
    conn.commit()
    conn.close()

    return get_video_by_id(user_id, video_id)


def delete_video(user_id: str, video_id: str) -> bool:
    conn = get_db_connection()
    # Remove from queue first
    conn.execute('DELETE FROM queue WHERE user_id = ? AND video_id = ?', (user_id, video_id))
    cursor = conn.execute('DELETE FROM videos WHERE id = ? AND user_id = ?', (video_id, user_id))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


# --- QUEUE FUNCTIONS ---

def get_queue_by_user(user_id: str) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    rows = conn.execute('''
        SELECT q.id as queue_id, q.position, q.created_at as queued_at,
               v.*
        FROM queue q
        JOIN videos v ON q.video_id = v.id
        WHERE q.user_id = ?
        ORDER BY q.position ASC
    ''', (user_id,)).fetchall()
    conn.close()

    result = []
    for r in rows:
        row_dict = dict(r)
        queue_id = row_dict.pop('queue_id')
        position = row_dict.pop('position')
        queued_at = row_dict.pop('queued_at')
        result.append({
            'id': queue_id,
            'user_id': user_id,
            'video_id': row_dict['id'],
            'position': position,
            'created_at': queued_at,
            'video': row_dict
        })
    return result


def add_to_queue(user_id: str, video_id: str) -> Optional[Dict[str, Any]]:
    video = get_video_by_id(user_id, video_id)
    if not video:
        return None

    conn = get_db_connection()
    existing = conn.execute('SELECT * FROM queue WHERE user_id = ? AND video_id = ?', (user_id, video_id)).fetchone()
    if existing:
        conn.close()
        return dict(existing)

    max_pos_row = conn.execute('SELECT MAX(position) as max_pos FROM queue WHERE user_id = ?', (user_id,)).fetchone()
    next_pos = (max_pos_row['max_pos'] + 1) if (max_pos_row and max_pos_row['max_pos'] is not None) else 0

    queue_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    conn.execute(
        'INSERT INTO queue (id, user_id, video_id, position, created_at) VALUES (?, ?, ?, ?, ?)',
        (queue_id, user_id, video_id, next_pos, now)
    )
    conn.commit()
    conn.close()

    return {
        'id': queue_id,
        'user_id': user_id,
        'video_id': video_id,
        'position': next_pos,
        'created_at': now,
        'video': video
    }


def remove_from_queue(user_id: str, queue_item_id: str) -> bool:
    conn = get_db_connection()
    cursor = conn.execute('DELETE FROM queue WHERE id = ? AND user_id = ?', (queue_item_id, user_id))
    if cursor.rowcount == 0:
        conn.close()
        return False

    # Renormalize positions
    rows = conn.execute('SELECT id FROM queue WHERE user_id = ? ORDER BY position ASC', (user_id,)).fetchall()
    for idx, r in enumerate(rows):
        conn.execute('UPDATE queue SET position = ? WHERE id = ?', (idx, r['id']))

    conn.commit()
    conn.close()
    return True


def reorder_queue(user_id: str, ordered_ids: List[str]) -> bool:
    conn = get_db_connection()
    for idx, queue_id in enumerate(ordered_ids):
        conn.execute('UPDATE queue SET position = ? WHERE id = ? AND user_id = ?', (idx, queue_id, user_id))
    conn.commit()
    conn.close()
    return True


def clear_queue(user_id: str) -> None:
    conn = get_db_connection()
    conn.execute('DELETE FROM queue WHERE user_id = ?', (user_id,))
    conn.commit()
    conn.close()
