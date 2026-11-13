# くるくる中継(kurukuru_relay.py) ― くるくる回し太郎(ブラウザ)と杭ナビ(LN-1000i など)の間をつなぐ中継
#
# ブラウザのページは杭ナビに直接(TCP で)つなげないので、スマホの中でこれを動かして間に立たせる。
#   くるくる回し太郎  ⇔ ws://127.0.0.1:8766 ⇔ この中継 ⇔ TCP 192.168.0.1:65521 ⇔ 杭ナビ
#
# 杭ナビのアドレスは自動でさがす(まず 192.168.0.1、次に Wi-Fi の出口、だめなら同じ網を全部)。決めたいときは  python kurukuru_relay.py 192.168.0.1
#
# 使い方(Android)… くるくる回し太郎の 🎛 操作盤の下「🔗 杭ナビへのつなぎ方(Android)」にも同じ手順(ダウンロード・コピーつき)
#   最初だけ: F-Droid から Termux を入れ、Termux で  pkg install -y python && termux-setup-storage
#             くるくる回し太郎から kurukuru_relay.py をダウンロード(スマホの「ダウンロード」に入る)
#   毎回:     Termux で  python ~/storage/downloads/kurukuru_relay.py   (「待っています」と出たらそのまま)
#             スマホの Wi-Fi を杭ナビにつなぐ・TopLayout を閉じる(杭ナビは1台としか話さない)
#             くるくる回し太郎 → 🎛 操作盤 →「🔗 つなぐ」(Chrome がローカル ネットワークへのアクセスをたずねたら「許可」)
#   止めるときは Termux で Ctrl+C。
#
# Python の標準の部品だけで動く(追加のインストールなし)。
import asyncio, base64, hashlib, os, socket, struct, sys, time

KUI_HOST = "192.168.0.1"   # 杭ナビの Wi-Fi のアドレス(キャプチャで確認)
KUI_PORT = 65521
WS_PORT = 8766
VID_PORT = 50000           # TopLayout は「@CVSON,50000」と送っていた。映像はスマホのこの番号に届くと推定
VERSION = "3"
FIXED_HOST = False         # True: 起動のときにアドレスを指定された(自動で探さない)
HOST_FILE = os.path.expanduser("~/.kurukuru_host")   # 前につながった杭ナビのアドレス
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def log(*a):
    print(*a, flush=True)


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect((KUI_HOST, KUI_PORT))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def my_ips():
    """スマホ(この端末)の Wi-Fi などのアドレス(192.168.x.x・10.x.x.x・172.16〜31.x.x)を集める。"""
    ips = []
    def add(ip):
        if ip and ip not in ips and not ip.startswith("127.") and (
                ip.startswith("192.168.") or ip.startswith("10.") or
                (ip.startswith("172.") and 16 <= int(ip.split(".")[1]) <= 31)):
            ips.append(ip)
    try:
        import fcntl
        names = [n for _, n in socket.if_nameindex()]
    except Exception:
        names = []
    names = sorted(set(names) | {"wlan0", "wlan1", "eth0"}, key=lambda n: (not n.startswith("wlan"), n))
    for n in names:
        try:
            import fcntl
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            r = fcntl.ioctl(s.fileno(), 0x8915, struct.pack("256s", n.encode()[:15]))   # SIOCGIFADDR
            s.close()
            add(socket.inet_ntoa(r[20:24]))
        except Exception:
            pass
    for h in ("192.168.0.1", "10.0.0.1", "8.8.8.8"):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((h, 9))
            add(s.getsockname()[0])
            s.close()
        except OSError:
            pass
    return ips


def gateways():
    """Wi-Fi の出口(ルーター)のアドレス。杭ナビの Wi-Fi なら、それが杭ナビ。読めないときは空。"""
    out = []
    try:
        with open("/proc/net/route") as f:
            for line in f.readlines()[1:]:
                a = line.split()
                if len(a) > 2 and a[2] != "00000000":
                    ip = socket.inet_ntoa(struct.pack("<I", int(a[2], 16)))
                    if ip not in out:
                        out.append(ip)
    except Exception:
        pass
    return out


async def find_kui():
    """杭ナビを探してつなぐ。(reader, writer, アドレス) を返す。見つからなければ None。
    1) 指定・前回のアドレス・192.168.0.1・Wi-Fi の出口・同じ網の .1 を順に試し、
    2) だめなら同じ網(x.x.x.1〜254)を全部いっせいに試す。"""
    first = [KUI_HOST]
    if not FIXED_HOST:
        try:
            first.append(open(HOST_FILE).read().strip())
        except OSError:
            pass
        first += ["192.168.0.1"] + gateways()
        for ip in my_ips():
            first.append(ip.rsplit(".", 1)[0] + ".1")
    seen = []
    for h in first:
        if h and h not in seen:
            seen.append(h)
    for h in seen:
        try:
            r, w = await asyncio.wait_for(asyncio.open_connection(h, KUI_PORT), 1.5)
            return r, w, h
        except Exception:
            pass
    if FIXED_HOST:
        return None
    mine = my_ips()
    if not mine:
        return None
    log("杭ナビをさがしています:", ", ".join(ip.rsplit(".", 1)[0] + ".*" for ip in mine))
    hosts = [f"{ip.rsplit('.', 1)[0]}.{i}" for ip in mine for i in range(1, 255)]
    hosts = [h for h in hosts if h not in seen and h not in mine]

    async def try_one(h):
        r, w = await asyncio.wait_for(asyncio.open_connection(h, KUI_PORT), 3)
        return r, w, h
    tasks = [asyncio.ensure_future(try_one(h)) for h in hosts]
    found = None
    pending = set(tasks)
    while pending and not found:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            if not t.cancelled() and t.exception() is None and not found:
                found = t.result()
            elif not t.cancelled() and t.exception() is None:
                t.result()[1].close()
    for t in pending:
        t.cancel()
    return found


def announce():
    # TopLayout はつなぐ前に「@IPBCC,自分のIP,チェックサム」を 65520→65519 へ一斉送信していた
    ip = local_ip() or next(iter(my_ips()), None)
    if not ip:
        return
    body = f"@IPBCC,{ip},"
    msg = (body + "%02X" % (sum(body.encode()) & 255) + "\r").encode()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        try:
            s.bind(("", 65520))
        except OSError:
            pass
        s.sendto(msg, ("255.255.255.255", 65519))
        s.close()
        log("一斉送信:", msg)
    except OSError as e:
        log("一斉送信できませんでした:", e)


async def ws_read(reader):
    """WebSocket の1枠を読む。(opcode, データ) を返す。"""
    h = await reader.readexactly(2)
    op, ln = h[0] & 15, h[1] & 127
    masked = h[1] & 128
    if ln == 126:
        ln = struct.unpack(">H", await reader.readexactly(2))[0]
    elif ln == 127:
        ln = struct.unpack(">Q", await reader.readexactly(8))[0]
    mask = await reader.readexactly(4) if masked else b"\0\0\0\0"
    data = bytearray(await reader.readexactly(ln))
    for i in range(ln):
        data[i] ^= mask[i % 4]
    return op, bytes(data)


def ws_frame(data, op=1):
    n = len(data)
    if n < 126:
        head = struct.pack(">BB", 0x80 | op, n)
    elif n < 65536:
        head = struct.pack(">BBH", 0x80 | op, 126, n)
    else:
        head = struct.pack(">BBQ", 0x80 | op, 127, n)
    return head + data


# ---------------------------------------------------------------- 映像(LIVE)
# 映像がどの形で届くかはまだ確かめられていないので、UDP と TCP の 50000 番の両方で待ち、
# 届いたものから JPEG(FFD8…FFD9)を切り出してブラウザへ送る。届いた生のデータは調べるために
# 「ダウンロード」の kurukuru_video.bin に保存する(最初の 4MB まで)。
class Video:
    def __init__(self):
        self.client = None          # ブラウザ(WebSocket の writer)
        self.buf = bytearray()
        self.hdr = None             # UDP の1包みの頭にある見出しの長さ(推定)
        self.n = 0; self.bytes = 0; self.frames = 0; self.shown = 0; self.t0 = 0
        self.dump = None; self.dumped = 0
        self.seen = asyncio.Event()

    def note(self, text):
        log("映像:", text)
        if self.client:
            try:
                self.client.write(ws_frame(("#VID," + text).encode()))
            except Exception:
                pass

    def open_dump(self):
        if self.dump is not None:
            return
        d = os.path.expanduser("~/storage/downloads")
        if not os.path.isdir(d):
            d = os.getcwd()
        path = os.path.join(d, "kurukuru_video.bin")
        try:
            self.dump = open(path, "wb")
            self.dump.write(b"KVD1")
            self.note(f"届いたデータを {path} に保存します")
        except OSError as e:
            self.dump = False
            log("保存できません:", e)

    def feed(self, kind, src, data):
        """kind: b'U'(UDP の1包み) か b'T'(TCP の流れ)"""
        self.n += 1; self.bytes += len(data)
        self.seen.set()
        if self.n == 1:
            self.t0 = time.time()
            self.open_dump()
        if self.dump and self.dumped < 4_000_000:
            self.dump.write(kind + struct.pack(">dI", time.time(), len(data)) + data)
            self.dumped += len(data)
            if self.dumped >= 4_000_000:
                self.dump.flush()
                self.note("保存は 4MB で止めました(kurukuru_video.bin)")
        if self.shown < 4:
            self.shown += 1
            kindj = "UDP" if kind == b"U" else "TCP"
            self.note(f"{kindj} {src[0]}:{src[1]} から {len(data)} バイト 先頭 {data[:24].hex(' ')}")
        if self.n % 200 == 0:
            sec = max(time.time() - self.t0, 0.001)
            self.note(f"{self.n} 包み・{self.bytes // 1024} KB・1秒に {self.n / sec:.0f} 包み・絵 {self.frames} 枚")
            if self.dump:
                self.dump.flush()
        if kind == b"U":
            soi = data.find(b"\xff\xd8\xff")
            if 0 <= soi < 128:
                self.hdr = soi
                self.buf = bytearray(data[soi:])
            elif self.hdr is not None and self.buf:
                self.buf += data[self.hdr:]
            self.cut(udp=True)
        else:
            self.buf += data
            self.cut(udp=False)

    def cut(self, udp):
        while True:
            s = self.buf.find(b"\xff\xd8\xff")
            if s < 0:
                if len(self.buf) > 4_000_000:
                    self.buf.clear()
                return
            e = self.buf.find(b"\xff\xd9", s + 2)
            if e < 0:
                if s:
                    del self.buf[:s]
                if len(self.buf) > 4_000_000:
                    self.buf.clear()
                return
            jpg = bytes(self.buf[s:e + 2])
            del self.buf[:e + 2]
            self.frames += 1
            if self.frames == 1:
                self.note(f"JPEG の絵を受け取りました({len(jpg)} バイト)")
            if self.client:
                try:
                    self.client.write(ws_frame(jpg, 2))
                except Exception:
                    pass

    def reset(self):
        self.buf = bytearray(); self.hdr = None


VIDEO = None


class VidUDP(asyncio.DatagramProtocol):
    def datagram_received(self, data, addr):
        VIDEO.feed(b"U", addr, data)


async def vid_tcp(reader, writer):
    src = writer.get_extra_info("peername") or ("?", 0)
    VIDEO.note(f"TCP で {src[0]}:{src[1]} がつないできました")
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            VIDEO.feed(b"T", src, data)
    finally:
        VIDEO.note("映像の TCP が切れました")
        writer.close()


async def vid_try_pull():
    """CVSON のあと 3 秒たっても何も届かなければ、杭ナビの 50000 番へこちらからつないでみる。"""
    try:
        await asyncio.wait_for(VIDEO.seen.wait(), 3)
        return
    except asyncio.TimeoutError:
        pass
    VIDEO.note(f"3 秒待っても映像が届かないので、杭ナビ {KUI_HOST}:{VID_PORT} へつないでみます")
    try:
        r, w = await asyncio.wait_for(asyncio.open_connection(KUI_HOST, VID_PORT), 4)
    except Exception as e:
        VIDEO.note(f"杭ナビの {VID_PORT} 番にはつながりませんでした({e.__class__.__name__})")
        return
    await vid_tcp(r, w)


async def handle(reader, writer):
    # WebSocket のあいさつ
    req = await reader.readuntil(b"\r\n\r\n")
    key = None
    for line in req.decode("latin1").split("\r\n"):
        if line.lower().startswith("sec-websocket-key:"):
            key = line.split(":", 1)[1].strip()
    if not key:
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" + "くるくる中継 動いています".encode())
        await writer.drain()
        writer.close()
        return
    acc = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Accept: {acc}\r\n\r\n").encode())
    await writer.drain()
    log("くるくる回し太郎がつながりました")
    VIDEO.client = writer
    VIDEO.reset()

    global KUI_HOST
    announce()
    got = await find_kui()
    if not got:
        log("杭ナビが見つかりません")
        where = f"({KUI_HOST}:{KUI_PORT})" if FIXED_HOST else "(Wi-Fi の中をさがしました)"
        writer.write(ws_frame(f"#ERR,杭ナビ{where}が見つかりません。スマホの Wi-Fi が杭ナビになっているか、TopLayout を閉じたか確かめてください。".encode()))
        await writer.drain()
        writer.close()
        return
    kr, kw, host = got
    if host != KUI_HOST:
        KUI_HOST = host
        announce()
    if not FIXED_HOST:
        try:
            with open(HOST_FILE, "w") as f:
                f.write(host)
        except OSError:
            pass
    log(f"杭ナビにつながりました({host}:{KUI_PORT})")
    writer.write(ws_frame(f"#HOST,{host}".encode()))
    writer.write(ws_frame(b"#OPEN"))
    await writer.drain()

    async def up():      # ブラウザ → 杭ナビ
        while True:
            op, data = await ws_read(reader)
            if op == 8:
                break
            if op == 9:
                writer.write(ws_frame(data, 10))
                continue
            if op in (1, 2):
                kw.write(data)
                await kw.drain()
                if b"@CVSON" in data:
                    VIDEO.reset(); VIDEO.seen.clear()
                    asyncio.ensure_future(vid_try_pull())

    async def down():    # 杭ナビ → ブラウザ
        while True:
            data = await kr.read(4096)
            if not data:
                break
            writer.write(ws_frame(data))
            await writer.drain()

    tasks = [asyncio.ensure_future(up()), asyncio.ensure_future(down())]
    await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for t in tasks:
        t.cancel()
    for w in (kw, writer):
        try:
            w.close()
        except Exception:
            pass
    if VIDEO.client is writer:
        VIDEO.client = None
    log("切れました")


async def main():
    global VIDEO
    VIDEO = Video()
    loop = asyncio.get_running_loop()
    try:
        await loop.create_datagram_endpoint(VidUDP, local_addr=("0.0.0.0", VID_PORT))
        await asyncio.start_server(vid_tcp, "0.0.0.0", VID_PORT)
        log(f"映像は UDP・TCP の {VID_PORT} 番で待ちます")
    except OSError as e:
        log(f"映像の {VID_PORT} 番を開けません:", e)
    srv = await asyncio.start_server(handle, "127.0.0.1", WS_PORT)
    log(f"くるくる中継 v{VERSION}: ws://127.0.0.1:{WS_PORT} で待っています(杭ナビ {KUI_HOST if FIXED_HOST else "自動でさがす"}:{KUI_PORT})。止めるときは Ctrl+C")
    async with srv:
        await srv.serve_forever()


if __name__ == "__main__":
    # 試験用: python くるくる中継.py 杭ナビのアドレス ポート
    if len(sys.argv) > 1:
        KUI_HOST = sys.argv[1]
        FIXED_HOST = True
    if len(sys.argv) > 2:
        KUI_PORT = int(sys.argv[2])
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
