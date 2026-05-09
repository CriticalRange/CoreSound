#!/usr/bin/env python3
"""RFCOMM socket bridge — JSON IPC over stdin/stdout.
Usage: rfcomm-helper.py <mac> [channel]
Messages in:  {"type": "write", "hex": "aabbcc"}  |  {"type": "close"}
Messages out: {"type": "connected"}  |  {"type": "data", "hex": "..."}
              {"type": "disconnected"}  |  {"type": "error", "message": "..."}
"""
import socket, sys, json, select, errno, traceback

def send(obj):
    print(json.dumps(obj), flush=True)

def log(msg):
    print(f"[rfcomm-helper] {msg}", file=sys.stderr, flush=True)

def main():
    if len(sys.argv) < 2:
        send({"type": "error", "message": "Usage: rfcomm-helper.py <mac> [channel]"})
        sys.exit(1)

    mac = sys.argv[1]
    channel = int(sys.argv[2]) if len(sys.argv) > 2 else 15
    log(f"connecting to {mac} ch{channel}")

    try:
        sock = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM)
        sock.settimeout(10)
        sock.connect((mac, channel))
        sock.setblocking(False)
    except OSError as e:
        log(f"connect failed: {e}")
        send({"type": "error", "message": str(e)})
        sys.exit(1)

    log("connected")
    send({"type": "connected"})

    stdin_fd = sys.stdin.fileno()

    while True:
        try:
            readable, _, exceptional = select.select([sock, stdin_fd], [], [sock], 5.0)
        except Exception as e:
            log(f"select error: {e}\n{traceback.format_exc()}")
            break

        if exceptional:
            log("socket exceptional condition")
            send({"type": "disconnected"})
            break

        for fd in readable:
            if fd is sock:
                try:
                    data = sock.recv(1024)
                    if not data:
                        log("remote closed connection")
                        send({"type": "disconnected"})
                        sock.close()
                        return
                    log(f"rx {len(data)}b: {data.hex()}")
                    send({"type": "data", "hex": data.hex()})
                except OSError as e:
                    if e.errno not in (errno.EAGAIN, errno.EWOULDBLOCK):
                        log(f"recv error: {e}")
                        send({"type": "disconnected"})
                        sock.close()
                        return
            elif fd == stdin_fd:
                line = sys.stdin.readline()
                if not line:
                    log("stdin EOF — closing")
                    sock.close()
                    return
                try:
                    msg = json.loads(line.strip())
                    if msg.get("type") == "write":
                        raw = bytes.fromhex(msg["hex"])
                        log(f"tx {len(raw)}b: {msg['hex']}")
                        sock.send(raw)
                    elif msg.get("type") == "close":
                        log("close requested")
                        sock.close()
                        return
                except (json.JSONDecodeError, KeyError, ValueError) as e:
                    log(f"bad stdin message: {e}")
                except OSError as e:
                    log(f"send error: {e}")
                    send({"type": "disconnected"})
                    sock.close()
                    return

    log("loop exited")
    sock.close()

if __name__ == "__main__":
    main()
