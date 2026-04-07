#!/usr/bin/env python3
"""Minimal PTY wrapper. Spawns a command with a real PTY and pipes stdin/stdout."""
import sys, os, select, signal, struct, fcntl, termios

def set_size(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

cmd = sys.argv[1:]
if not cmd:
    sys.exit(1)

pid, master = os.forkpty()
if pid == 0:
    os.environ['TERM'] = 'xterm-256color'
    os.execvp(cmd[0], cmd)

set_size(master, 24, 80)
stdin = sys.stdin.buffer.fileno()
stdout = sys.stdout.buffer.fileno()

alive = True
def sigchld(s, f):
    global alive
    alive = False
signal.signal(signal.SIGCHLD, sigchld)

try:
    while alive:
        r, _, _ = select.select([stdin, master], [], [], 0.05)
        for fd in r:
            if fd == master:
                try:
                    d = os.read(master, 65536)
                    if not d: alive = False; break
                    os.write(stdout, d)
                except OSError:
                    alive = False; break
            else:
                try:
                    d = os.read(stdin, 65536)
                    if not d: alive = False; break
                    os.write(master, d)
                except OSError:
                    alive = False; break
except:
    pass
finally:
    try: os.kill(pid, signal.SIGTERM)
    except: pass
    try: os.waitpid(pid, 0)
    except: pass
