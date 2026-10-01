# Calalog

A clean, personal YouTube video tracking web application built with **Python, Flask, SQLite, HTML5, CSS3, and Vanilla JavaScript**.

## Key Features

- **Hold-to-2× Playback**: Press and hold the Spacebar or click-and-hold the `2× Hold` control to play at 2× speed; releasing instantly restores normal playback speed. Works smoothly on desktop and mobile.
- **Resume Exactly Where You Left Off**: Calalog tracks your exact playback timestamp down to the second and persists progress via periodic background sync, pause/ended events, and `navigator.sendBeacon`.
- **Zero API Keys Required**: Fetches official video metadata, thumbnails, and public chapter timestamps from YouTube without requiring any YouTube Data API credentials or quotas.
- **Chapter Navigation**: Embedded interactive seekbar segmented by creator chapters with hover previews and active chapter tracking.
- **Playback Queue**: Up Next queue with sequential auto-advance, reordering, and quick-add from your library.
- **User Isolation**: Secure account-based library and progress tracking with hashed passwords.

## Architecture

```text
calalog/
├── app.py                  # Flask application entry point with WSGI normalization
├── config.py               # Environment configuration and database path
├── pyproject.toml          # Vercel entrypoint and project configuration
├── vercel.json             # Vercel static asset caching headers
├── requirements.txt        # Python package dependencies
├── models/
│   ├── __init__.py
│   └── db.py               # SQLite database models, schema, and queries
├── routes/
│   ├── __init__.py
│   ├── auth.py             # Authentication routes (sessions & API)
│   ├── api.py              # REST API (library, progress, queue, info)
│   └── views.py            # HTML Jinja2 template views
├── services/
│   ├── __init__.py
│   └── youtube.py          # YouTube video ID parsing and metadata extraction
├── templates/
│   ├── base.html           # Base layout, navbar, shortcuts modal
│   ├── login.html          # Login view
│   ├── register.html       # Registration view
│   ├── dashboard.html      # Player view, URL tracker, companion sidebar
│   ├── library.html        # Video library with search, filter, sort
│   └── queue.html          # Playlist queue manager
├── public/                 # Served directly by Vercel's global CDN
│   └── static/             # Static CSS and JS assets for edge caching
└── static/
    ├── css/
    │   └── style.css       # Clean, restrained developer-built dark theme
    └── js/
        ├── player.js       # Reusable YouTube postMessage player engine
        └── app.js          # App interactions, search, filter, queue
```

## Running Locally

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the application:
```bash
python3 app.py
```

The app will start at `http://0.0.0.0:3000`.

## Deploying to Vercel

1. Push this repository to GitHub.
2. Import the repository in [Vercel](https://vercel.com).
3. Vercel automatically detects the Python Flask application via `app.py` and `pyproject.toml`, serving all dynamic routes with zero configuration and serving `public/static/` assets directly via the global Edge CDN.

