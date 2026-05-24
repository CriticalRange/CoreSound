#!/usr/bin/env python3
"""RFCOMM socket bridge — JSON IPC over stdin/stdout.
Usage: rfcomm-helper.py <mac> [channel]
Messages in:  {"type": "write", "hex": "aabbcc"}  |  {"type": "close"}
Messages out: {"type": "connected"}  |  {"type": "data", "hex": "..."}
              {"type": "disconnected"}  |  {"type": "error", "message": "..."}
"""
import socket, sys, json, threading, queue, traceback

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
        sock.settimeout(None)
    except OSError as e:
        log(f"connect failed: {e}")
        send({"type": "error", "message": str(e)})
        sys.exit(1)

    log("connected")
    send({"type": "connected"})

    cmd_queue = queue.Queue()
    stop_event = threading.Event()

    def stdin_reader():
        try:
            for line in sys.stdin:
                if stop_event.is_set():
                    break
                cmd_queue.put(line)
        except Exception:
            pass
        cmd_queue.put(None)

    def sock_reader():
        try:
            while not stop_event.is_set():
                data = sock.recv(1024)
                if not data:
                    log("remote closed connection")
                    send({"type": "disconnected"})
                    cmd_queue.put(None)
                    return
                log(f"rx {len(data)}b: {data.hex()}")
                send({"type": "data", "hex": data.hex()})
        except OSError as e:
            if not stop_event.is_set():
                log(f"recv error: {e}")
                send({"type": "disconnected"})
                cmd_queue.put(None)
        except Exception as e:
            if not stop_event.is_set():
                log(f"sock_reader error: {e}\n{traceback.format_exc()}")

    threading.Thread(target=stdin_reader, daemon=True).start()
    threading.Thread(target=sock_reader, daemon=True).start()

    try:
        while True:
            item = cmd_queue.get()
            if item is None:
                break
            try:
                msg = json.loads(item.strip())
                if msg.get("type") == "write":
                    raw = bytes.fromhex(msg["hex"])
                    log(f"tx {len(raw)}b: {msg['hex']}")
                    sock.send(raw)
                elif msg.get("type") == "close":
                    log("close requested")
                    break
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                log(f"bad stdin message: {e}")
            except OSError as e:
                log(f"send error: {e}")
                send({"type": "disconnected"})
                break
    finally:
        stop_event.set()
        try:
            sock.close()
        except Exception:
            pass

    log("loop exited")

if __name__ == "__main__":
    main()
