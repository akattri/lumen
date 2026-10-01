import { spawn } from 'child_process';

// Spawns the Flask Calalog application
const py = spawn('python3', ['app.py'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: process.env.PORT || '3000' }
});

py.on('close', (code) => {
  process.exit(code || 0);
});

process.on('SIGINT', () => py.kill('SIGINT'));
process.on('SIGTERM', () => py.kill('SIGTERM'));
