import re
import time
import json
import urllib.request
import urllib.parse
from typing import Dict, Any, List, Optional

# Cache metadata for 30 minutes
_metadata_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL = 1800  # 30 minutes


def extract_youtube_video_id(url_or_id: str) -> Optional[str]:
    """
    Parses YouTube video ID from various YouTube URL formats.
    Supports:
    - https://www.youtube.com/watch?v=VIDEO_ID
    - https://youtu.be/VIDEO_ID
    - https://www.youtube.com/shorts/VIDEO_ID
    - https://www.youtube.com/embed/VIDEO_ID
    - Plain video ID (11 chars)
    """
    if not url_or_id or not isinstance(url_or_id, str):
        return None
    
    trimmed = url_or_id.strip()

    # If it's already an 11-char video ID
    if re.match(r'^[a-zA-Z0-9_-]{11}$', trimmed):
        return trimmed

    try:
        url_to_parse = trimmed if trimmed.startswith(('http://', 'https://')) else f'https://{trimmed}'
        parsed = urllib.parse.urlparse(url_to_parse)
        hostname = (parsed.hostname or '').lower()

        # youtu.be/VIDEO_ID
        if 'youtu.be' in hostname:
            path_part = parsed.path.lstrip('/').split('/')[0]
            if re.match(r'^[a-zA-Z0-9_-]{11}$', path_part):
                return path_part

        # youtube.com
        if 'youtube.com' in hostname:
            query = urllib.parse.parse_qs(parsed.query)
            if 'v' in query and query['v']:
                v = query['v'][0]
                if re.match(r'^[a-zA-Z0-9_-]{11}$', v):
                    return v

            path_parts = [p for p in parsed.path.split('/') if p]
            if len(path_parts) >= 2 and path_parts[0] in ('shorts', 'embed', 'v', 'live'):
                potential_id = path_parts[1]
                if re.match(r'^[a-zA-Z0-9_-]{11}$', potential_id):
                    return potential_id

    except Exception:
        pass

    # Regex fallback
    match = re.search(r'(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})', trimmed)
    if match:
        return match.group(1)

    return None


def format_seconds_to_time(seconds: float) -> str:
    s = int(seconds)
    hrs = s // 3600
    mins = (s % 3600) // 60
    secs = s % 60

    if hrs > 0:
        return f"{hrs}:{mins:02d}:{secs:02d}"
    return f"{mins}:{secs:02d}"


def parse_time_to_seconds(time_str: str) -> int:
    try:
        parts = [int(p) for p in time_str.strip().split(':')]
        if len(parts) == 3:
            return parts[0] * 3600 + parts[1] * 60 + parts[2]
        elif len(parts) == 2:
            return parts[0] * 60 + parts[1]
        elif len(parts) == 1:
            return parts[0]
    except Exception:
        pass
    return 0


def fetch_youtube_metadata(video_id: str) -> Dict[str, Any]:
    """
    Fetches official metadata (title, author, thumbnail) and real chapters
    without requiring any YouTube Data API key.
    """
    now = time.time()
    if video_id in _metadata_cache:
        cached = _metadata_cache[video_id]
        if now - cached['timestamp'] < CACHE_TTL:
            return cached['data']

    default_thumbnail = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    title = "YouTube Video"
    author = "YouTube Creator"
    thumbnail = default_thumbnail
    chapters: List[Dict[str, Any]] = []

    # Step 1: oEmbed for title, author, and official thumbnail
    try:
        oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        req = urllib.request.Request(
            oembed_url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                if data.get('title'):
                    title = data['title']
                if data.get('author_name'):
                    author = data['author_name']
                if data.get('thumbnail_url'):
                    thumbnail = data['thumbnail_url']
    except Exception as e:
        # Fallback to defaults
        pass

    # Step 2: Fetch public video page to parse chapters
    try:
        page_url = f"https://www.youtube.com/watch?v={video_id}"
        req = urllib.request.Request(
            page_url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        )
        with urllib.request.urlopen(req, timeout=6) as response:
            if response.status == 200:
                html = response.read().decode('utf-8', errors='ignore')

                # Pattern A: macroMarkersListItemRenderer
                marker_matches = re.finditer(
                    r'\{"macroMarkersListItemRenderer":\{"title":\{"simpleText":"([^"]+)"\},"timeDescription":\{"simpleText":"([^"]+)"\}',
                    html
                )
                found = False
                for m in marker_matches:
                    ch_title = m.group(1).strip()
                    time_desc = m.group(2).strip()
                    secs = parse_time_to_seconds(time_desc)
                    chapters.append({
                        'title': ch_title,
                        'time': secs,
                        'formattedTime': format_seconds_to_time(secs),
                    })
                    found = True

                # Pattern B: chapterRenderer
                if not found:
                    chapter_matches = re.finditer(
                        r'\{"chapterRenderer":\{"title":\{"simpleText":"([^"]+)"\},"timeRangeStartMillis":(\d+)',
                        html
                    )
                    for m in chapter_matches:
                        ch_title = m.group(1).strip()
                        start_millis = int(m.group(2))
                        secs = start_millis // 1000
                        chapters.append({
                            'title': ch_title,
                            'time': secs,
                            'formattedTime': format_seconds_to_time(secs),
                        })
                        found = True

                # Pattern C: description timestamp regex
                if not found:
                    desc_match = re.search(r'"shortDescription":"(.*?)","isCrawlable"', html)
                    desc_text = desc_match.group(1).replace(r'\n', '\n').replace(r'\"', '"') if desc_match else html

                    ts_matches = re.finditer(r'(?:^|\n)\s*(\d{1,2}:\d{2}(?::\d{2})?)\s+[-–—:]?\s*([^\n\r]{2,80})', desc_text)
                    for m in ts_matches:
                        time_str = m.group(1)
                        raw_title = m.group(2).strip()
                        if not raw_title.startswith(('http://', 'https://', 'www.')) and len(raw_title) >= 2:
                            secs = parse_time_to_seconds(time_str)
                            chapters.append({
                                'title': raw_title,
                                'time': secs,
                                'formattedTime': format_seconds_to_time(secs),
                            })
    except Exception:
        pass

    # Deduplicate and sort chapters by time
    unique_chapters = []
    seen_times = set()
    chapters.sort(key=lambda c: c['time'])
    for ch in chapters:
        if ch['time'] not in seen_times:
            seen_times.add(ch['time'])
            unique_chapters.append(ch)

    result = {
        'videoId': video_id,
        'title': title,
        'author': author,
        'thumbnail': thumbnail,
        'chapters': unique_chapters,
    }

    _metadata_cache[video_id] = {
        'data': result,
        'timestamp': now,
    }

    return result
