import { createServer } from 'http';
import { Server } from 'socket.io';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const os = require('os');
const fs = require('fs');
const cp = require('child_process');

let pty;
try {
    pty = require('node-pty');
} catch (e) {
    console.error("Warning: node-pty failed to load. Falling back to child_process.", e.message);
}

const httpServer = createServer();
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 3001;

io.on('connection', (socket) => {
    console.log('Client connected to shell');

    // Determine shell candidates
    const platform = os.platform();
    let shells = [];
    if (platform === 'win32') {
        shells = ['powershell.exe', 'cmd.exe'];
    } else {
        if (process.env.SHELL) shells.push(process.env.SHELL);
        if (platform === 'darwin') {
            shells.push('/bin/zsh');
            shells.push('/bin/bash');
            shells.push('/usr/bin/zsh');
            shells.push('/usr/bin/bash');
            shells.push('zsh');
            shells.push('bash');
            shells.push('/bin/sh');
        } else {
            shells.push('/bin/bash');
            shells.push('/usr/bin/bash');
            shells.push('bash');
            shells.push('/bin/sh');
        }
    }
    // Remove duplicates
    shells = [...new Set(shells)];
    
    // ユーザーのホームディレクトリまたはカレントディレクトリを作業ディレクトリとする
    let cwd = process.env.HOME || process.cwd();
    try {
        if (!fs.existsSync(cwd)) {
            cwd = process.cwd();
        }
    } catch (e) {
        cwd = process.cwd();
    }

    // Sanitize environment variables to ensure they are all strings
    const env = {};
    Object.keys(process.env).forEach(key => {
        if (typeof process.env[key] === 'string') {
            env[key] = process.env[key];
        }
    });

    let ptyProcess = null;
    let lastError = null;

    if (pty) {
        for (const shell of shells) {
            try {
                console.log(`Attempting to spawn: ${shell} in ${cwd}`);
                ptyProcess = pty.spawn(shell, [], {
                    name: 'xterm-color',
                    cols: 80,
                    rows: 30,
                    cwd: cwd,
                    env: env
                });
                console.log(`Spawned shell: ${shell}`);
                break; // Success
            } catch (e) {
                lastError = e;
                console.warn(`Failed to spawn ${shell}: ${e.message}`);
            }
        }
    }

    if (!ptyProcess) {
        console.warn('All node-pty candidates failed or node-pty missing. Using basic shell fallback.');
        socket.emit('output', `\r\n*** WARNING: node-pty failed. Using basic shell fallback. ***\r\n`);
        
        try {
            const fallbackShell = shells[0] || '/bin/sh';
            const child = cp.spawn(fallbackShell, [], {
                cwd: cwd,
                env: env,
                shell: false
            });

            ptyProcess = {
                write: (data) => child.stdin.write(data),
                resize: () => {}, 
                kill: () => child.kill(),
                onData: (fn) => {
                    child.stdout.on('data', fn);
                    child.stderr.on('data', fn);
                }
            };
            child.on('close', () => socket.emit('output', '\r\n[Process exited]\r\n'));
        } catch (e2) {
            socket.emit('output', `\r\n*** FATAL: Fallback shell also failed: ${e2.message} ***\r\n`);
            return;
        }
    }

    if (ptyProcess.onData) {
        ptyProcess.onData((data) => {
            socket.emit('output', data);
        });
    }

    socket.on('input', (data) => {
        ptyProcess.write(data);
    });

    socket.on('resize', (size) => {
        ptyProcess.resize(size.cols, size.rows);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        ptyProcess.kill();
    });
});

httpServer.listen(PORT, () => {
    console.log(`Socket server listening on port ${PORT}`);
});