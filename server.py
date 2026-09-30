"""
Blüte & Bohne – Bestellserver (nur Python-Standardbibliothek).

  • Website:            http://<PC-IP>:8080/
  • Anlässe:            http://<PC-IP>:8080/anlaesse.html
  • Inhaber-Dashboard:  http://<PC-IP>:8080/dashboard

Start: python server.py  (oder Doppelklick auf start_server.bat)
Einstellungen: config.json · Produkte & Preise: public/catalog.json
"""

import json
import random
import re
import secrets
import socket
import sys
import threading
from datetime import date, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE = Path(__file__).resolve().parent
PUBLIC = BASE / "public"
DATA = BASE / "data"
ORDERS_FILE = DATA / "orders.json"
INQUIRIES_FILE = DATA / "inquiries.json"
CONFIG = json.loads((BASE / "config.json").read_text(encoding="utf-8"))
PORT = int(CONFIG.get("port", 8080))
PIN = str(CONFIG.get("dashboardPin", "1234"))

ORDER_STATUSES = ["neu", "zubereitung", "abholbereit", "abgeholt", "storniert"]
INQUIRY_STATUSES = ["neu", "beantwortet", "erledigt"]
MAX_BODY = 50_000
lock = threading.Lock()


# ---------- Daten ----------
def read_json(path, fallback):
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        path.rename(path.with_suffix(f".defekt-{datetime.now():%Y%m%d%H%M%S}.json"))
        return fallback


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def catalog():
    return json.loads((PUBLIC / "catalog.json").read_text(encoding="utf-8"))


def iso(dt):
    return dt.isoformat(timespec="seconds")


def to_min(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def hours_for(cat, day):
    # JS-Zählweise: 0 = Sonntag
    return cat["hours"].get(str((day.weekday() + 1) % 7))


# ---------- Validierung ----------
class InputError(Exception):
    pass


def text(value, field, required=True, max_len=200):
    value = str(value or "").strip()
    if required and not value:
        raise InputError(f"Bitte „{field}“ angeben.")
    if len(value) > max_len:
        raise InputError(f"„{field}“ ist zu lang.")
    return value


def price_line(cat, line):
    """Prüft eine Warenkorb-Zeile und berechnet den Preis aus dem Katalog."""
    products = {p["id"]: p for p in cat["products"]}
    p = products.get(line.get("id"))
    qty = line.get("qty")
    if not p or not isinstance(qty, int) or not 1 <= qty <= 20:
        raise InputError("Ungültiger Artikel in der Tüte.")
    chosen = line.get("opts") or {}
    unit = p["price"]
    labels = []
    card_text = ""
    for group_id in p.get("options", []):
        group = cat["options"][group_id]
        choice_id = chosen.get(group_id, group["choices"][0]["id"])
        choice = next((c for c in group["choices"] if c["id"] == choice_id), None)
        if not choice:
            raise InputError("Ungültige Auswahl.")
        unit += choice["price"]
        if choice is not group["choices"][0] or group_id in ("combodrink",):
            labels.append(choice["label"] if group_id != "card" else "Grußkarte")
        if group.get("text") and choice_id == "yes":
            card_text = text(line.get("cardText"), "Kartentext", required=False, max_len=200)
    return {
        "id": p["id"], "name": p["name"], "cat": p["cat"], "event": p.get("event"),
        "qty": qty, "unit": round(unit, 2), "opts": labels, "cardText": card_text,
        "drinks": p.get("drinks", 0) * qty,
    }


def build_order(payload, orders):
    cat = catalog()
    shop = cat["shop"]
    now = datetime.now()
    lines = payload.get("lines") or []
    if not lines or len(lines) > 30:
        raise InputError("Die Tüte ist leer.")
    lines = [price_line(cat, l) for l in lines]

    # Abholtag & -zeit
    try:
        pickup_day = date.fromisoformat(str(payload.get("pickupDate")))
    except ValueError:
        raise InputError("Ungültiger Abholtag.")
    if not 0 <= (pickup_day - now.date()).days <= shop["maxDaysAhead"]:
        raise InputError("Dieser Abholtag ist nicht möglich.")
    hours = hours_for(cat, pickup_day)
    if not hours:
        raise InputError("An diesem Tag haben wir geschlossen.")
    pickup_time = str(payload.get("pickupTime") or "")
    today = pickup_day == now.date()
    if pickup_time == "asap":
        if not today or not to_min(hours[0]) <= now.hour * 60 + now.minute < to_min(hours[1]):
            raise InputError("„So schnell wie möglich“ geht nur während der Öffnungszeit.")
    elif re.fullmatch(r"\d{2}:\d{2}", pickup_time):
        t = to_min(pickup_time)
        if not to_min(hours[0]) <= t <= to_min(hours[1]) or (today and t < now.hour * 60 + now.minute):
            raise InputError("Diese Abholzeit ist nicht möglich.")
    else:
        raise InputError("Bitte eine Abholzeit wählen.")

    subtotal = round(sum(l["unit"] * l["qty"] for l in lines), 2)
    drinks = sum(l["drinks"] for l in lines)
    discount = round(drinks * shop["reusableDiscount"], 2) if payload.get("reusable") else 0.0

    number = max((o["number"] for o in orders), default=100) + 1
    return {
        "number": number,
        "token": secrets.token_urlsafe(12),
        "createdAt": iso(now),
        "status": "neu",
        "statusChangedAt": iso(now),
        "pickupDate": pickup_day.isoformat(),
        "pickupTime": pickup_time,
        "customer": {
            "name": text(payload.get("name"), "Name", max_len=60),
            "phone": text(payload.get("phone"), "Telefon", required=False, max_len=40),
        },
        "notes": text(payload.get("notes"), "Wünsche", required=False, max_len=300),
        "reusable": bool(payload.get("reusable")) and drinks > 0,
        "lines": lines,
        "subtotal": subtotal,
        "discount": discount,
        "total": round(subtotal - discount, 2),
    }


def public_status(o):
    return {
        "number": o["number"], "status": o["status"], "pickupDate": o["pickupDate"], "pickupTime": o["pickupTime"],
        "createdAt": o["createdAt"], "total": o["total"], "name": o["customer"]["name"],
        "lines": [{"name": l["name"], "qty": l["qty"], "opts": l["opts"]} for l in o["lines"]],
    }


# ---------- Demo-Daten (damit das Dashboard beim ersten Start etwas zeigt) ----------
def make_demo_data():
    cat = catalog()
    rnd = random.Random(42)
    products = {p["id"]: p for p in cat["products"]}
    names = ["Anna", "Ben", "Clara", "David", "Elif", "Felix", "Greta", "Hannes", "Ida", "Jonas", "Lea", "Mia", "Noah", "Paul", "Sophie", "Tom"]
    weights = {  # Nachfrage je Produkt – Kaffee dominiert, Sträuße seltener
        "cappuccino": 22, "flatwhite": 12, "latte": 10, "espresso": 6, "americano": 6, "filter": 5,
        "rose-latte": 10, "lavender-latte": 6, "elderflower": 3, "icedlatte": 5, "coldbrew": 4,
        "bouquet-week": 5, "bouquet-s": 4, "bouquet-m": 2, "combo": 5, "beans-house": 2, "beans-ethiopia": 2,
    }
    ids, w = list(weights), list(weights.values())
    hour_weights = {7: 3, 8: 9, 9: 8, 10: 5, 11: 4, 12: 7, 13: 6, 14: 4, 15: 5, 16: 6, 17: 4, 18: 2}
    orders = []
    now = datetime.now()
    number = 100
    for back in range(7, -1, -1):
        day = now.date() - timedelta(days=back)
        hours = hours_for(cat, day)
        if not hours:
            continue
        open_h, close_h = to_min(hours[0]) // 60, to_min(hours[1]) // 60
        count = rnd.randint(28, 46) if day.weekday() < 5 else rnd.randint(40, 60)
        for _ in range(count):
            hrs = [h for h in hour_weights if open_h <= h <= close_h]
            h = rnd.choices(hrs, [hour_weights[x] for x in hrs])[0]
            created = datetime.combine(day, datetime.min.time()) + timedelta(hours=h, minutes=rnd.randint(0, 59))
            if created > now:
                continue
            lines = []
            for pid in set(rnd.choices(ids, w, k=rnd.choice([1, 1, 1, 2, 2, 3]))):
                p = products[pid]
                opts = {}
                if "milk" in p.get("options", []) and rnd.random() < 0.3:
                    opts["milk"] = "hafer"
                lines.append(price_line(cat, {"id": pid, "qty": rnd.choice([1, 1, 1, 2]), "opts": opts}))
            subtotal = round(sum(l["unit"] * l["qty"] for l in lines), 2)
            drinks = sum(l["drinks"] for l in lines)
            reusable = drinks > 0 and rnd.random() < 0.25
            discount = round(drinks * cat["shop"]["reusableDiscount"], 2) if reusable else 0.0
            age_min = (now - created).total_seconds() / 60
            status = "abgeholt" if age_min > 25 else "abholbereit" if age_min > 12 else "zubereitung" if age_min > 5 else "neu"
            if rnd.random() < 0.02:
                status = "storniert"
            number += 1
            pickup = created + timedelta(minutes=10)
            orders.append({
                "number": number, "token": secrets.token_urlsafe(12), "createdAt": iso(created), "status": status,
                "statusChangedAt": iso(created), "pickupDate": pickup.date().isoformat(),
                "pickupTime": "asap" if rnd.random() < 0.7 else pickup.strftime("%H:%M"),
                "customer": {"name": rnd.choice(names), "phone": ""}, "notes": "", "reusable": reusable,
                "lines": lines, "subtotal": subtotal, "discount": discount, "total": round(subtotal - discount, 2), "demo": True,
            })
    # Vorbestellungen für die nächsten Tage (z. B. Sträuße fürs Wochenende)
    for ahead in (1, 2, 3, 5):
        day = now.date() + timedelta(days=ahead)
        hours = hours_for(cat, day)
        if not hours:
            continue
        for _ in range(rnd.randint(2, 5)):
            pid = rnd.choice(["bouquet-week", "bouquet-m", "bouquet-l", "combo", "bouquet-s"])
            number += 1
            line = price_line(cat, {"id": pid, "qty": 1, "opts": {"card": "yes"} if rnd.random() < 0.5 else {}, "cardText": "Alles Liebe!"})
            orders.append({
                "number": number, "token": secrets.token_urlsafe(12),
                "createdAt": iso(now - timedelta(hours=rnd.randint(1, 30))), "status": "neu", "statusChangedAt": iso(now),
                "pickupDate": day.isoformat(), "pickupTime": f"{rnd.randint(to_min(hours[0]) // 60 + 1, to_min(hours[1]) // 60 - 1):02d}:00",
                "customer": {"name": rnd.choice(names), "phone": "0151 000000"}, "notes": "", "reusable": False,
                "lines": [line], "subtotal": line["unit"], "discount": 0.0, "total": line["unit"], "demo": True,
            })
    inquiries = [
        {"id": 1, "createdAt": iso(now - timedelta(hours=3)), "status": "neu", "name": "Julia Wagner", "email": "julia@example.de", "phone": "0170 1112223",
         "occasion": "Hochzeit", "date": (now.date() + timedelta(days=74)).isoformat(), "budget": "300 – 800 €",
         "message": "Brautstrauß in Weiß-Grün, dazu 8 Tischgestecke für ca. 60 Gäste.", "demo": True},
        {"id": 2, "createdAt": iso(now - timedelta(days=1, hours=2)), "status": "beantwortet", "name": "Praxis Dr. Keller", "email": "praxis@example.de", "phone": "",
         "occasion": "Blumen-Abo", "date": "", "budget": "100 – 300 €", "message": "Wöchentlich ein Strauß für den Empfang, gerne saisonal.", "demo": True},
        {"id": 3, "createdAt": iso(now - timedelta(days=3)), "status": "erledigt", "name": "Stadtmarketing", "email": "events@example.de", "phone": "",
         "occasion": "Event / Feier", "date": (now.date() + timedelta(days=20)).isoformat(), "budget": "über 800 €",
         "message": "Blumendeko für das Herbstfest in der Fußgängerzone.", "demo": True},
    ]
    return orders, inquiries


# ---------- HTTP ----------
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(PUBLIC), **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_BODY:
            raise InputError("Ungültige Anfrage.")
        try:
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise InputError("Ungültige Anfrage.")

    def authorized(self):
        return secrets.compare_digest(self.headers.get("X-Dashboard-Pin", ""), PIN)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/dashboard", "/dashboard/"):
            self.send_response(302)
            self.send_header("Location", "/dashboard.html")
            self.end_headers()
            return

        m = re.fullmatch(r"/api/status/([\w-]+)", path)
        if m:
            with lock:
                o = next((o for o in read_json(ORDERS_FILE, []) if o["token"] == m[1]), None)
            return self.send_json(200, public_status(o)) if o else self.send_json(404, {"error": "Nicht gefunden"})

        if path == "/api/dashboard/data":
            if not self.authorized():
                return self.send_json(401, {"error": "Falsche PIN"})
            since = (datetime.now() - timedelta(days=8)).date().isoformat()
            with lock:
                orders = [o for o in read_json(ORDERS_FILE, []) if o["createdAt"][:10] >= since or o["pickupDate"] >= date.today().isoformat()]
                inquiries = read_json(INQUIRIES_FILE, [])
            return self.send_json(200, {
                "orders": orders, "inquiries": inquiries[-100:], "serverTime": iso(datetime.now()),
                "hasDemo": any(o.get("demo") for o in orders) or any(i.get("demo") for i in inquiries),
            })

        if path.startswith("/api/"):
            return self.send_json(404, {"error": "Nicht gefunden"})
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/orders":
                payload = self.body()
                with lock:
                    orders = read_json(ORDERS_FILE, [])
                    order = build_order(payload, orders)
                    orders.append(order)
                    write_json(ORDERS_FILE, orders)
                items = ", ".join(f"{l['qty']}× {l['name']}" for l in order["lines"])
                when = "sofort" if order["pickupTime"] == "asap" else f"{order['pickupDate']} {order['pickupTime']}"
                print(f"[{datetime.now():%H:%M}] ➜ Bestellung #{order['number']} ({order['customer']['name']}, {when}): {items} – {order['total']:.2f} €")
                return self.send_json(201, {**public_status(order), "token": order["token"]})

            if path == "/api/inquiries":
                b = self.body()
                inquiry = {
                    "createdAt": iso(datetime.now()), "status": "neu",
                    "name": text(b.get("name"), "Name", max_len=80), "email": text(b.get("email"), "E-Mail", max_len=120),
                    "phone": text(b.get("phone"), "Telefon", required=False, max_len=40),
                    "occasion": text(b.get("occasion"), "Anlass", max_len=40),
                    "date": text(b.get("date"), "Datum", required=False, max_len=10),
                    "budget": text(b.get("budget"), "Budget", required=False, max_len=40),
                    "message": text(b.get("message"), "Nachricht", max_len=2000),
                }
                if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", inquiry["email"]):
                    raise InputError("Bitte eine gültige E-Mail-Adresse angeben.")
                with lock:
                    items = read_json(INQUIRIES_FILE, [])
                    inquiry["id"] = max((i["id"] for i in items), default=0) + 1
                    items.append(inquiry)
                    write_json(INQUIRIES_FILE, items)
                print(f"[{datetime.now():%H:%M}] ✉ Anfrage „{inquiry['occasion']}“ von {inquiry['name']}")
                return self.send_json(201, {"ok": True})

            if path.startswith("/api/dashboard/") and not self.authorized():
                return self.send_json(401, {"error": "Falsche PIN"})

            m = re.fullmatch(r"/api/dashboard/(orders|inquiries)/(\d+)/status", path)
            if m:
                status = self.body().get("status")
                allowed = ORDER_STATUSES if m[1] == "orders" else INQUIRY_STATUSES
                if status not in allowed:
                    raise InputError("Ungültiger Status.")
                file = ORDERS_FILE if m[1] == "orders" else INQUIRIES_FILE
                key = "number" if m[1] == "orders" else "id"
                with lock:
                    items = read_json(file, [])
                    item = next((i for i in items if i[key] == int(m[2])), None)
                    if not item:
                        return self.send_json(404, {"error": "Nicht gefunden"})
                    item["status"] = status
                    item["statusChangedAt"] = iso(datetime.now())
                    write_json(file, items)
                return self.send_json(200, item)

            if path == "/api/dashboard/demo/delete":
                with lock:
                    write_json(ORDERS_FILE, [o for o in read_json(ORDERS_FILE, []) if not o.get("demo")])
                    write_json(INQUIRIES_FILE, [i for i in read_json(INQUIRIES_FILE, []) if not i.get("demo")])
                print("  Demo-Daten gelöscht")
                return self.send_json(200, {"ok": True})

            self.send_json(404, {"error": "Nicht gefunden"})
        except InputError as e:
            self.send_json(400, {"error": str(e)})


class Server(ThreadingHTTPServer):
    allow_reuse_address = sys.platform != "win32"  # Windows: kein doppelter Start auf demselben Port
    daemon_threads = True

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    try:
        server = Server(("0.0.0.0", PORT), Handler)
    except OSError:
        print(f"Port {PORT} ist bereits belegt – läuft der Server schon in einem anderen Fenster?")
        sys.exit(1)
    if CONFIG.get("demoData") and not ORDERS_FILE.exists():
        orders, inquiries = make_demo_data()
        write_json(ORDERS_FILE, orders)
        write_json(INQUIRIES_FILE, inquiries)
        print(f"  Demo-Daten angelegt: {len(orders)} Bestellungen, {len(inquiries)} Anfragen")
    ip = local_ip()
    print("=" * 58)
    print(f"  {catalog()['shop']['name']} – Server läuft")
    print("=" * 58)
    print(f"  Website:     http://localhost:{PORT}/   (im WLAN: http://{ip}:{PORT}/)")
    print(f"  Dashboard:   http://{ip}:{PORT}/dashboard   PIN: {PIN}")
    print("  Beenden mit Strg+C")
    print("=" * 58)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer beendet.")
